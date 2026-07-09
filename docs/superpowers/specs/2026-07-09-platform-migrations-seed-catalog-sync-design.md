# Platform migrations: sync seed catalog with the package

Date: 2026-07-09
Branch base: main (proposed branch: `feat/platform-migrations-seed-catalog-sync`)

## Goal

Bring the `/platform-migrations` operation catalog (`CATALOG` in
`lib/platform-migrations.ts`) back in sync with the real seed scripts declared by
`@repo/prisma-shared-schema-platform`. Two kinds of drift exist today:

1. A real, runnable seed script — `db:seed.currency-iso` — is **missing** from the
   catalog, so operators cannot run it from the page.
2. Two catalog ops — `seed` (`db:seed`) and `seed-reset` (`db:seed:reset`) —
   reference scripts that **do not exist** in the package, so their Run buttons can
   only ever fail at spawn time.

Fix both, and add a **drift guard test** so this class of mismatch is caught
automatically instead of by manual inspection.

## Background

- The page (`app/(god)/platform-migrations/page.tsx`) is a server component that
  passes the static `CATALOG` to the client component
  `components/platform-migrations.tsx`, which renders each op grouped by
  `op.group`. Group membership is data-driven — no per-op UI code — so adding or
  removing a catalog entry needs no component change.
- Each `CatalogOp` with `kind: "script"` carries a `run` field that is an npm
  script name invoked `bun run <run>` in the package dir. For the op to be
  runnable, that key must exist in the package's `package.json` scripts.
- `resolveScriptInfo` (added in the 2026-07-07 script-names work) already flags an
  op whose script is absent with a `⚠ not in package` badge. That surfaces drift
  in the UI but does not prevent it; this spec removes the two known-bad entries
  and adds the missing one, then guards against regressions.

### Observed state (verified against the real package)

`@repo/prisma-shared-schema-platform/package.json` scripts, cross-referenced with
`prisma/*.ts` files:

| Catalog op (`id` → `run`) | In package? | Action |
| --- | --- | --- |
| `seed-currency-iso` → `db:seed.currency-iso` | ✅ script + `seed.currency-iso.ts` | **ADD** (currently absent from catalog) |
| `seed` → `db:seed` | ❌ no script, no `seed.ts` | **REMOVE** |
| `seed-reset` → `db:seed:reset` | ❌ no script | **REMOVE** |
| all other seed/check/prisma/tenant ops | ✅ present | keep |

- Precedent: commit `e13965e` removed `seed-application` and `mock-reset` for the
  identical reason (no script, no `.ts`) and added a regression guard. `seed` and
  `seed-reset` are the same case, left behind at the time. This spec finishes that
  cleanup.
- `seed.print-templates.ts` exists in the package but has **no** `db:*` script, so
  it is not runnable via `bun run`. It is a package-side gap, not a catalog gap —
  **out of scope** (see below).

## Design

### 1. Catalog changes — `lib/platform-migrations.ts`

**Add** one seed op at the **top of the seed group** (mirrors the package's
`package.json` order, where `db:seed.currency-iso` is the first seed):

```ts
seed("seed-currency-iso", "db:seed.currency-iso", "Seed: currency ISO codes"),
```

**Remove** two ops:

- `seed("seed", "db:seed", "Seed: baseline")` — seed group
- the `seed-reset` entry (`db:seed:reset`, group `danger`)

After removal the `danger` group contains only `migrate-reset`; its card still
renders normally (data-driven). No other CATALOG entry, helper, route, or
server action references these ids.

### 2. Regression guard — `lib/platform-migrations.test.ts`

Extend the existing "catalog does not offer ops whose scripts are absent from the
package" test (which currently asserts `seed-application` and `mock-reset` are
`undefined`) to also assert:

```ts
expect(findOp("seed")).toBeUndefined();
expect(findOp("seed-reset")).toBeUndefined();
```

### 3. Fix tests that reference the removed ops

Three existing assertions break when `seed` / `seed-reset` are removed:

- **`lib/platform-migrations.test.ts`** — the "catalog exposes the expected
  operation ids" test (`arrayContaining`): drop `"seed"` and `"seed-reset"`, add
  `"seed-currency-iso"`.
- **`lib/platform-migrations.test.ts`** — the "buildArgv ignores bu/only" test
  uses `findOp("seed")` → `["run", "db:seed"]`. Swap to a still-present op that
  also ignores bu/only: `findOp("seed-permission")` → `["run", "db:seed.permission"]`.
  (Behavior under test is unchanged; only the sample op changes.)
