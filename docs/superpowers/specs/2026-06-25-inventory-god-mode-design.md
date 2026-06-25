# Carmen Inventory — God Mode Admin Tool

**Design spec** · 2026-06-25

## 1. Purpose

A Next.js admin tool that gives an operator direct, unguarded ("god mode")
control over the Carmen inventory PostgreSQL database: browse any table, edit
values, insert rows, and **hard delete** rows — including **recursive cascade
deletes** that follow foreign-key references. There is no soft-delete safety
net on the delete itself; the safety net is an audit log plus a
preview-and-confirm gate before anything destructive runs.

The tool is schema-agnostic (a generic table browser/editor that works on any
table by introspecting the catalog at runtime), with the registry of tenant
schemas as its home screen.

## 2. Verified Environment Facts

Confirmed by read-only inspection of `dev.blueledgers.com:6432` (PgBouncer):

- It is **one PostgreSQL database (`postgres`) with many schemas**, not separate
  databases. The two connection strings differ only by `schema`.
- **System schema = `CARMEN_SYSTEM`.** It holds the registry, users, clusters,
  business units, subscriptions, etc.
- **Registry table = `CARMEN_SYSTEM.tb_business_unit`.** Each business unit row
  carries a `db_connection` **jsonb** column whose `schema` field names the
  tenant schema (e.g. `BL_FIFO`, `ZEBRA_FIFO`, `BL_AVG`). `db_connection` is
  **nullable** — some business units have no provisioned tenant schema.
- Hierarchy: `tb_cluster` → `tb_business_unit` → tenant schema.
- FKs into `tb_business_unit` exist but are **all `NO ACTION`** (`confdeltype='a'`):
  `tb_application_role`, `tb_business_unit_tb_module`, `tb_subscription_detail`,
  `tb_user_tb_business_unit` — and these recurse (e.g. `tb_application_role` is
  itself referenced by `tb_application_role_tb_permission`). A plain `DELETE`
  would therefore fail on a FK violation; **app-level ordered cascade is
  mandatory.**
- The system schema models deletion with **soft delete** (`deleted_at`,
  `deleted_by_id`). God mode ignores this and hard-deletes.
- The business-unit → tenant-schema link is a **jsonb pointer, not a foreign
  key**, so the FK-graph traversal cannot "see" tenant-schema data.

## 3. Decisions (from brainstorming)

| Topic | Decision |
|---|---|
| Tool type | Hybrid: generic table browser/editor + curated views where they pay off |
| Schema model | System schema is a registry of tenant schemas; pick one, work inside it |
| Auth | Single shared secret (`GOD_MODE_PASSWORD`) → signed httpOnly session cookie |
| Safety net | Audit log (before/after) + type-to-confirm on delete + preview-before-apply |
| Operations | UPDATE, hard DELETE, INSERT, raw SQL console, runtime FK-graph cascade delete |
| Cascade method | Introspect the FK graph at runtime; walk the blast radius; ordered delete in one transaction |
| BU cascade scope | Ask each time: offer an opt-in "also DROP the tenant schema" checkbox (default off) |
| Data layer | Raw SQL via `postgres` (postgres.js) + runtime introspection — no ORM |

## 4. Architecture & Stack

- **Next.js (App Router) + TypeScript.** Server Components for reads,
  **Server Actions** for every mutation. No client-side database access ever.
- **UI:** Tailwind + shadcn/ui; TanStack Table for the generic grid; CodeMirror
  for the SQL console; Zod for input validation.
- **Driver:** `postgres` (postgres.js) with `prepare: false` (PgBouncer
  transaction-pooling safe). A single pool to the `postgres` database;
  **every identifier is schema-qualified** (`"schema"."table"`). Multi-statement
  work runs inside a transaction with `SET LOCAL search_path`.
- The `?schema=` URL param is a Prisma convention that postgres.js ignores; the
  app parses the base URL and manages schema selection itself. `SYSTEM_SCHEMA_NAME`
  identifies where the registry + audit tables live.
- **Auth:** `/login` compares the secret (constant-time) to `GOD_MODE_PASSWORD`
  and sets a signed httpOnly session cookie; `middleware.ts` guards all routes
  except `/login`.

