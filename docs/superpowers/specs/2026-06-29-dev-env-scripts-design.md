# Dev env-file scripts: `dev:local` / `dev:prod`

**Date:** 2026-06-29
**Status:** Approved (design)

## Problem

The dev server has a single `dev` script (`next dev -p 3305`) that runs against
whatever bun auto-loads — in practice `.env.local`, the real dev DB. We now also
have a `.env.prod` (same keys, prod credentials) and want to start the dev server
against either environment explicitly:

- `bun run dev:local` → use `.env.local`
- `bun run dev:prod` → use `.env.prod`

This is a god-mode admin tool: every write is permanent and cascade delete is real,
so which environment the server points at must be unambiguous and selected on purpose.

## Decisions

- **`dev` becomes an alias of `dev:local`** — keeps existing callers working
  (`playwright.config.ts` runs `bun run dev`; `README.md` and `CLAUDE.md` reference it).
- **No prod safety guardrail** in this change — the explicit `:prod` script name
  signals intent; a startup/UI warning can be added later as a separate change.
- **Scope is dev only** — no `build:prod` / `start:prod` variants (YAGNI).

## Change

`package.json` `scripts`:

```jsonc
// before
"dev": "next dev -p 3305",

// after
"dev":       "bun run dev:local",
"dev:local": "bun --env-file=.env.local next dev -p 3305",
"dev:prod":  "bun --env-file=.env.prod next dev -p 3305",
```

All other scripts (`build`, `start`, `test`, `migrate`, `lint`, `typecheck`) are unchanged.

## Why it works (validated)

1. `bun --env-file=<file>` loads that file into `process.env` and **replaces** bun's
   default `.env*` auto-loading. Verified: with `--env-file=.env.prod`, a var present
   only in `.env.local` resolved to `undefined` (the local file was not also loaded).
2. Next's env load order checks **`process.env` first and stops once a var is found**
   (`node_modules/next/dist/docs/01-app/02-guides/environment-variables.md`, "Environment
   Variable Load Order"). So values bun injected before Next starts win over `.env.local`
   on disk — no shadowing.
3. `bun --env-file=<file> next …` resolves the `next` binary from `node_modules/.bin`.
   Verified: `bun --env-file=.env.local next --version` prints `Next.js v16.2.9`.
4. `.env.local` and `.env.prod` currently have **identical keys**, so under `dev:prod`
   no variable falls back to a local value.

No new dependencies — pure native bun plus the existing Next env loader. No
`dotenv-cli`, no `cross-env`.

## Behavior preserved

`bun run dev` → `dev:local` → `.env.local` → real dev DB, exactly as today. Unchanged
callers continue to work:

- `playwright.config.ts:22` — `webServer.command: "bun run dev"`
- `README.md:10` — step `4. bun run dev`
- `CLAUDE.md:10` — commands line

## Docs updated (consistency)

- `README.md` — note that `bun run dev` / `dev:local` use `.env.local` and `dev:prod`
  uses `.env.prod`.
- `CLAUDE.md` — extend the commands line to mention `dev:local` / `dev:prod`.

## Maintenance note

Keep `.env.prod` key-complete with `.env.local`. If a key exists in `.env.local` but
not `.env.prod`, then under `dev:prod` that key would be absent from `process.env`, and
Next (running with `NODE_ENV=development`) would still read `.env.local` (and the bare
`.env`) from disk as a fallback for it — silently pulling a local value into a prod
session. Today all of `.env`, `.env.local`, and `.env.prod` have identical key sets, so
this is a guardrail for future edits, not a current bug.

## Out of scope

- Prod safety guardrail (startup banner / UI warning).
- `build:prod` / `start:prod` and any non-dev env switching.

## Verification

- `bun run dev:local` starts on port 3305 against the local DB (manual / existing Playwright).
- `bun run dev:prod` starts on port 3305 against the prod DB (manual smoke).
- `bun run dev` behaves identically to `dev:local`.
- `node_modules/.bin/playwright test` still launches the server via `bun run dev`.
