# Carmen Inventory God Mode

Direct admin tool for the Carmen inventory PostgreSQL database. **Every change is
permanent — there is no undo.** The audit log is the only recovery record.

## Setup
1. `cp .env.example .env.local` and fill in `GOD_MODE_PASSWORD`, `SESSION_SECRET` (>=32 chars), and the DB URLs.
2. `bun install`
3. `bun run migrate`  # creates CARMEN_SYSTEM.tb_god_mode_audit
4. `bun run dev` (uses `.env.local`). Use `bun run dev:local` / `bun run dev:prod` to pick `.env.local` vs `.env.prod` explicitly.

## Tests
- `bun run test` — unit + integration (integration uses embedded-postgres; no Docker needed). (Use `bun run test`, NOT `bun test` — the latter invokes Bun's built-in runner and cannot run our Vitest suite.)
- `bunx playwright test` — light E2E.

## Safety
- Shared-secret login; cookie session.
- Deletes show a blast-radius preview and require typing a confirm phrase.
- Deleting a business unit can optionally `DROP SCHEMA` its tenant database (off by default; requires typing the schema name).
- Raw SQL writes require an explicit Commit after a preview.
- `CASCADE_MAX_ROWS` / `CASCADE_MAX_DEPTH` cap the blast radius; an over-cap cascade is refused.
