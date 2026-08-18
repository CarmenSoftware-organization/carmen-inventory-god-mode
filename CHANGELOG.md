# Changelog

รูปแบบตาม [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) และเลขเวอร์ชันตาม
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) วันที่เป็น UTC

รายการเขียนด้วยมือ — `bun run build:bump` เขียนร่างจาก commit ไว้ใน `[Unreleased]` แล้วหยุดให้แก้
ก่อน จากนั้นรอบถัดไปจึงย้ายรายการที่แก้แล้วลงหัวข้อเวอร์ชันพร้อมตัดรุ่น รายการของรุ่นก่อน v0.4.0
คัดมาจาก GitHub Releases ที่เขียนไว้ตอนนั้น

## [Unreleased]

<!-- build:bump เขียนร่างจาก commit ไว้ตรงนี้ แก้ให้เป็นภาษาคนก่อนตัดรุ่น -->

## [0.3.0] — 2026-08-18

Every god-mode page that reads the business-unit registry was crashing. Fixing that surfaced a
second, quieter problem: the tool could drop a schema on the wrong database entirely.

### Fixed

**Registry pages crashed with `column "db_connection" does not exist`** (#17)
The upstream platform schema removed `tb_business_unit.db_connection` (jsonb) and split it into
`db_schema` plus `database_pool_id` → `tb_database_pool`. Every registry query still asked for the
old column. The integration fixtures created the table themselves with the old shape, which is why
the suite stayed green while the live database had moved on.

**An abandoned migration wedged `/platform-migrations`** (#23)
Closing the tab mid-run left the page answering "A platform migration is already running" to
everyone until the server restarted, with no subprocess alive. Enqueueing on the cancelled response
stream threw, that throw reached `runProcess`'s close handler before `resolve()` on the same line,
and the promise never settled — so the lock's `finally` never ran.

### Added

**Tenant drops are checked against the registry's database pool** (#19, closes #18)
god-mode holds one connection and resolved tenant schemas by name alone, so a business unit moved to
a different pool would have had its `DROP SCHEMA` executed against whatever schema of that name
existed on the connected host — no error, just a wrong target. Drops now compare host, port and
database against `DATABASE_URL` and refuse a mismatch. Hostnames are compared literally: guessing
that two names are one host is the assumption the check exists to remove. The mismatch is surfaced
in the business units table and on the delete page, so it reads before the destructive step rather
than as a 409 at confirm time.

**`db:check.api-system-permission` in the platform migrations catalog** (#17)
A new upstream script that the reverse drift test had been flagging as unwired.

### Internal

- The e2e suite is green for the first time (#21, #22): one shared login helper instead of two
  copies that drifted apart, locators updated for `role="tab"` and the press-and-hold confirm, and
  a success assertion that no longer matches the subprocess log and fails a run that exited 0.
- Every change now reaches `main` through a pull request (#20).
- Tests: 227 → 247.

## [0.2.0] — 2026-08-05

The first tagged release: 234 commits from 2026-06-25 to 2026-08-05, covering everything the tool
did before versioning began. Notes reconstructed from the commit history.

Carmen Inventory God Mode is an admin console over a **live** Postgres. Every write is permanent, so
most of what follows is machinery for making destructive work legible before it happens.

### Browsing and editing

- Registry home, schema banner, protected app shell, table list
- Generic row grid with keyset pagination, multi-select, and "Delete N selected"
- Insert and edit forms with type coercion
- Runtime catalog introspection (schemas, tables, columns, foreign keys)
- Raw SQL console with preview/commit and an indeterminate running bar
- postgres.js client and transaction helper, typed env config via zod

### Destructive operations

- FK-graph cascade **blast radius** and executor, with topological table ordering, deterministic FK
  listing, refusal on FK cycles, and caps that refuse rather than truncate
- `computeBlastRadiusMany` / `executeCascadeMany` — all-or-nothing batch cascade
- Type-to-confirm delete preview; the phrase becomes the schema name when a tenant schema is dropped
- Cluster hard delete with multi-schema drop; reusable soft-delete/restore with audit
- Identifier guard and statement classifier so dynamic SQL cannot be assembled unquoted
- Danger-zone operations gated behind `ALLOW_DANGER_OPS`, in both the page and the API

### Streaming progress

`streamOperation` emits NDJSON; the client reads it through `useOperationStream` + `OperationProgress`.
Long operations report through an optional `onProgress`, and the cascade engine emits events as it
works. Delete moved off server actions onto this streaming route.

### Platform migrations

A `/platform-migrations` page that runs the platform package's own scripts as subprocesses, with a
catalog of operations, a schema selector that injects the chosen schema into the subprocess URLs,
schema-name validation, a bootstrap gate for new schemas, a concurrent-run lock, and per-run audit.

### Auth and audit

- Shared-secret auth with iron-session and a route guard; gateway auth against the backend API
- Audit log storage with its own migration, write paths that self-ensure the audit table, and schema
  bootstrap recorded as its own `CREATE_SCHEMA` action
- Audit viewer with keyset pagination and change diffs opened in a Sheet

### Tooling

`bun run build:bump` — cuts a release locally: bumps `package.json`, commits `chore(release): vX.Y.Z`,
and creates an annotated tag. It never pushes, runs only on a clean `main` that is not behind its
upstream, and gates on typecheck and lint. This tag is its first use.

Also `dev:uat` for a third environment file, and a fix to skip lifecycle scripts on Vercel install.
