@AGENTS.md

# Carmen Inventory God Mode — working notes

Admin tool over a **live** Postgres; every write is permanent and `.env.local`
points at the real dev DB — treat cascade delete / `DROP SCHEMA` as prod data.
(Setup & safety: README.md.)

## Commands
- `bun run dev`/`start` — port **3305** (not 3000), set via `PORT` in the env file. `bun run dev` = `dev:local` (`.env.local`); `bun run dev:prod` uses `.env.prod`; `dev:uat` uses `.env.uat`. `bun run test` (Vitest — never `bun test`), `bun run typecheck`, `bun run lint`.
- E2E: `node_modules/.bin/playwright test` (auto-starts/reuses the dev server). `bun <file.ts>` auto-loads `.env.local`.
- `/platform-migrations` page runs the `prisma-shared-schema-platform` package's own scripts via subprocess (`lib/run-process.ts`, `lib/platform-package.ts`, `lib/platform-migrations.ts`, `app/api/ops/platform-migrate/route.ts`); needs `PLATFORM_PACKAGE_DIR` + `SYSTEM_DIRECT_URL`, `bun`/`psql` on PATH. Spec: `docs/superpowers/specs/2026-06-29-platform-migrations-page-design.md`.
- `bun run build:bump` — cut a release: bumps `package.json`, makes a `chore(release): vX.Y.Z` commit and an annotated `vX.Y.Z` tag. **Local only — it never pushes.** Runs on `main` with a clean tree, gates on `typecheck` + `lint`, and prompts for patch/minor/major; pass the level (`bun run build:bump patch`) to skip the prompt. Spec: `docs/superpowers/specs/2026-08-05-build-bump-design.md`.

## Tests
- `.test.ts` → node; `.test.tsx` → jsdom; `.int.test.ts` → embedded-postgres via `@/test/pg` `startPg()` (fresh container/file, `fileParallelism: false`, 60s timeout).
- Route/int tests mock `@/lib/session` (`requireAuth` throws on unauth) + `next/cache` (`revalidatePath`); test a handler by importing `POST` and passing a `Request`.
- `bun run lint` is **clean** repo-wide — keep it that way. Type `postgres` query results via `(await sql.unsafe(...)) as unknown as { … }[]`; pass dynamic `unknown[]` SQL params as `as (string | number | boolean | null)[]` (don't reach for `any`).

## Postgres gotchas
- Unquoted identifiers are lowercased (`CREATE SCHEMA Foo`→`foo`); quote to match `ident()`/`qualified()` from `lib/sql-guard`.
- A `postgres` Row won't cast to a typed shape — use `as unknown as { … }` (TS2352).
- A JS string passed as `$n::jsonb` is double-encoded; embed JSON inline as `'{…}'::jsonb`.

## Layout & patterns
- `lib/` = DB/domain helpers, `server/` = `"use server"` actions, `app/api/**/route.ts` = handlers. SQL via `lib/sql-guard`; audit every write via `lib/audit`.
- **Streaming progress**: `lib/progress.ts` `streamOperation()` streams NDJSON; long ops take optional `onProgress`; client = `useOperationStream` + `<OperationProgress>`; `app/api/ops/*` handlers re-run `requireAuth` + re-validate the confirm phrase before streaming. Spec: `docs/superpowers/specs/2026-06-26-streaming-progress-design.md`.
- E2E against the live DB must self-seed throwaway rows (unique prefix) + clean up in before/afterAll — see `e2e/streaming-delete.spec.ts`.
- `.superpowers/` = SDD orchestration scratch (gitignored).
