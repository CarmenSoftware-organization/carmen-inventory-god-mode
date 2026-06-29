# Dev env-file scripts (`dev:local` / `dev:prod`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `bun run dev:local` (uses `.env.local`) and `bun run dev:prod` (uses `.env.prod`) dev-server scripts, with `dev` aliasing `dev:local`.

**Architecture:** `package.json` scripts use `bun --env-file=<file> next dev -p 3305`. `bun --env-file` injects the chosen file into `process.env`, which Next's env loader checks first (and stops once a var is found), so the selected file's values win over `.env.local` read from disk. No new dependencies.

**Tech Stack:** bun 1.3.x, Next.js 16.2.9.

## Global Constraints

- Dev server port is **3305** (not 3000) — copied verbatim from existing scripts.
- Use **bun** only — no `dotenv-cli`, no `cross-env`, no other new dependencies.
- Keep new/changed files lint-clean; do not touch unrelated scripts (`build`, `start`, `test`, `migrate`, `lint`, `typecheck`).
- This tool runs against a **live** Postgres; do not run any command that writes to the database. Verification commands here only read env vars / boot-check, never connect-and-write.

---

### Task 1: package.json dev scripts

**Files:**
- Modify: `package.json:6` (the `"dev"` line inside `scripts`)

**Interfaces:**
- Consumes: nothing.
- Produces: three npm scripts —
  - `dev` → `bun run dev:local`
  - `dev:local` → `bun --env-file=.env.local next dev -p 3305`
  - `dev:prod` → `bun --env-file=.env.prod next dev -p 3305`

> **Note on testing this task:** This is a build-config change, so an automated unit test does not apply. The test cycle is the env-resolution verification in Steps 3–5, which exercises the exact `bun --env-file=<file>` mechanism the scripts depend on. `BACKEND_API_BASE_URL` is currently the only key whose value differs between the two env files, so it is the distinguishing field.

- [ ] **Step 1: Capture the distinguishing values (baseline)**

Run:
```bash
echo -n "local: "; bun --env-file=.env.local -e 'console.log(process.env.BACKEND_API_BASE_URL ?? "(unset)")'
echo -n "prod:  "; bun --env-file=.env.prod  -e 'console.log(process.env.BACKEND_API_BASE_URL ?? "(unset)")'
```
Expected (values may evolve; the point is they DIFFER):
```
local: https://dev.blueledgers.com:4001
prod:  http://localhost:4000
```
If the two lines are identical, STOP — `.env.prod` is not actually distinct from `.env.local`; confirm with the user before proceeding.

- [ ] **Step 2: Edit `package.json` scripts**

In `package.json`, replace this line inside `"scripts"`:
```json
    "dev": "next dev -p 3305",
```
with these three lines:
```json
    "dev": "bun run dev:local",
    "dev:local": "bun --env-file=.env.local next dev -p 3305",
    "dev:prod": "bun --env-file=.env.prod next dev -p 3305",
```
Leave every other script line unchanged.

- [ ] **Step 3: Verify the scripts are well-formed JSON and present**

Run:
```bash
bun -e 'const s=require("./package.json").scripts; for (const k of ["dev","dev:local","dev:prod"]) console.log(k, "=>", s[k])'
```
Expected (proves the JSON parses and all three keys exist):
```
dev => bun run dev:local
dev:local => bun --env-file=.env.local next dev -p 3305
dev:prod => bun --env-file=.env.prod next dev -p 3305
```

- [ ] **Step 4: Verify `dev:prod` selects `.env.prod` (the key behavior)**

This replicates the script's env-file flag with a non-server probe so it does not start a blocking server:
```bash
bun --env-file=.env.prod -e 'console.log("PROD ->", process.env.BACKEND_API_BASE_URL)'
```
Expected: prints the prod value from Step 1 (e.g. `PROD -> http://localhost:4000`), NOT the local value.

- [ ] **Step 5: Verify `dev:local` selects `.env.local`**

```bash
bun --env-file=.env.local -e 'console.log("LOCAL ->", process.env.BACKEND_API_BASE_URL)'
```
Expected: prints the local value from Step 1 (e.g. `LOCAL -> https://dev.blueledgers.com:4001`).

- [ ] **Step 6: Verify the `next` binary still resolves through bun**

```bash
bun --env-file=.env.local next --version
```
Expected: `Next.js v16.2.9` (confirms `bun --env-file=… next …` runs the Next CLI; `--version` does not connect to the DB).

- [ ] **Step 7 (optional manual smoke — do once): boot each variant and stop it**

Only if you want a full end-to-end check. In a terminal:
```bash
bun run dev:prod
```
Confirm it logs `Local: http://localhost:3305`, then press Ctrl-C. Repeat with `bun run dev` and `bun run dev:local`. (This boots the real app; it performs no writes. Skip if Steps 3–6 passed and you trust the mechanism.)

- [ ] **Step 8: Commit**

```bash
git add package.json
git commit -m "feat(dev): add dev:local/dev:prod env-file scripts; dev aliases dev:local

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Documentation

**Files:**
- Modify: `README.md:10`
- Modify: `CLAUDE.md:10`

**Interfaces:**
- Consumes: the script names from Task 1 (`dev`, `dev:local`, `dev:prod`).
- Produces: nothing (docs only).

- [ ] **Step 1: Update `README.md` setup step 4**

Replace:
```markdown
4. `bun run dev`
```
with:
```markdown
4. `bun run dev` (uses `.env.local`). Use `bun run dev:local` / `bun run dev:prod` to pick `.env.local` vs `.env.prod` explicitly.
```

- [ ] **Step 2: Update `CLAUDE.md` commands line**

Replace the line:
```markdown
- `bun run dev`/`start` — port **3305** (not 3000). `bun run test` (Vitest — never `bun test`), `bun run typecheck`, `bun run lint`, `bun run migrate`.
```
with:
```markdown
- `bun run dev`/`start` — port **3305** (not 3000). `bun run dev` = `dev:local` (`.env.local`); `bun run dev:prod` uses `.env.prod`. `bun run test` (Vitest — never `bun test`), `bun run typecheck`, `bun run lint`, `bun run migrate`.
```

- [ ] **Step 3: Verify the edits landed**

```bash
grep -n "dev:prod" README.md CLAUDE.md
```
Expected: one match in each file referencing `dev:prod`.

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: document dev:local/dev:prod scripts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notes for the implementer

- `playwright.config.ts:22` runs `bun run dev`; because `dev` now aliases `dev:local` (still `.env.local`), Playwright behavior is unchanged — no edit needed there.
- Do NOT change `.gitignore`; `.env*` is already ignored, so `.env.prod` stays uncommitted.
- Keep `.env.prod` key-complete with `.env.local`. A key present in `.env.local` but missing from `.env.prod` would be absent from `process.env` under `dev:prod`, and Next (NODE_ENV=development) would read it from `.env.local` on disk as a fallback — silently leaking a local value into a prod session.
