# Platform migrations page

Date: 2026-06-29
Branch base: main (proposed branch: `feat/platform-migrations`)

## Goal

Add a god-mode admin page that runs the migration scripts of the
`@repo/prisma-shared-schema-platform` package (in the sibling
`carmen-turborepo-backend-v2` repo) against the database this god-mode instance
manages, streaming live output to the operator.

The package contains **three distinct kinds** of "migration script", all in
scope:

1. **Prisma schema migrations** — `prisma/migrations/<ts>_<name>/migration.sql`,
   normally applied with `prisma migrate deploy`; state tracked in
   `_prisma_migrations`.
2. **Tenant view migrations** — `migrations/tenant/NNN_*.up.sql` / `.down.sql`
   (idempotent `CREATE OR REPLACE VIEW`), applied **per business-unit schema** by
   `prisma/apply-tenant-views.ts`.
3. **Seed scripts** — `prisma/seed.*.ts` (TypeScript, run via the package's own
   `db:seed.*` npm scripts).

## Background

- The god-mode app is a Next.js (16) admin tool over a **live** Postgres,
  connecting directly via the `postgres` lib (`lib/db.ts`); it does **not** use
  Prisma. Every write is treated as prod (`CLAUDE.md`).
- An existing `/migrations` page (`app/(god)/migrations/page.tsx`) runs two
  hardcoded **in-app** idempotent tasks (`ensureAuditTable`,
  `ensureClusterDeletedAt`) via `lib/migrations.ts`. That page is about the
  god-mode tool's *own* schema needs and is **out of scope** here — the new
  feature targets the *platform package* and has a different mechanism and risk
  profile, so it gets a **dedicated page**.
- The streaming-progress mechanism already exists
  (`docs/superpowers/specs/2026-06-26-streaming-progress-design.md`):
  `lib/progress.ts` `streamOperation()` emits NDJSON; client uses
  `useOperationStream` + `<OperationProgress>`; `app/api/ops/*` handlers re-run
  `requireAuth` and re-validate the confirm phrase before streaming.
- The package resolves its DB connection from env:
  Prisma's datasource uses `env("SYSTEM_DATABASE_URL")` (url) and
  `env("SYSTEM_DIRECT_URL")` (directUrl); seeds call `dotenv.config()` then read
  `process.env.SYSTEM_DIRECT_URL`; `apply-tenant-views.ts` reads
  `SYSTEM_DIRECT_URL` (or `PLATFORM_DATABASE_URL`) to enumerate active BUs and
  shells out to **`psql`** to apply each `.sql` file per BU schema.

### Decisions captured during brainstorming

- **Runtime environment:** god-mode always runs on a machine where the backend
  repo is checked out with `node_modules` + Prisma CLI installed. This makes the
  subprocess approach viable.
- **Execution model:** spawn the package's **own commands** and stream their
  output. Rejected alternatives: native re-implementation (can't run TS seeds;
  risks drifting from Prisma's deploy semantics) and a hybrid (two mechanisms for
  no benefit).
- **Safety gate:** typed **confirm phrase** for write operations (mirrors the
  cascade-delete pattern), re-validated server-side before streaming. Read-only
  previews need no confirm.
- **Destructive resets:** **included but extra-guarded** in a visually separate
  danger zone (type full DB name + explicit "I understand this destroys data").
- **Scope of v1:** all three groups, built in phases (Prisma group first, then
  tenant views, then seeds + danger zone) on shared infrastructure.

## Design

### Target database

Because god-mode spawns the subprocess, it **controls the subprocess env** and
injects the connection from its *own* resolved env, so a migration always hits
**the exact DB this god-mode instance manages** (dev via `.env.local`, prod via
`.env.prod`) — never whatever happens to be in the package's `.env*` files.

Injected into the subprocess env:

- `SYSTEM_DATABASE_URL` — from god-mode env (already present).
- `SYSTEM_DIRECT_URL` — **new** god-mode env var; required by Prisma `migrate`
  and by seeds/`apply-tenant-views.ts`. Defaults to `SYSTEM_DATABASE_URL` when
  unset (correct for non-pooled dev DBs).
