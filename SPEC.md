# Carmen Inventory God Mode — System Specification

A direct, web-based admin console over the Carmen inventory PostgreSQL database.
It exists for trusted operators to inspect and surgically mutate production data
that the normal application does not expose. **Every write is permanent — there
is no undo; the audit log is the only recovery record.** Setup and operational
safety live in [README.md](README.md); agent/working conventions in
[CLAUDE.md](CLAUDE.md).

## 1. Goals & non-goals

**Goals**
- Browse any schema/table, run filtered reads, and perform row-level
  insert/update/delete through a generic grid.
- Safely delete rows whose foreign-key descendants must go too (cascade), with a
  previewed "blast radius" and a typed confirmation gate.
- Manage the multi-tenant registry: **business units** and **clusters** in the
  `CARMEN_SYSTEM` schema, including reversible soft-delete and irreversible hard
  delete that can drop a tenant's entire Postgres schema.
- Run a guarded raw-SQL console (reads immediate; writes preview → explicit
  commit), with every executed statement audited.
- Show **live progress** for long-running destructive operations.

**Non-goals**
- Not a general BI/reporting tool, not multi-user RBAC (single shared secret),
  not a migration framework. No soft-undo beyond the audit trail.

## 2. Security & safety model

- **Auth:** shared-secret login (`GOD_MODE_PASSWORD`) → `iron-session` cookie.
  `middleware.ts` gates the `(god)` route group; `lib/session.ts`
  `requireAuth()` **throws** on an unauthenticated session.
- **Defense in depth:** server actions and route handlers re-run `requireAuth`
  and never trust client-derived authority — the system schema, the
  business-unit/cluster classification, and the schemas-to-drop list are all
  re-derived server-side.
- **Typed confirmation:** destructive flows require typing a phrase — `DELETE`
  normally, or the **schema name** when a single business-unit delete also drops
  its tenant schema (`lib/delete-confirm.ts`).
- **Blast-radius caps:** `CASCADE_MAX_ROWS` / `CASCADE_MAX_DEPTH`; an over-cap
  cascade is refused rather than partially executed.
- **Atomicity:** each cascade / multi-schema drop runs in a single transaction
  (`lib/db.ts` `withTransaction`); it fully commits or fully rolls back.
- **Audit:** every mutation writes to `CARMEN_SYSTEM.tb_god_mode_audit`
  (`lib/audit.ts`) inside the same transaction — actor, schema/table, operation,
  pk, old/new values, statement.
- **SQL identifiers:** never interpolated raw — always via `lib/sql-guard`
  `ident()` / `qualified()`.

## 3. Data model touchpoints

- **System schema** (`SYSTEM_SCHEMA_NAME`, default `CARMEN_SYSTEM`):
  `tb_business_unit`, `tb_cluster`, `tb_god_mode_audit`. Clusters group business
  units; each business unit may map to a **tenant Postgres schema**
  (`db_connection->>'schema'`), resolved by `lib/registry.ts`.
- **Tenant schemas:** per-business-unit databases. Hard delete can
  `DROP SCHEMA … CASCADE` them (single delete only; batch never drops).
- **Soft delete:** `tb_cluster.deleted_at` (+ `deleted_by_id`) gives a reversible
  recycle-bin; hard delete removes the row permanently.

## 4. Architecture

Next.js 16 (App Router, React 19, server actions + route handlers), `postgres`
driver, Vitest + Playwright, Bun toolchain. **This Next version has breaking
changes — consult `node_modules/next/dist/docs/` before writing Next code.**

### Layers
- **`lib/` — DB & domain core** (transport-agnostic, unit/integration-tested)
  - `db.ts` (`getSql`, `withTransaction`), `sql-guard.ts`, `env.ts`, `session.ts`
  - `introspect.ts` (columns/FKs), `topo.ts` (delete ordering), `cascade.ts`
    (blast-radius BFS + transactional cascade + optional schema drops, with an
    optional `onProgress` callback)
  - `rows.ts` / `write.ts` / `coerce.ts` (generic row CRUD + value coercion),
    `sql-runner.ts` (read / preview / apply), `registry.ts` (BU/cluster
    resolution), `soft-delete.ts`, `migrations.ts`, `audit.ts`
  - `progress.ts` (`streamOperation`, `ProgressEvent`/`OnProgress`),
    `operation-stream.ts` (pure client `readNdjson` + `reduceOperation`),
    `delete-confirm.ts`
- **`server/` — `"use server"` actions:** `auth.ts`, `rows.ts`, `sql.ts`,
  `cluster-actions.ts` (soft delete / restore / insert / update).