- **`components/__tests__/platform-migrations.test.tsx`** — the "renders the label
  only when an op has no scriptInfo entry" test asserts `getByText("Seed: baseline")`.
  Swap to a label of an op that still exists, e.g. `"Seed: currency ISO codes"`.

> Note: the two `resolveScriptInfo` unit tests that use a `{ "db:seed": ... }`
> *scripts map* as fixture data (lines ~128, ~140) are unaffected — that string is
> arbitrary fixture input, not a reference to the removed catalog op. Leave them
> as-is. Likewise `platform-package.test.ts`'s `db:seed` fixtures.

### 4. Drift guard test (new) — `lib/__tests__/platform-catalog-drift.test.ts`

A `.test.ts` (node env; no postgres) that reads the **real** platform package and
asserts every script-kind catalog op maps to an existing script.

- **Locate the package:** honor `process.env.PLATFORM_PACKAGE_DIR`; otherwise the
  default sibling path
  `../carmen-turborepo-backend-v2/packages/prisma-shared-schema-platform`
  resolved from `process.cwd()` — matching `packageDir()`'s own logic. Read
  `<dir>/package.json` **synchronously** at module load (`fs.readFileSync`) so the
  presence check can drive `test.skipIf`.
  - Resolve the dir without going through `env()` (which validates the full env
    schema and would throw when unrelated vars are unset), to keep the test
    self-contained.
- **Skip when absent:** if the package.json is missing/unreadable/has no `scripts`
  key, `test.skipIf(true)` — the suite stays green on machines/CI without the
  backend repo checked out. Emit no failure.
- **Assert (scope: option A — all script-kind ops):** for every
  `op` in `CATALOG` with `op.kind === "script"`, assert `scripts[op.run]` is
  defined. This covers seed **and** check **and** `db:deploy`, the tenant ops, and
  `db:migrate:reset` — every op whose Run button shells out to an npm script —
  for the same cost as guarding seed/check alone. `kind: "bin"` ops (e.g.
  `prisma-status`) are excluded because they invoke a binary, not a package
  script.
- On failure, the message names the offending `op.id` and its `run` so the fix is
  obvious (add the script to the package, or remove/rename the catalog op).

## Scope boundaries

- No change to run-gating, confirm phrases, argument validation, danger-zone
  gates, streaming, the audit trail, env vars, routes, or server actions.
- No component/UI code change — the catalog is data and the groups render
  whatever ops they contain.
- Not adding `seed.print-templates.ts`: it has no npm script in the package, so it
  is not runnable via `bun run`; wiring it up is a package-side change, out of
  scope here.

## Error handling

- Drift guard test with the package absent → skipped, never failing.
- Removed ops simply disappear from the page; any stale client selection of them
  is impossible because the radio list is rendered from the current `CATALOG`.

## Testing

- **Unit / guard** (`lib/platform-migrations.test.ts`, node):
  - "expected ids" list updated: no `seed`/`seed-reset`, includes `seed-currency-iso`.
  - Regression guard extended: `seed`, `seed-reset` are `undefined`.
  - `buildArgv` ignore-bu/only test retargeted to `seed-permission`.
- **Drift** (`lib/__tests__/platform-catalog-drift.test.ts`, node): with the real
  package present, every `kind:"script"` op resolves to an existing script;
  skipped when the package is absent.
- **Component** (`components/__tests__/platform-migrations.test.tsx`, jsdom):
  label-fallback test retargeted to a surviving op label.
- New/edited files kept lint-clean; pre-existing repo lint left untouched (per
  `CLAUDE.md`). Run `bun run test`, `bun run typecheck`, `bun run lint`.

## Files touched

```
lib/platform-migrations.ts                        + seed-currency-iso; − seed, − seed-reset
lib/__tests__/platform-migrations.test.ts         update id list, retarget buildArgv, extend guard
components/__tests__/platform-migrations.test.tsx  retarget label-fallback assertion
lib/__tests__/platform-catalog-drift.test.ts      NEW drift guard vs. real package (skips if absent)
```

## Out of scope

- Adding a `db:seed.print-templates` script to the package, or wiring
  `seed.print-templates.ts` into the catalog.
- Reintroducing a baseline `db:seed` / `db:seed:reset` aggregate — if the package
  later defines them, adding catalog entries is a separate change.
- Any change to how operations are executed, gated, or audited.