- `SYSTEM_SCHEMA_NAME` — from god-mode env (already present).

A **target-DB banner** at the top of the page parses `SYSTEM_DATABASE_URL` and
shows `host / database (schema)` with the password masked, so the operator
always sees dev-vs-prod before acting. (Tenant-view ops additionally note they
target **all active BU schemas**, not the system schema.)

### Command catalog (curated allow-list)

A pure, testable catalog (`lib/platform-migrations.ts`). Each entry:
`{ id, group, label, kind: "script" | "bin", run, args, writes, destructive, requiresPsql }`
where `run` is either an npm script name (invoked `bun run <script>` in the
package dir) or a resolved binary + base args.

- **Prisma migrations** (target = platform DB):
  - `prisma-status` — `prisma migrate status` (resolved `prisma` bin, `kind: "bin"`;
    no npm script exists for status) — **read-only**, no confirm.
  - `prisma-deploy` — `db:deploy` script (`prisma migrate deploy`) — write.
- **Tenant views** (target = active BU schemas; `requiresPsql: true`):
  - `tenant-list` — in-app listing of `migrations/tenant/*.up.sql` — read-only.
  - `tenant-apply` — `db:tenant-views:apply`, optional `--bu <code>` /
    `--only <prefix>` — write.
  - `tenant-revert` — `db:tenant-views:revert` (+ optional `--bu`/`--only`) —
    **danger zone** (drops/replaces views).
- **Seeds** (target = platform DB), idempotent — write:
  `db:seed`, `db:seed.permission`, `db:seed.platform-permission`,
  `db:seed.application`, `db:seed.role-permission`,
  `db:seed.platform-role-permission`, `db:seed.platform-super-admin`,
  `db:seed.report-template`.
- **Danger zone** (extra-guarded): `db:migrate:reset`, `db:seed:reset`,
  `db:mock:reset`.

### Argument validation (injection-proof)

All commands run via `spawn` with an **argument array — never a shell string**.
User-supplied args are validated before use:

- `--bu <code>` — must match an **active BU code** (from `lib/registry`
  `listBusinessUnits`); also constrained to `^[A-Za-z0-9_-]+$`.
- `--only <prefix>` — must match the prefix of an **existing file** in
  `migrations/tenant`; also constrained to a strict charset.

Anything failing validation is rejected (`400`) before any process spawns.

### Safety / confirmation

- **Read-only** ops (`prisma-status`, `tenant-list`): run on click, no confirm.
- **Write** ops: operator types a confirm phrase (the **database name**, via a
  helper modeled on `lib/delete-confirm.ts`); the `app/api/ops/*` route re-runs
  `requireAuth` and **re-validates the phrase server-side** before streaming.
- **Danger zone**: stronger gate — type the **full DB name** *and* an explicit
  "I understand this destroys data"; rendered in a separated red section.
- Every run writes a `tb_god_mode_audit` row via `lib/audit` (op id, args,
  target DB, actor, exit code, success). The subprocess bypasses god-mode's SQL
  audit helpers, so the **invocation** is audited explicitly.

### Execution & streaming

Route `app/api/ops/platform-migrate/route.ts` (`runtime = "nodejs"`,
`dynamic = "force-dynamic"`):

1. `requireAuth` (401 on failure).
2. Parse `{ opId, args, confirm }`; look up the catalog entry (404/400 if
   unknown/invalid args).
3. Preflight: package dir exists (`PLATFORM_PACKAGE_DIR`), required binary
   resolves, and — for tenant ops — `psql` is on PATH. Failures return a clear
   error before streaming.
4. If the op writes, re-validate the confirm phrase (danger zone: both gates).
5. Build the subprocess env (inject DB vars above).
6. `streamOperation(...)` → `lib/run-process.ts` `spawn`s the command with
   `cwd = packageDir`, no shell, piping each **stdout/stderr line** as a new
   `{ type: "log", line, stream }` progress event; on exit emit `done` (with
   exit code in the summary) or `error` (non-zero exit / spawn failure).
