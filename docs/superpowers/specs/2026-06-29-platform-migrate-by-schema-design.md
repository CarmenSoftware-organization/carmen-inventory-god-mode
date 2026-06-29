# Platform migrate by schema name (+ remove legacy /migrations)

Date: 2026-06-29
Branch base: main (proposed branch: `feat/platform-migrate-by-schema`)

## Goal

Let the operator pick the **target schema** for a platform migration run, instead
of the schema being fixed by env and the safety gate keying on the database name.

Two parts:

- **Part A — migrate by schema.** Add a schema selector to the platform-migrations
  page; inject the chosen schema into the subprocess connection so Prisma
  `deploy`/`status`, seeds, and tenant-view BU enumeration all target it; switch
  the confirmation phrase from database name to schema name; allow bootstrapping a
  brand-new schema (extra-guarded).
- **Part B — remove the legacy `/migrations` page.** The old in-app
  `/migrations` runner (two hardcoded idempotent tasks) is redundant now that the
  platform-migrations page is the real migration tool; remove it.

## Background / why

- `/platform-migrations` spawns the `@repo/prisma-shared-schema-platform`
  package's own scripts and streams output (see
  `docs/superpowers/specs/2026-06-29-platform-migrations-page-design.md`).
- **The package's Prisma datasource reads only the connection URL**, not
  `SYSTEM_SCHEMA_NAME`:
  ```prisma
  datasource db { url = env("SYSTEM_DATABASE_URL"); directUrl = env("SYSTEM_DIRECT_URL") }
  ```
  Seeds do `new PrismaClient({ datasources: { db: { url: process.env.SYSTEM_DIRECT_URL }}})`;
  `apply-tenant-views.ts` connects with the same URL to read active BUs, then
  `SET search_path` per BU schema. So **the target schema is whatever the URL's
  `?schema=` says** (or `public` if absent) — `SYSTEM_SCHEMA_NAME` injected by
  god-mode today is a **no-op** for the actual migration target (used only for the
  banner/audit). Implementing Part A also closes that latent gap.
- The dev/prod databases are both named **`postgres`** (`.../6432/postgres`), so
  the current confirm phrase (the DB name) is identical across environments and
  provides no real protection. The **schema** (`CARMEN_SYSTEM` and per-BU schemas)
  is what actually distinguishes targets — environments are separated by schema in
  one `postgres` DB. This is the core motivation for switching the gate to the
  schema name.

## Part A — Design

### Schema selection mechanism (chosen approach)

god-mode rewrites the subprocess connection URLs to set `?schema=<chosen>`. This
is Prisma's canonical mechanism and retargets **every** package command with one
change: Prisma migrate/deploy/status (where `_prisma_migrations` lives and where
objects are created), seeds (same datasource URL), and tenant-views (which
platform schema the BU registry is read from before per-BU `search_path` apply).