### Project structure

```
app/
  login/                      shared-secret gate
  (god)/                      protected route group
    schemas/                  registry home: business units → tenant schemas
    [schema]/
      tables/                 list tables in the schema
      [table]/                generic grid: browse/edit/insert/delete
      sql/                    raw SQL console
    audit/                    audit-log viewer
lib/
  db.ts                       pool + withTransaction helper + q.ident()
  introspect.ts               schemas, tables, columns, types, PKs, FKs
  cascade.ts                  FK-graph traversal + blast-radius computation
  audit.ts                    write/read audit entries
  sql-guard.ts                identifier quoting, statement classification
server/                       Server Actions + Zod schemas
components/                   grid, row form, confirm dialog, preview, schema banner
middleware.ts                 auth guard
```

## 5. Data Access & Introspection

**`lib/db.ts`**
- One pooled `postgres()` client, `prepare: false`.
- `withTransaction(fn)` — opens a transaction, `SET LOCAL search_path TO <schema>`,
  rolls back on any throw.
- `q.ident(name)` — safely double-quotes an identifier, **rejecting** anything
  that is not a valid identifier (injection guard for dynamic schema/table/column
  names).

**`lib/introspect.ts`** — read-only `pg_catalog`/`information_schema`, cached
per request:
- `listSchemas()` — tenant schemas resolved from the registry
  (`tb_business_unit.db_connection->>'schema'`), plus `CARMEN_SYSTEM` itself;
  excludes `pg_*` / `information_schema`. Falls back to `pg_namespace` if the
  registry can't be read.
- `listTables(schema)` — tables + estimated row counts.
- `describeTable(schema, table)` — columns (type, nullability, default) and the
  **primary key**. PK-less tables are flagged read-only.
- `listForeignKeys(schema)` — child(table,cols) → parent(table,cols) + `ON DELETE`
  action; feeds the cascade engine. Includes cross-schema FKs into `CARMEN_SYSTEM`.

**Type handling:** inputs render by PG type — text, numeric, boolean, timestamps,
`json/jsonb` (validated textarea), `uuid`, arrays — with **NULL as a first-class
value** distinct from empty string. Unknown types fall back to a raw text editor.

## 6. Screens & Flows

1. **`/login`** — secret → session cookie.
2. **`/schemas`** (home) — registry view: business units from
   `CARMEN_SYSTEM.tb_business_unit` (code, name, cluster, active, resolved tenant
   schema, "no schema" badge when null). Entry point — pick a BU to enter its
   tenant schema, or manage `CARMEN_SYSTEM` directly.
3. **`/[schema]/tables`** — tables with estimated row counts; search/filter.
4. **`/[schema]/[table]`** — generic grid: keyset pagination on PK, per-column
   sort/filter, row actions **Edit / Delete**, top-level **Insert**. PK-less
   tables are read-only with an explanatory banner.
   - **Edit / Insert** — form generated from `describeTable` (type-aware inputs,
     explicit NULL toggle); save → diff preview → apply.
   - **Delete** — cascade preview (§7).
5. **`/[schema]/sql`** — wrapped raw SQL console (§9).
6. **`/audit`** — searchable audit log, filterable by schema/table/operation.

A persistent header shows the **active schema** with a color-coded banner
(`CARMEN_SYSTEM` = red "SYSTEM"), so god mode never lets the operator forget
where they are.

## 7. Cascade Delete Engine (`lib/cascade.ts`)

1. **Build the FK graph** for the schema (and across to `CARMEN_SYSTEM` where
   relevant) from `pg_constraint`: `parent(table,cols)` → list of
   `child(table,cols,on_delete)`.
2. **Traverse the blast radius** from the target PK: recursively find child rows
   whose FK columns match, collecting `(table, pk, count)` per level. Cycle guard
   via a visited-set; depth and total-row caps (`CASCADE_MAX_DEPTH`,
   `CASCADE_MAX_ROWS`). On hitting a cap, **stop and warn** — never silently
   truncate.
