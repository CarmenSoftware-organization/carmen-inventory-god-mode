# Platform Catalog Endpoint-Permission Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the platform package's new read-only `db:check.endpoint-permission` script in the `/platform-migrations` catalog, and add a reverse-direction drift guard so no future `db:seed.*`/`db:check.*` script can be left un-surfaced.

**Architecture:** The `/platform-migrations` page renders operations from a static `CATALOG` array in `lib/platform-migrations.ts`; the client component groups ops by `op.group` with no per-op UI code, so adding a catalog entry needs no component change. An existing drift test proves catalog→package (no phantom ops); this plan adds the missing package→catalog assertion for the two operator-facing families.

**Tech Stack:** TypeScript, Next.js (App Router, RSC), Vitest, ESLint, `tsc`. Package manager/runner: `bun`.

## Global Constraints

- Test runner is **Vitest** invoked as `bun run test` — never `bun test`.
- Repo is lint-clean (`bun run lint` = `eslint`) and must stay that way.
- Do **not** create new `*.test.ts` files — both test edits below modify existing files (the user's test-during-build rule permits editing existing tests; these edits are the deliverable).
- No changes to `components/platform-migrations.tsx` (UI is data-driven) or to the sibling package's scripts.
- The new op is read-only: use the existing `check(id, run, label)` helper, which sets `writes: false, destructive: false, readonly: true`.
- Verified pre-conditions: no exact-match or `toHaveLength` assertion exists on `CATALOG` ids/length (only `expect.arrayContaining`), so adding an op does not break current tests.

---

### Task 1: Surface the endpoint-permission check op

**Files:**
- Modify: `lib/platform-migrations.ts` (the `check(...)` block in `CATALOG`, currently lines 49-51)
- Modify: `lib/__tests__/platform-migrations.test.ts:9-16` (the `arrayContaining` id list)

**Interfaces:**
- Consumes: the existing `check(id: string, run: string, label: string): CatalogOp` helper in `lib/platform-migrations.ts`.
- Produces: a new catalog op with `id: "check-endpoint-permission"`, `run: "db:check.endpoint-permission"`, `group: "check"`. Task 2's reverse-drift guard relies on this op existing so that `db:check.endpoint-permission` counts as surfaced.

- [ ] **Step 1: Add the op to `CATALOG`**

In `lib/platform-migrations.ts`, add a fourth `check(...)` line immediately after the existing `check-platform-role-permission` entry so the check block reads:

```ts
  check("check-permission", "db:check.permission", "Check: permission drift"),
  check("check-platform-permission", "db:check.platform-permission", "Check: platform permission drift"),
  check("check-platform-role-permission", "db:check.platform-role-permission", "Check: platform role-permission drift"),
  check("check-endpoint-permission", "db:check.endpoint-permission", "Check: endpoint permission coverage"),
```

- [ ] **Step 2: Record the op in the expectation test**

In `lib/__tests__/platform-migrations.test.ts`, add `"check-endpoint-permission"` to the check line of the `arrayContaining` list so lines 9-16 read:

```ts
  expect(ids).toEqual(expect.arrayContaining([
    "prisma-status", "prisma-deploy",
    "tenant-apply", "tenant-revert",
    "seed-currency-iso", "seed-permission", "seed-platform-super-admin",
    "seed-platform-role", "seed-report-template-upload",
    "check-permission", "check-platform-permission", "check-platform-role-permission", "check-endpoint-permission",
    "migrate-reset",
  ]));
```

- [ ] **Step 3: Run the affected unit + drift tests**

Run: `bun run test lib/__tests__/platform-migrations.test.ts lib/__tests__/platform-catalog-drift.test.ts`
Expected: PASS. The `platform-migrations` suite passes with the new id present; the catalog-drift suite still passes (the new op maps to a real script, so no phantom ops) — or is skipped if the sibling package is absent.

- [ ] **Step 4: Typecheck and lint**

Run: `bun run typecheck && bun run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/platform-migrations.ts lib/__tests__/platform-migrations.test.ts
git commit -m "feat(platform-migrations): surface db:check.endpoint-permission op

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Reverse-drift guardrail for seed/check families

**Files:**
- Modify: `lib/__tests__/platform-catalog-drift.test.ts` (append a second `test.skipIf(!scripts)` block after the existing one, currently ending at line 32)

**Interfaces:**
- Consumes: the file-local `scripts` constant (real package scripts, or `null` when the sibling package is absent) and the imported `CATALOG` — both already present at the top of `lib/__tests__/platform-catalog-drift.test.ts`.
- Produces: no exports. A regression guard that fails if any `db:seed.*` or `db:check.*` package script has no matching `run` in `CATALOG`. Depends on Task 1: without the `check-endpoint-permission` op, this new test would fail because `db:check.endpoint-permission` would be un-surfaced.

- [ ] **Step 1: Append the reverse-drift test**

Add this block at the end of `lib/__tests__/platform-catalog-drift.test.ts`, after the existing test's closing `);`:

```ts
// Reverse direction: catch a new upstream operator-facing script that nobody
// wired into the catalog. Scoped to db:seed.* / db:check.* so intentionally
// unsurfaced scripts (db:generate, db:migrate, db:deploy, db:migrate:reset,
// build) stay out of scope.
test.skipIf(!scripts)(
  "every db:seed.* and db:check.* package script is surfaced in the catalog",
  () => {
    const catalogRuns = new Set(CATALOG.map((o) => o.run));
    const unsurfaced = Object.keys(scripts!)
      .filter((name) => /^db:(seed|check)\./.test(name) && !catalogRuns.has(name))
      .sort();
    expect(unsurfaced).toEqual([]);
  },
);
```

- [ ] **Step 2: Run the drift test**

Run: `bun run test lib/__tests__/platform-catalog-drift.test.ts`
Expected: PASS — both the original and the new assertion pass (all 8 `db:seed.*` and all 4 `db:check.*` scripts, including the just-added `db:check.endpoint-permission`, are surfaced). If the sibling package is absent, both are skipped.

- [ ] **Step 3: Typecheck and lint**

Run: `bun run typecheck && bun run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/__tests__/platform-catalog-drift.test.ts
git commit -m "test(platform-migrations): guard against un-surfaced seed/check scripts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Full-suite verification

