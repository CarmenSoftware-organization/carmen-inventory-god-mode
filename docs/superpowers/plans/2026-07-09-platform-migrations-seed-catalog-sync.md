# Platform migrations seed catalog sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync the `/platform-migrations` operation catalog with the real seed scripts of `@repo/prisma-shared-schema-platform` — add `db:seed.currency-iso`, drop the scriptless `db:seed` / `db:seed:reset` ops, and add a drift guard test.

**Architecture:** `CATALOG` in `lib/platform-migrations.ts` is a static, data-driven list; the page and client component render whatever ops it contains, so this is a data + test change with no UI/logic code touched. A new node-env test reads the real package `package.json` and asserts every `kind:"script"` op maps to an existing script, skipping when the package is absent.

**Tech Stack:** TypeScript, Next.js (this repo's fork), Vitest, Bun.

## Global Constraints

- Run tests with `bun run test` (Vitest) — **never** `bun test`. Single file: `bun run test <path>`; single test: `bun run test <path> -t "<name pattern>"`.
- `bun run lint` is clean repo-wide — keep every touched file lint-clean.
- `.test.ts` runs in node env; `.test.tsx` in jsdom. The new drift test is `.test.ts` (no postgres, no jsdom).
- Commit after each task. We are on `main`; Task 0 moves work onto a feature branch before any commit.
- Spec: `docs/superpowers/specs/2026-07-09-platform-migrations-seed-catalog-sync-design.md`.

---

### Task 0: Create the feature branch

**Files:** none (git only)

- [ ] **Step 1: Create and switch to the branch**

Run:
```bash
git checkout -b feat/platform-migrations-seed-catalog-sync
```
Expected: `Switched to a new branch 'feat/platform-migrations-seed-catalog-sync'`

- [ ] **Step 2: Confirm the tree is clean and on the new branch**

Run:
```bash
git status --short && git branch --show-current
```
Expected: no uncommitted changes; branch name `feat/platform-migrations-seed-catalog-sync`.

---

### Task 1: Add the `seed-currency-iso` catalog op

Add the one real seed script that is missing from the catalog. Keep the existing `seed` / `seed-reset` ops untouched here (removed in Task 2) so the suite stays green.

**Files:**
- Modify: `lib/platform-migrations.ts:40` (seed group — insert new op above `seed-permission`)
- Test: `lib/__tests__/platform-migrations.test.ts:9-16` (expected-ids list)

**Interfaces:**
- Consumes: the existing `seed(id, run, label)` factory in `lib/platform-migrations.ts:18-20`, which produces `{ id, group: "seed", label, kind: "script", run, writes: true, destructive: false }`.
- Produces: a catalog op with `id: "seed-currency-iso"`, `run: "db:seed.currency-iso"`, `label: "Seed: currency ISO codes"`, discoverable via `findOp("seed-currency-iso")`.

- [ ] **Step 1: Update the expected-ids test to require the new op**

In `lib/__tests__/platform-migrations.test.ts`, in the test `"catalog exposes the expected operation ids across groups"`, change the line (currently line 12):

```ts
    "seed", "seed-permission", "seed-platform-super-admin",
```
to:
```ts
    "seed", "seed-currency-iso", "seed-permission", "seed-platform-super-admin",
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
bun run test lib/__tests__/platform-migrations.test.ts -t "catalog exposes the expected operation ids"
```
Expected: FAIL — the received ids array does not contain `"seed-currency-iso"`.

- [ ] **Step 3: Add the op to the catalog**

In `lib/platform-migrations.ts`, in the seed block of `CATALOG`, insert the new op as the **first** seed (immediately above the `seed("seed", ...)` line, currently line 40):

```ts
  seed("seed-currency-iso", "db:seed.currency-iso", "Seed: currency ISO codes"),
  seed("seed", "db:seed", "Seed: baseline"),
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
bun run test lib/__tests__/platform-migrations.test.ts -t "catalog exposes the expected operation ids"
```
Expected: PASS.

- [ ] **Step 5: Run the full suite to confirm nothing else broke**

Run:
```bash
bun run test
```
Expected: all tests pass (the new op satisfies the gate-invariants loop; no test asserts an exact op count).

- [ ] **Step 6: Commit**

```bash
git add lib/platform-migrations.ts lib/__tests__/platform-migrations.test.ts
git commit -m "feat(platform-migrations): add db:seed.currency-iso seed op

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Remove the scriptless `seed` and `seed-reset` ops

Drop the two ops whose scripts don't exist in the package, extend the regression guard, and retarget the three test assertions that referenced them. All edits land in one commit so the suite is never left red.

**Files:**
- Modify: `lib/platform-migrations.ts` — remove the `seed` baseline op (~line 41 after Task 1's insertion) and the `seed-reset` danger op (~lines 57-58). Match by the exact code strings below, not line number.
- Test: `lib/__tests__/platform-migrations.test.ts` (expected-ids list ~line 12/15; regression guard ~line 31-36; buildArgv test ~line 64-66)
- Test: `components/__tests__/platform-migrations.test.tsx:82-86` (label-fallback test)

**Interfaces:**
- Consumes: `findOp` and `buildArgv` from `lib/platform-migrations.ts`; `seed-permission` op (`run: "db:seed.permission"`) as the retarget sample; `seed-currency-iso` op label `"Seed: currency ISO codes"` from Task 1.
- Produces: `findOp("seed")` and `findOp("seed-reset")` both return `undefined`; the `danger` group now contains only `migrate-reset`.

- [ ] **Step 1: Retarget the assertions that reference the ops-to-remove (still green)**

These edits keep passing while the ops still exist; they remove the tests' dependency on the ops before deletion.

In `lib/__tests__/platform-migrations.test.ts`, expected-ids test — drop `"seed"` and `"seed-reset"`:

Change (from Task 1's state):
```ts
    "seed", "seed-currency-iso", "seed-permission", "seed-platform-super-admin",
    "seed-platform-role", "seed-report-template-upload",
    "check-permission", "check-platform-permission", "check-platform-role-permission",
    "migrate-reset", "seed-reset",
```
to:
```ts
    "seed-currency-iso", "seed-permission", "seed-platform-super-admin",
    "seed-platform-role", "seed-report-template-upload",
    "check-permission", "check-platform-permission", "check-platform-role-permission",
    "migrate-reset",
```

In the same file, the `"buildArgv ignores bu/only on ops that do not accept them"` test — change:
```ts
  expect(buildArgv(findOp("seed")!, { bu: "T03", only: "x" })).toEqual(["run", "db:seed"]);
```
to:
```ts
  expect(buildArgv(findOp("seed-permission")!, { bu: "T03", only: "x" })).toEqual(["run", "db:seed.permission"]);
```

In `components/__tests__/platform-migrations.test.tsx`, the `"renders the label only when an op has no scriptInfo entry"` test — change:
```ts
  expect(screen.getByText("Seed: baseline")).toBeInTheDocument();
```
to:
```ts
  expect(screen.getByText("Seed: currency ISO codes")).toBeInTheDocument();
```

- [ ] **Step 2: Run the affected tests to confirm they still pass (ops still present)**

Run:
```bash
bun run test lib/__tests__/platform-migrations.test.ts components/__tests__/platform-migrations.test.tsx
```
Expected: PASS — the retargeted assertions reference ops that still exist.

- [ ] **Step 3: Extend the regression guard to require the ops be absent (fails now)**

In `lib/__tests__/platform-migrations.test.ts`, the test `"catalog does not offer ops whose scripts are absent from the package"` — replace its body with:

```ts
test("catalog does not offer ops whose scripts are absent from the package", () => {
  // These reference db:* scripts that don't exist in
  // @repo/prisma-shared-schema-platform, so running them can only fail.
  expect(findOp("seed-application")).toBeUndefined();
  expect(findOp("mock-reset")).toBeUndefined();
  expect(findOp("seed")).toBeUndefined();
  expect(findOp("seed-reset")).toBeUndefined();
});
```

- [ ] **Step 4: Run the guard to verify it fails**

Run:
```bash
bun run test lib/__tests__/platform-migrations.test.ts -t "catalog does not offer ops whose scripts are absent"
```
Expected: FAIL — `findOp("seed")` / `findOp("seed-reset")` currently return objects, not `undefined`.

- [ ] **Step 5: Remove the two ops from the catalog**

In `lib/platform-migrations.ts`:

Remove the `seed` baseline line (kept from Task 1, now directly below `seed-currency-iso`):
```ts
  seed("seed", "db:seed", "Seed: baseline"),
```

Remove the `seed-reset` danger op:
```ts
  { id: "seed-reset", group: "danger", label: "DANGER: seed reset (migrate reset + seed)",
    kind: "script", run: "db:seed:reset", writes: true, destructive: true },
```

After this edit the seed block starts with `seed-currency-iso` then `seed-permission`, and the danger block contains only `migrate-reset`.

- [ ] **Step 6: Run the full suite to verify all pass**

Run:
```bash
bun run test
```
Expected: all tests pass, including the extended guard and the retargeted assertions.

- [ ] **Step 7: Typecheck and lint the touched files**

Run:
```bash
bun run typecheck && bun run lint
```
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add lib/platform-migrations.ts lib/__tests__/platform-migrations.test.ts components/__tests__/platform-migrations.test.tsx
git commit -m "fix(platform-migrations): drop scriptless db:seed and db:seed:reset ops

Neither has an npm script in @repo/prisma-shared-schema-platform, so their
Run buttons could only fail. Extend the regression guard to keep them absent
and retarget the tests that referenced them.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Add the catalog↔package drift guard test

A node-env test that reads the real package `package.json` and asserts every `kind:"script"` op maps to an existing script. Skips cleanly when the package isn't checked out.

**Files:**
- Create: `lib/__tests__/platform-catalog-drift.test.ts`

**Interfaces:**
- Consumes: `CATALOG` from `@/lib/platform-migrations` (each op has `kind`, `run`, `id`).
- Produces: nothing importable — a standalone guard test.

- [ ] **Step 1: Write the drift guard test**

Create `lib/__tests__/platform-catalog-drift.test.ts` with exactly:

```ts
import { expect, test } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { CATALOG } from "@/lib/platform-migrations";

// Resolve the platform package the same way lib/platform-package.ts's
// packageDir() does, but WITHOUT going through env() (which validates the whole
// env schema and would throw when unrelated vars are unset in a bare test run).
const DEFAULT_REL = "../carmen-turborepo-backend-v2/packages/prisma-shared-schema-platform";

function readRealScripts(): Record<string, string> | null {
  const dir = process.env.PLATFORM_PACKAGE_DIR ?? path.resolve(process.cwd(), DEFAULT_REL);
  try {
    const raw = fs.readFileSync(path.join(dir, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
    return parsed.scripts ?? null;
  } catch {
    return null;
  }
}

const scripts = readRealScripts();

// Skip when the backend package isn't present (e.g. CI without the sibling repo).
test.skipIf(!scripts)(
  "every script-kind catalog op maps to a real package script",
  () => {
    // Sanity: we actually read a populated scripts map, so the assertions below
    // are not vacuously true against an empty/misread object.
    expect(scripts!["db:seed.permission"]).toBeTypeOf("string");

    const missing = CATALOG.filter((o) => o.kind === "script" && scripts![o.run] === undefined);
    expect(missing.map((o) => `${o.id} → ${o.run}`)).toEqual([]);
  },
);
```

- [ ] **Step 2: Run the test to verify it passes (or skips)**

Run:
```bash
bun run test lib/__tests__/platform-catalog-drift.test.ts
```
Expected: PASS (package present, catalog synced after Tasks 1–2). If the sibling backend repo is absent, the test is SKIPPED — also acceptable.

- [ ] **Step 3: Prove the guard has teeth (temporary red)**

Only meaningful when Step 2 PASSED (not skipped). Temporarily add a bogus script op to `lib/platform-migrations.ts` at the end of the seed block:
```ts
  seed("seed-bogus", "db:seed.does-not-exist", "Seed: bogus (temp)"),
```
Run:
```bash
bun run test lib/__tests__/platform-catalog-drift.test.ts
```
Expected: FAIL — the message lists `seed-bogus → db:seed.does-not-exist`. Then **remove** the bogus line.

- [ ] **Step 4: Re-run to confirm green after reverting**

Run:
```bash
bun run test lib/__tests__/platform-catalog-drift.test.ts
```
Expected: PASS (or SKIP). Confirm `git status --short` shows only the new test file staged/untracked and no leftover `seed-bogus` line: `git diff lib/platform-migrations.ts` must be empty.

- [ ] **Step 5: Full suite + typecheck + lint**

Run:
```bash
bun run test && bun run typecheck && bun run lint
```
Expected: all pass, no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/__tests__/platform-catalog-drift.test.ts
git commit -m "test(platform-migrations): guard catalog against package script drift

Assert every kind:script catalog op maps to a real script in
@repo/prisma-shared-schema-platform; skip when the package is absent.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Verification (whole feature)

- [ ] `bun run test` — all green, drift guard passing (or skipped).
- [ ] `bun run typecheck` — no errors.
- [ ] `bun run lint` — clean.
- [ ] `git diff main --stat` shows only: `lib/platform-migrations.ts`, `lib/__tests__/platform-migrations.test.ts`, `components/__tests__/platform-migrations.test.tsx`, `lib/__tests__/platform-catalog-drift.test.ts`.
- [ ] Optional manual check (per `CLAUDE.md` RSC note): boot an authed god session and open `/platform-migrations`; confirm "Seed: currency ISO codes" appears under **Seed scripts** with `db:seed.currency-iso · seed.currency-iso.ts`, and that "Seed: baseline" and the "DANGER: seed reset" op are gone.
```