3. **Order for deletion** — children before parents (reverse topological order);
   required because the FKs are `NO ACTION`.
4. **Preview** — full tree: every affected table with row counts and a sample of
   rows, total count, max depth. For a business unit, also show the linked tenant
   schema with an opt-in **"DROP this tenant schema"** checkbox (default off).
5. **Confirm** — type-to-confirm, scaled to danger: a plain row needs `DELETE`;
   a BU with schema-drop checked needs the **schema name** typed exactly.
6. **Execute** in a single transaction: write audit rows (capturing old values)
   for everything about to die, delete children→parents, optionally
   `DROP SCHEMA "<tenant>" CASCADE`, commit. Any error → full rollback.

**Edge cases:** self-referencing FKs, composite-key FKs, multiple FK paths to the
same row (dedupe by `table+pk`), and rows blocked by an untraversed FK (surface
the real PG error, rolled back).

## 8. Audit Log & Write Path

Audit table in `CARMEN_SYSTEM` (own migration, collision-safe name, e.g.
`tb_god_mode_audit`):

| column | meaning |
|---|---|
| `id` | uuid PK |
| `at` | timestamptz, server default |
| `actor` | session label set at login (or `"god"`) |
| `schema_name`, `table_name` | target |
| `operation` | `INSERT` / `UPDATE` / `DELETE` / `CASCADE_DELETE` / `DROP_SCHEMA` / `RAW_SQL` |
| `pk` | jsonb of the row's primary key |
| `old_values`, `new_values` | jsonb before/after |
| `statement` | the SQL actually executed |

**Write path (single source of truth):** every mutating Server Action runs
through one `withTransaction` helper that (a) reads current row(s) for
`old_values`, (b) executes the change, (c) writes audit rows, (d) commits — so
the change and its audit entry are atomic. Audit-write failure rolls back the
data change. The audit log is **append-only** in the UI.

## 9. Raw SQL Console (`/[schema]/sql`)

The most dangerous surface — wrapped, not bypassed:
- CodeMirror editor; the active schema's `search_path` is set for the transaction.
- On **Run**, statements are classified: read/`SELECT` → execute and show results
  in the grid; mutating (`UPDATE`/`DELETE`/DDL/anything else) → **run inside a
  transaction, show affected-row count + (for UPDATE/DELETE) a preview**, then
  require explicit **Commit** or **Rollback**. Raw SQL cannot escape the
  preview/commit gate.
- Every executed statement is audited (`operation = RAW_SQL`, statement text).
- Clear visual warning on non-SELECT statements; schema banner always visible.

## 10. Error Handling

- Surface the **real PostgreSQL error message** (FK violation, not-null, type
  mismatch, permission denied) — god mode needs the truth, not a generic message.
- Every mutation is transactional → any failure is a clean rollback.
- Connection/pool errors show a clear "can't reach DB" state.
- Identifier-injection attempts are rejected at `q.ident()` before SQL is built.

## 11. Testing

- **Unit (no DB):** `sql-guard` quoting/rejection, statement classifier, cascade
  graph ordering (topological sort, cycle handling, composite keys).
- **Integration (disposable local Postgres / Docker):** seeded mini-schema
  mirroring the real shape (parent + multi-level children with `NO ACTION` FKs) —
  verifies blast-radius, ordered delete, audit rows, rollback-on-error. **No
  destructive tests against `dev.blueledgers.com`.**
- **E2E (light):** login gate; browse a table; edit → preview → apply on a
  seeded row.

## 12. Config / Env

```
SYSTEM_DATABASE_URL, DATABASE_URL    # base connection (schema managed by app)
SYSTEM_SCHEMA_NAME=CARMEN_SYSTEM
GOD_MODE_PASSWORD                    # shared secret
SESSION_SECRET                       # cookie signing
CASCADE_MAX_ROWS, CASCADE_MAX_DEPTH  # blast-radius safety caps
```

## 13. Out of Scope (YAGNI)

Multi-user accounts/roles; soft-delete restore UI; cross-database (different
host) connections; schema-migration authoring; automated undo (the audit log is
the recovery record, not an automatic rollback); real-time collaboration.