Rejected alternatives:
- **Inject `SYSTEM_SCHEMA_NAME` env + patch the package to read it** — requires
  changing the backend repo (outside god-mode's control); the datasource still
  only reads the URL.
- **`PGOPTIONS=-c search_path=<schema>`** — Prisma's migration engine does not
  honor `search_path` for choosing the migration/object schema; it uses the URL's
  `?schema=`. Would work only for seeds/psql, not deploy. Inconsistent.

### Files & changes

```
lib/platform-package.ts        + withSchemaParam(url, schema) (pure URL rewrite)
                               buildSubprocessEnv(schema) — rewrite both URLs + set SYSTEM_SCHEMA_NAME
                               targetDbInfo(schema?) — banner/audit reflect chosen schema
lib/platform-migrations.ts     + validateSchemaName(name, existing) → "known" | "new" | "invalid"
                               canRun(): replace dbName with schema; gate confirmCreateSchema for new
lib/schema-bootstrap.ts        + ensureSchemaExists(schema) — CREATE SCHEMA IF NOT EXISTS over SYSTEM_DIRECT_URL
app/api/ops/platform-migrate/route.ts   parse + validate schema, gates, pre-create, inject, audit
components/platform-migrations.tsx      schema selector (datalist) + new-schema gate + dynamic banner/confirm
app/(god)/platform-migrations/page.tsx  load listSchemaNames(); pass schemas + default
```

### `withSchemaParam(url, schema)` (pure)

- Parse with `URL`; set/replace the `schema` search param (URL-encoded);
  preserve other query params; return the string.
- Used for **both** `SYSTEM_DATABASE_URL` and `SYSTEM_DIRECT_URL`.
- Unit-tested: adds `?schema=` when absent, replaces when present, leaves other
  params intact, encodes correctly (e.g. `CARMEN_SYSTEM`).

### `buildSubprocessEnv(schema)`

- Rewrite `SYSTEM_DATABASE_URL` and `SYSTEM_DIRECT_URL` via `withSchemaParam`.
- Set `SYSTEM_SCHEMA_NAME = schema` (now consistent with the URL; still consumed
  by anything that reads it).
- Everything else unchanged.

### `validateSchemaName(name, existing)` (pure)

- Charset: `^[A-Za-z_][A-Za-z0-9_]*$` (covers `CARMEN_SYSTEM`, BU schemas; first
  char a letter or underscore, no leading digit). Anything else → `"invalid"`.
- In `existing` → `"known"`; valid charset but not in `existing` → `"new"`.

### Schema bootstrap — `ensureSchemaExists(schema)`

- For a **new** schema, god-mode runs `CREATE SCHEMA IF NOT EXISTS <ident(schema)>`
  itself **before** spawning, over a one-off connection to **`SYSTEM_DIRECT_URL`**
  (non-pooled — correct for DDL; `getSql()` uses `DATABASE_URL`/pooled, so use a
  dedicated `postgres()` connection here and close it).
- Identifier quoted via `ident()` from `lib/sql-guard`.
- Deterministic (no reliance on Prisma's create-schema behavior) and lets seeds
  run on a freshly created schema once migrations have been deployed.
- Audited as its own action (op `schema-create`, target schema, actor).

### Route changes (`app/api/ops/platform-migrate/route.ts`)

Body gains `schema: string` and `confirmCreateSchema?: boolean`. Order:

1. `requireAuth` (401).
2. Look up op (404). Existing `--bu`/`--only` validation unchanged.
3. **Validate schema:** `validateSchemaName(schema, await listSchemaNames())`.
   - `"invalid"` → 400.
   - `"new"` → require `confirmCreateSchema === true`, else 400
     (`Creating a new schema requires confirmCreateSchema: true`).
4. **Confirm gate** (write ops, unchanged shape): `confirm` must equal the
   **chosen schema** (was the DB name); destructive ops still also require
   `confirmDestroy: true`.
5. Preflight (`assertPackageDir`, `assertPsql` for tenant) — unchanged.
6. If schema is `"new"`: `await ensureSchemaExists(schema)` (audited).
7. Build subprocess env with `buildSubprocessEnv(schema)`; spawn + stream.
8. Audit the run with the **chosen schema** (replaces `env().systemSchemaName`).

The module-level single-run lock and `targetDbInfo().masked` log line stay; the
masked line now reflects the chosen schema.

### UI changes (`components/platform-migrations.tsx`)

- **Schema selector:** an `<input list="schemas">` + `<datalist>` (mirrors the
  `--only` field). Default value = the system schema. Operator picks an existing
  schema or types a new one.
- **New-schema gate:** when the typed value is valid charset but not in the
  existing list, show a checkbox **"Create new schema `<X>`"** (`confirmCreateSchema`).
- **Banner** shows the **currently selected** schema (updates live), not the env
  default: `Target: <masked host/db> (schema <selected>)`.
- **Confirm label:** "Type the schema name `<selected>` to confirm" — `canRun`
  checks `confirm === selectedSchema` (and `confirmCreateSchema` when new).
- Request body includes `schema` and (when new) `confirmCreateSchema`.

### Page (`app/(god)/platform-migrations/page.tsx`)

- Also load `listSchemaNames()` (`lib/introspect`) and pass `schemas` +
  `defaultSchema = targetDbInfo().schema` to the client.

### Tenant-views note

Selecting a schema sets which **platform schema the BU registry is read from**;
views are still applied per active BU schema (from the registry rows) exactly as
before. If the selected schema has no `tb_business_unit`, the tenant op finds no
BUs and reports so — acceptable and clear.

## Part B — Remove legacy `/migrations`

Delete (page, route, lib, client, tests):

- `app/(god)/migrations/page.tsx`
- `app/api/ops/migrate/route.ts`
- `lib/migrations.ts`
- `components/run-migrations.tsx`
- `lib/__tests__/migrations.int.test.ts`
- `lib/__tests__/migrate-route.int.test.ts`
- Nav `<Link href="/migrations">Migrations</Link>` in `app/(god)/layout.tsx`

**Keep** `lib/audit.ts` `ensureAuditTable` — it is used by the platform-migrate
route and many int-test setups; `lib/migrations.ts` only imported it.

## Testing

- **Unit** (`.test.ts`):
  - `withSchemaParam` — add/replace/preserve/encode.
  - `validateSchemaName` — known / new / invalid (reject `public schema`,
    `a;b`, empty, etc.).
  - `buildSubprocessEnv(schema)` — both URLs carry `?schema=`, `SYSTEM_SCHEMA_NAME`
    set.
  - `canRun` — confirm must equal the schema; new schema requires
    `confirmCreateSchema`.
- **Route** (`lib/__tests__/platform-migrate-route.test.ts`, mocked):
  update confirm phrase from the DB name to the schema name; add cases — invalid
  schema → 400; new schema without `confirmCreateSchema` → 400; new schema with it
  → `ensureSchemaExists` called then stream; audit row carries the chosen schema;
  injected env asserted (mock `listSchemaNames`).
- **Bootstrap** (`.int.test.ts`): `ensureSchemaExists` creates the schema and is
  idempotent (embedded-postgres via `@/test/pg`).
- **E2E** (`e2e/platform-migrations.spec.ts`): keep the read-only `prisma-status`
  path; select the default schema explicitly; confirm the banner shows it.
- New files lint-clean; pre-existing repo lint untouched (`CLAUDE.md`).

## Risks

- **Wrong-schema deploy.** Mitigated by the dynamic banner + schema-name confirm
  phrase (now meaningful, unlike the DB name) + destructive double gate + the
  explicit new-schema gate.
- **Bootstrapping junk schemas.** `confirmCreateSchema` checkbox + charset
  validation guard against typos creating stray schemas in the live DB.
- **Dropping `ensureClusterDeletedAt`.** Removing `/migrations` deletes the only
  in-app mechanism that ensured `tb_cluster.deleted_at` (and re-ensured the audit
  table). Both are assumed already present in the live DB (the cluster soft-delete
  feature has shipped); the platform-migrate route still calls `ensureAuditTable()`
  directly. If a fresh DB ever needs the column, it now comes from a real Prisma
  migration, not this tool.
- **DDL over a pooled URL.** Avoided by running `CREATE SCHEMA` over
  `SYSTEM_DIRECT_URL` (non-pooled).

## Out of scope

- Changing how the backend package resolves its datasource.
- Per-op (vs per-run) schema selection — schema is chosen once per run.
- Killing the subprocess on client disconnect (still a follow-up).
- Generating new Prisma migrations (`migrate dev`).