- **`app/api/ops/**/route.ts` — streaming route handlers:** `cascade-delete`
  (single + batch + cluster hard delete), `migrate`.
- **`app/(god)/` — UI pages:** `schemas`, `clusters` (+ `new`, `[id]/edit`),
  `audit`, `[schema]/tables`, `[schema]/[table]` (+ `insert`/`edit`/`delete`/
  `delete-batch`), `[schema]/sql`, `migrations`.
- **`components/`** — `row-grid`, `row-form`, `confirm-delete` (client,
  streaming), `clusters-table`, `business-units-table`, `sql-console`,
  `schema-banner`, `use-operation-stream`, `operation-progress`, `run-migrations`.

## 5. Key mechanisms

### 5.1 Cascade delete engine (`lib/cascade.ts`)
1. **Compute blast radius:** BFS over foreign keys from the target row(s),
   following child FKs (incl. FKs referencing non-PK unique columns), capped by
   `CASCADE_MAX_ROWS`/`DEPTH`; refuses on a genuine multi-table FK cycle.
2. **Delete:** topologically order involved tables (children first) and delete
   in one transaction, auditing each row; then optionally
   `DROP SCHEMA … CASCADE` the resolved tenant schemas.
3. **Batch** variant deletes N targets in one combined radius/transaction and
   **never** drops schemas.

### 5.2 Streaming progress (`lib/progress.ts` + client)
Long operations report progress without blocking on a single round-trip:
- A route handler returns a `ReadableStream` of **NDJSON** events via
  `streamOperation(run)`. Operation functions take an optional `onProgress`
  callback (no callback ⇒ unchanged behavior), emitting:
  `step "Computing…"` → `total` (denominator known) → per-unit `step` with
  cumulative `done` → `done {summary, redirect?}` / `error`.
- The transaction stays open and events travel over HTTP, never the DB —
  avoiding the in-transaction visibility trap of a progress-table design.
- **Honesty contract:** `step`s are optimistic (pre-COMMIT); `done` is emitted
  only after the operation resolves (post-COMMIT). The "no changes were applied —
  rolled back" message renders only for transactional operations (via
  `rolledBackOnError`); non-transactional migrations omit it, and post-commit
  `revalidatePath` failures cannot masquerade as a rollback.
- Client: `useOperationStream` (POST → `readNdjson` → `reduceOperation` → router
  navigate on `done.redirect`) drives a shared `<OperationProgress>` bar
  (determinate, or indeterminate while the denominator is unknown).
- Wired into: cascade/cluster hard delete, the `/migrations` page, and an
  indeterminate "Running…" bar in the SQL console. **No cancellation** (locked
  decision). Full design:
  `docs/superpowers/specs/2026-06-26-streaming-progress-design.md`.

### 5.3 SQL console (`lib/sql-runner.ts`)
Reads run immediately (capped result set). Writes run in a transaction that is
**rolled back for preview**, showing affected-row count; an explicit Commit
re-runs and audits. (Multi-statement scripting is intentionally not implemented.)

### 5.4 Migrations (`lib/migrations.ts`)
An idempotent, ordered task list (`runMigrations`) shared by the CLI
(`bun run migrate`) and the streaming `/migrations` page — currently ensure the
audit table and `tb_cluster.deleted_at`.

## 6. Testing strategy

- **Unit** (`.test.ts`, node): pure logic (topo, coerce, sql-guard, progress
  protocol, NDJSON reader/reducer).
- **Component** (`.test.tsx`, jsdom + RTL): tables, forms, the progress
  component and hook.
- **Integration** (`.int.test.ts`, embedded-postgres via `@/test/pg`): cascade
  engine, registry, soft-delete, audit, migrations, and route handlers (auth →
  validation → real DB), with `@/lib/session` and `next/cache` mocked.
- **E2E** (Playwright, `e2e/`): an unauth-redirect smoke test and a streaming
  hard-delete happy-path that **self-seeds a throwaway cluster** against the live
  dev DB and cleans up by code prefix.
- Gates: `bun run test`, `bun run typecheck` (must be clean). `bun run lint`
  carries a pre-existing `no-explicit-any` baseline in older modules — new code
  is kept lint-clean.

## 7. Reference docs
- Setup & safety: [README.md](README.md)
- Agent/working conventions: [CLAUDE.md](CLAUDE.md) → [AGENTS.md](AGENTS.md)
- Design specs & plans: `docs/superpowers/specs/` and `docs/superpowers/plans/`
