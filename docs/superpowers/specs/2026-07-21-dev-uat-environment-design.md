# Dev UAT environment: `dev:uat`

**Date:** 2026-07-21
**Status:** Approved (design)

## Problem

We want to run the dev server against a **UAT** environment explicitly:

- `bun run dev:uat` → use `.env.uat`

Two things block this today:

1. `package.json` has `dev:local` and `dev:prod` but **no `dev:uat`** — so
   `bun run dev:uat` errors ("script not found").
2. `.env.uat` exists but is a **byte-identical copy of the dev env** — all four of
   `.env`, `.env.local`, `.env.prod`, `.env.uat` point at the same DB
   (`dev.blueledgers.com:6432/postgres`, schema `CARMEN_SYSTEM`) and the same backend
   (`dev.blueledgers.com:4001`). Wiring a `dev:uat` script to that file would produce a
   "UAT" server that silently mutates the dev DB.

This is a god-mode admin tool: every write is permanent and cascade delete is real, so a
UAT environment is only meaningful if `.env.uat` actually points at a **separate** DB and
backend. The goal of this change is a real, distinct UAT — not a cosmetic script.

## Decisions

- **Mirror the `dev:prod` pattern exactly.** Add one `package.json` line:
  `"dev:uat": "bun --env-file=.env.uat next dev"`. No new deps, no port flag (the env-port
  change removed `-p 3305`; `PORT` in the env file drives it).
- **`PORT` stays `3305` in `.env.uat`.** UAT and local run on the same port, so they run
  **one at a time** (chosen over a distinct port). Runs against different DBs, just not
  simultaneously.
- **`.env.uat` gets real, distinct UAT values** (DB URLs + backend, supplied by the user at
  implementation time). The file is gitignored — edited on disk, never committed, never
  echoed back into chat.
- **Scope is dev only** — no `build:uat` / `start:uat` variants, no e2e-on-UAT (YAGNI).

## Change

`package.json` `scripts` (add one line, mirroring `dev:prod`):

```jsonc
// before
"dev":       "bun run dev:local",
"dev:local": "bun --env-file=.env.local next dev",
"dev:prod":  "bun --env-file=.env.prod next dev",

// after
"dev":       "bun run dev:local",
"dev:local": "bun --env-file=.env.local next dev",
"dev:prod":  "bun --env-file=.env.prod next dev",
"dev:uat":   "bun --env-file=.env.uat next dev",
```

`.env.uat` (gitignored, local-only, **not** committed): replace the copied dev values with
real UAT values. At minimum these must differ from dev:

- `SYSTEM_DATABASE_URL`, `DATABASE_URL` — UAT DB (the whole point; must be a different DB)
- `BACKEND_API_BASE_URL`, `BACKEND_API_APP_ID` — UAT gateway, if separate
- `SYSTEM_SCHEMA_NAME`, `GOD_MODE_PASSWORD`, `SESSION_SECRET` — per user's UAT values
- `PORT=3305` — kept

All other scripts (`build`, `start`, `test`, `lint`, `typecheck`) are unchanged.

## Why it works (same mechanics as `dev:local` / `dev:prod`)

1. `bun --env-file=.env.uat` loads `.env.uat` into `process.env` and replaces bun's default
   `.env*` auto-loading for the injected keys.
2. Next's env load order checks `process.env` first and stops once a var is found, so values
   bun injected before Next starts win over `.env.local` on disk.
3. `bun --env-file=.env.uat next …` resolves the `next` binary from `node_modules/.bin`.

## Critical correctness note (key-completeness)

Under `bun --env-file=.env.uat`, Next in dev mode **still reads `.env.local` and the bare
`.env` from disk as a fallback** for any key **absent** from `.env.uat`. So a UAT session can
silently pull a dev value for any key missing from `.env.uat`.

Therefore `.env.uat` **must stay key-complete** with every DB/backend key present and set to a
UAT value. It is key-complete today (it is a full copy), so implementation only changes
**values**, not keys. This is the one way this change can go subtly wrong: if a UAT DB/backend
key were removed or left blank, the server would fall back to the dev DB while appearing to be
UAT. Verification step 3 guards this.

## Docs updated (consistency, committed)

- `README.md` (line 9) — add `dev:uat` (uses `.env.uat`) to the list of explicit dev scripts.
- `CLAUDE.md` (line 10) — extend the commands line to mention `dev:uat` uses `.env.uat`.

## Why this is safer, not just more config

god-mode writes are permanent, and the app shows a persistent live-target bar with the DB
host. Once `.env.uat` points at a real UAT host, that bar displays the UAT host — a visible
confirmation that you are not on dev. A real UAT DB plus the existing target bar is the safety
win; a same-DB `dev:uat` would be the opposite (false confidence).

## Prerequisite

The UAT DB and backend must already exist and be reachable. This change points config at
them; it does not provision any DB.

## Out of scope

- Distinct UAT port / running local + UAT simultaneously (chose one-at-a-time on 3305).
- `playwright.config.ts` running e2e against UAT (still pinned to `.env.local`).
- `build:uat` / `start:uat`, CI wiring, an env-validation/lint script.
- Provisioning the UAT database or backend.

## Verification

1. `bun -e 'const s=require("./package.json").scripts; console.log("dev:uat =>", s["dev:uat"])'`
   prints `dev:uat => bun --env-file=.env.uat next dev`.
2. Boot smoke: background-start `bun run dev:uat`, poll `curl http://localhost:3305/login`
   until it returns a non-000 HTTP code, then stop the server.
3. **Confirm `.env.uat` points at a different DB than dev** — compare the DB host/name in
   `.env.uat` against `.env.local`; they must differ. (The core reason for the change.)
4. `git status --short` confirms `.env.uat` is **not** staged (gitignored); only
   `package.json`, `README.md`, `CLAUDE.md` are committed.
