# Dev UAT environment (`dev:uat`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `bun run dev:uat` dev-server script that runs against a real, separate UAT database/backend via `.env.uat`.

**Architecture:** Mirror the existing `dev:prod` pattern exactly — one `package.json` script (`bun --env-file=.env.uat next dev`) plus real UAT values in the gitignored `.env.uat`. No new dependencies; native bun `--env-file` injects the file into `process.env` and Next's loader (checks `process.env` first) uses it.

**Tech Stack:** bun, Next.js 16 (`next dev`), package.json scripts, dotenv-style `.env.uat`.

## Global Constraints

- `PORT=3305` stays in every env file; `dev:uat` runs on 3305 → local and UAT run **one at a time** (no distinct port).
- Mirror `dev:prod` exactly: `"dev:uat": "bun --env-file=.env.uat next dev"`. No `-p` flag, no new deps.
- `.env.uat` is **gitignored** — edit on disk, never `git add`, never echo its secret values into chat/logs.
- `.env.uat` must stay **key-complete** with `.env.local`: any key absent from `.env.uat` silently falls back to the dev value that Next reads from `.env.local`/`.env` on disk.
- Only `package.json`, `README.md`, `CLAUDE.md` are committed by this change.

---

### Task 1: Add `dev:uat` script + update docs

**Files:**
- Modify: `package.json` (scripts block)
- Modify: `README.md:9`
- Modify: `CLAUDE.md:10`