**Files:** none (verification only).

**Interfaces:**
- Consumes: the complete change set from Tasks 1-2.
- Produces: confidence that nothing else regressed.

- [ ] **Step 1: Run the whole test suite**

Run: `bun run test`
Expected: PASS (full suite green; catalog-drift specs run when the sibling package is present, otherwise skipped).

- [ ] **Step 2: Typecheck and lint the whole repo**

Run: `bun run typecheck && bun run lint`
Expected: no errors.

- [ ] **Step 3 (optional, manual): boot the god route and eyeball the UI**

Per the RSC/run-the-app project note, jsdom tests do not exercise the server→client render boundary. To confirm the op appears:
1. `bun run dev` (port 3305).
2. Open an authed god session at `/platform-migrations`.
3. Confirm "Check: endpoint permission coverage" appears under the "Drift checks (read-only)" group, with no `⚠ not in package` badge.

---

## Self-Review

**Spec coverage:**
- Spec change 1 (add endpoint-permission op) → Task 1, Step 1. ✓
- Spec change 2 (deliberately exclude `db:migrate`/`db:generate`) → no-action by design; the Task 2 regex is scoped to `db:seed.*`/`db:check.*` so it does not force those in. ✓
- Spec change 3 (reverse-drift guardrail) → Task 2. ✓
- Spec change 4 (update expectation test) → Task 1, Step 2. ✓
- Spec "Out of scope" (no component change, no sibling-package edits, no new group) → respected across all tasks. ✓
- Spec "Verification" (test/typecheck/lint + optional route boot) → Task 3. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"/vague steps; every code step shows the exact code. ✓

**Type consistency:** The op id `check-endpoint-permission` and run `db:check.endpoint-permission` are used identically in Task 1 (catalog + expectation test) and depended on in Task 2 (surfaced via the `/^db:(seed|check)\./` filter). The `check(id, run, label)` helper signature matches its existing call sites. ✓
