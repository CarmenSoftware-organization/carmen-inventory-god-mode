# Env-driven dev/start port (`PORT` in `.env.*`)

**Date:** 2026-06-29
**Status:** Approved (design)

## Problem

The dev-server port `3305` is hardcoded as `-p 3305` in the `dev:local`, `dev:prod`,
and `start` scripts. We want the port to come from a `PORT` variable in the env files,
so each environment can control its own port without editing `package.json`.

## Decisions

- **`PORT=3305` in every env file** — `.env`, `.env.local`, `.env.prod`, and
  `.env.example`. Same value everywhere; this centralizes the existing constant out of
  the scripts. (Local must stay 3305 regardless — Playwright hardcodes it.)
- **`start` is updated too**, not just the dev scripts.
- Behavior is unchanged from today: everything still serves on 3305.

## How the port resolves

`next dev` and `next start` resolve the port in this order (Next CLI reference,
`node_modules/next/dist/docs/01-app/03-api-reference/06-cli/next.md:70`):

1. `-p` / `--port` flag
2. `PORT` environment variable
3. default `3000`

So removing `-p 3305` lets `PORT` take effect.

## Change

### `package.json` scripts

```jsonc
// before
"dev:local": "bun --env-file=.env.local next dev -p 3305",
"dev:prod":  "bun --env-file=.env.prod next dev -p 3305",
"start":     "next start -p 3305",

// after
"dev:local": "bun --env-file=.env.local next dev",
"dev:prod":  "bun --env-file=.env.prod next dev",
"start":     "next start",
```

`dev` (`bun run dev:local`), `build`, `test`, `migrate`, `lint`, `typecheck` are unchanged.

### Env files

Add `PORT=3305` to `.env`, `.env.local`, `.env.prod`. Add to `.env.example` with a
comment:

```bash
# Dev/start server port (scripts read this; falls back to Next's default 3000 if unset)
PORT=3305
```

## Why each path lands on 3305

- **`dev:local` / `dev:prod`**: `bun --env-file=.env.<x>` loads that file (including
  `PORT`) into `process.env` before Next starts; with no `-p` flag, `next dev` uses
  `PORT`. Validated mechanism from the prior dev-scripts change — `--env-file` injects
  into `process.env`, which Next reads first.
- **`start`**: has no `--env-file`; when run via `bun run start`, bun auto-loads
  `.env.local` (now containing `PORT=3305`) into `process.env`, and `next start` uses it.

## Maintenance note

`bun --env-file` loads **only** the named file, so `PORT` must be present in every env
file a script consumes (`.env.local`, `.env.prod`). If `PORT` is missing from one, that
environment silently falls back to Next's default **3000**. This is the same
key-completeness rule that already applies to the other env vars (keep `.env.local` /
`.env.prod` / `.env` key-complete with each other).

## What is committed vs. local-only

`.env`, `.env.local`, `.env.prod` are gitignored (`.env*`), so edits to them are
local-machine only and do **not** appear in any commit/PR. The version-controlled
changes are:

- `package.json` (scripts)
- `.env.example` (documents the new `PORT` key)
- `README.md`, `CLAUDE.md` (docs)

## Docs

- `README.md` / `CLAUDE.md` — note the dev/start port now comes from `PORT` in the env
  file (still 3305 by default).

## Out of scope

- Per-environment *different* ports (all are 3305 for now; the mechanism supports
  differing values later by just changing `PORT` in a file).
- Any change to `build` or to Playwright's hardcoded `3305`.

## Verification

- `bun -e` prints the three updated scripts with no `-p` flag.
- `bun run dev:local` boots and responds on `http://localhost:3305` (bounded smoke:
  background-start, curl `/login`, kill).
- `grep -n PORT .env.local .env.prod .env .env.example` shows `PORT=3305` in each.
- `node_modules/.bin/playwright test` still launches the server via `bun run dev`.