**Interfaces:**
- Consumes: nothing.
- Produces: npm script `dev:uat` → `bun --env-file=.env.uat next dev` (Task 2's boot smoke depends on it existing).

- [ ] **Step 1: Verify `dev:uat` is absent (red)**

Run:
```bash
bun -e 'const s=require("./package.json").scripts; console.log("dev:uat =>", s["dev:uat"])'
```
Expected: `dev:uat => undefined`

- [ ] **Step 2: Add the script to `package.json`**

Edit `package.json` — insert the `dev:uat` line right after `dev:prod`:

```jsonc
// before
    "dev:prod": "bun --env-file=.env.prod next dev",
    "build": "next build",

// after
    "dev:prod": "bun --env-file=.env.prod next dev",
    "dev:uat": "bun --env-file=.env.uat next dev",
    "build": "next build",
```

- [ ] **Step 3: Verify `dev:uat` now resolves (green)**

Run:
```bash
bun -e 'const s=require("./package.json").scripts; console.log("dev:uat =>", s["dev:uat"])'
```
Expected: `dev:uat => bun --env-file=.env.uat next dev`

- [ ] **Step 4: Update `README.md:9`**

Replace exactly:
```
3. `bun run dev` (uses `.env.local`). Use `bun run dev:local` / `bun run dev:prod` to pick `.env.local` vs `.env.prod` explicitly. The server port comes from `PORT` in the chosen env file (3305 by default).
```
with:
```
3. `bun run dev` (uses `.env.local`). Use `bun run dev:local` / `bun run dev:prod` / `bun run dev:uat` to pick `.env.local` / `.env.prod` / `.env.uat` explicitly. The server port comes from `PORT` in the chosen env file (3305 by default).
```

- [ ] **Step 5: Update `CLAUDE.md:10`**

In the commands line, replace exactly:
```
`bun run dev:prod` uses `.env.prod`.
```
with:
```
`bun run dev:prod` uses `.env.prod`; `dev:uat` uses `.env.uat`.
```

- [ ] **Step 6: Confirm exactly three files changed**

Run:
```bash
git status --short
```
Expected: only ` M package.json`, ` M README.md`, ` M CLAUDE.md` (no `.env*` staged or listed as changed by this task).

- [ ] **Step 7: Commit**

```bash
git add package.json README.md CLAUDE.md
git commit -m "feat: add dev:uat dev-server script (.env.uat)"
```

---

### Task 2: Configure `.env.uat` with real UAT values + boot smoke

Local-only, **not committed** (`.env.uat` is gitignored). This is the task that makes UAT *real* rather than a same-DB alias.

**Files:**
- Modify: `.env.uat` (gitignored, on-disk only)

**Interfaces:**
- Consumes: `dev:uat` script from Task 1.
- Produces: nothing committed.

- [ ] **Step 1: Obtain the real UAT values from the user (BLOCKING)**

Do not proceed without them. Ask for and collect:
- `SYSTEM_DATABASE_URL` and `DATABASE_URL` — the UAT DB (must be a different DB than dev).
- `BACKEND_API_BASE_URL` and `BACKEND_API_APP_ID` — UAT gateway (or "same as dev").
- `SYSTEM_SCHEMA_NAME`, `GOD_MODE_PASSWORD`, `SESSION_SECRET` — UAT values (or "same as dev").

Never echo the received secret values back into chat.

- [ ] **Step 2: Record the current key set (for the completeness check)**

Run:
```bash
grep -oE '^[A-Z_]+=' .env.local | sort -u
```
Expected (baseline key set to match): `BACKEND_API_APP_ID=`, `BACKEND_API_BASE_URL=`, `DATABASE_URL=`, `GOD_MODE_PASSWORD=`, `PORT=`, `SESSION_SECRET=`, `SYSTEM_DATABASE_URL=`, `SYSTEM_SCHEMA_NAME=`.

- [ ] **Step 3: Write the UAT values into `.env.uat`**

Edit `.env.uat` in place. Replace the copied dev values with the UAT values from Step 1. Keep **every** key (do not delete any) and keep `PORT=3305`. Shape (values are the user's UAT values, shown here masked):

```dotenv
SYSTEM_DATABASE_URL=postgresql://<uat-user>:<uat-pass>@<uat-host>:<port>/<uat-db>
DATABASE_URL=postgresql://<uat-user>:<uat-pass>@<uat-host>:<port>/<uat-db>
SYSTEM_SCHEMA_NAME=<uat-schema-or-CARMEN_SYSTEM>
GOD_MODE_PASSWORD=<uat-or-same>
SESSION_SECRET=<uat-or-same>
BACKEND_API_BASE_URL=<uat-gateway-or-same>
BACKEND_API_APP_ID=<uat-app-id-or-same>

PORT=3305
```

- [ ] **Step 4: Verify key-completeness (`.env.uat` has the same keys as `.env.local`)**

Run:
```bash
diff <(grep -oE '^[A-Z_]+=' .env.local | sort -u) <(grep -oE '^[A-Z_]+=' .env.uat | sort -u) && echo "KEYS MATCH" || echo "KEYS DIFFER — add the missing key(s) to .env.uat"
```
Expected: `KEYS MATCH` (a missing key would silently fall back to the dev value).

- [ ] **Step 5: Verify the UAT DB actually differs from dev**

Run (masks passwords; compares the DB URLs):
```bash
masked() { grep -E '^(SYSTEM_)?DATABASE_URL=' "$1" | sed -E 's#(://[^:]+:)[^@]+@#\1***@#'; }
diff <(masked .env.local) <(masked .env.uat) >/dev/null && echo "SAME DB URLS — UAT would hit dev DB. STOP and fix .env.uat." || echo "OK: UAT DB differs from dev"
```
Expected: `OK: UAT DB differs from dev`. If it prints `SAME DB URLS`, stop — the change is pointless and unsafe until `.env.uat` points elsewhere.

- [ ] **Step 6: Boot smoke against UAT on port 3305**

Start the server in the background, poll `/login`, then stop it. (Run the whole block backgrounded — foreground `sleep` is blocked in this harness.)
```bash
bun run dev:uat &
DEV_PID=$!
code=000
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3305/login || echo 000)
  [ "$code" != "000" ] && break
  sleep 1
done
echo "GET /login -> HTTP $code"
kill "$DEV_PID" 2>/dev/null
```
Expected: `GET /login -> HTTP <non-000>` (200, or a 302/307 redirect to the login page). Confirms `dev:uat` boots on 3305 with `.env.uat` loaded.

- [ ] **Step 7: Confirm `.env.uat` is NOT staged**

Run:
```bash
git status --short
```
Expected: `.env.uat` does **not** appear (it is gitignored). No commit for this task.

---

## Self-Review

- **Spec coverage:**
  - `package.json` `dev:uat` line → Task 1 Steps 2–3. ✓
  - `.env.uat` real UAT values, key-complete, PORT 3305 → Task 2 Steps 3–5. ✓
  - Docs (`README.md`, `CLAUDE.md`) → Task 1 Steps 4–5. ✓
  - Verification: bun -e script check → T1 S3; boot smoke → T2 S6; DB-differs → T2 S5; `.env.uat` not staged → T2 S7. ✓
  - Critical correctness (key-completeness fallback) → Global Constraints + T2 S4. ✓
  - Out of scope (distinct port, playwright-on-uat, build/start:uat, DB provisioning) → not implemented, correct. ✓
- **Placeholder scan:** `<uat-...>` tokens in Task 2 Step 3 are intentional user-supplied secret slots, not plan placeholders — every executable step has concrete commands. ✓
- **Type consistency:** script name `dev:uat` and command string `bun --env-file=.env.uat next dev` used identically in T1 S2, S3, and T2 dependency. ✓