7. Write the audit row; resolve.

`lib/progress.ts` gains a `{ type: "log"; line: string; stream?: "out" | "err" }`
event; `lib/operation-stream.ts` accumulates a bounded log buffer in state;
`<OperationProgress>` (or a sibling `<OperationLog>`) renders a live scrolling
`<pre>` plus the existing phase indicator and a final exit-code summary.

### Components & files

```
app/(god)/platform-migrations/page.tsx   server: catalog + active BU list + target-DB banner
components/platform-migrations.tsx        client: grouped op picker, arg inputs, confirm(s), live log
app/api/ops/platform-migrate/route.ts     auth → validate args → re-validate confirm → stream → audit
lib/platform-package.ts                    resolve pkg dir + prisma/psql binaries + build subprocess env
lib/platform-migrations.ts                catalog + arg validation (pure)
lib/run-process.ts                         spawn() runner: stream stdout/stderr lines → onLog; resolve {code}
lib/progress.ts, lib/operation-stream.ts  add `log` event + bounded log buffer
lib/env.ts                                 add SYSTEM_DIRECT_URL, PLATFORM_PACKAGE_DIR
app/(god)/layout.tsx                       new nav link "Platform migrations"
```

`PLATFORM_PACKAGE_DIR` defaults to the sibling path
`../carmen-turborepo-backend-v2/packages/prisma-shared-schema-platform`
(resolved relative to the god-mode repo root) and is overridable via env.

## Error handling

- Missing package dir / unresolved binary / missing `psql` (tenant ops) → clear
  preflight error before streaming.
- Non-zero subprocess exit → `error` event with the tail of output; summary
  shows failure + exit code.
- Client disconnect does **not** kill the running process in v1 (documented
  limitation; optional abort-kill is a follow-up).
- One run at a time: Run button disabled while running + a module-level in-memory
  lock in the route (single-instance admin tool; multi-instance caveat noted).

## Testing

- **Unit** (`.test.ts`): catalog mapping; arg validation (reject bad
  `--bu`/`--only` and injection attempts); subprocess env builder; target-DB
  parse + password masking; confirm-phrase validation; binary/path resolution.
- **Route/int** (`.test.ts` with mocks): mock `@/lib/session` + `next/cache`,
  mock the process runner — assert correct command/args/cwd/env, confirm
  re-validation (401 unauth, 400 bad phrase), danger-zone double gate, NDJSON
  stream shape (`log` then `done`/`error`), and that an audit row is written.
- **E2E** (`e2e/*.spec.ts`): drive `prisma-status` (read-only) end-to-end to
  validate streaming. Heavier write ops stay **manual** (live DB).
- New files kept lint-clean; pre-existing repo lint left untouched (per
  `CLAUDE.md`).

## Risks

- **Out-of-band deploy.** Running `prisma migrate deploy` from this tool can
  conflict with CI, fail Prisma checksum validation (if a migration was edited
  after being applied), or leave partial state. Mitigations: lead with the
  read-only `status` preview, surface Prisma's raw output faithfully, and report
  the exit code.
- **Wrong-DB risk.** Mitigated by the target-DB banner + typed confirm phrase
  (the DB name) + danger-zone double gate.
- **`psql` dependency** for tenant views — preflight-checked with a clear error.

## Scope / phasing

v1 covers all three groups. Build order on shared infrastructure:

1. **Phase 1** — infra (`run-process`, `log` streaming, route, page shell,
   target-DB banner, env vars) + **Prisma group** (`status`, `deploy`).
2. **Phase 2** — **tenant views** (apply + `--bu`/`--only`, `psql` preflight).
3. **Phase 3** — **seeds** + **danger zone** (resets with the stronger gate).

## Out of scope

- Changing the existing in-app `/migrations` page.
- Killing the subprocess on client disconnect (follow-up).
- Multi-instance run-locking (single-instance assumption).
- Generating new Prisma migrations (`migrate dev`) — deploy/status only.
