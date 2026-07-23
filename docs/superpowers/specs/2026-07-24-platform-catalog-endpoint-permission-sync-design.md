# Platform migrations: surface endpoint-permission check + reverse-drift guard

Date: 2026-07-24
Branch base: main (proposed branch: `fix/platform-catalog-endpoint-permission-sync`)

## Goal

Bring the `/platform-migrations` operation catalog (`CATALOG` in
`lib/platform-migrations.ts`) back in sync with the real scripts declared by
`@repo/prisma-shared-schema-platform`. The package gained a new **read-only check**
script — `db:check.endpoint-permission` — that is not surfaced in the catalog, so
operators cannot run it from the page.

Fix the drift, and close the **reverse direction** the existing drift guard misses:
the current test only proves every catalog op maps to a real script; it does not
prove every real `db:seed.*` / `db:check.*` script has a catalog op. Add that second
assertion so this exact class of drift (a new upstream seed/check op left
un-surfaced) is caught automatically next time.

## Background

- The page (`app/(god)/platform-migrations/page.tsx`) is a server component that
  passes the static `CATALOG` to the client component
  `components/platform-migrations.tsx`, which renders each op grouped by `op.group`
  via a data-driven `GROUPS` array and `catalog.filter((o) => o.group === g.key)`.
  Group membership is data-driven — no per-op UI code — so adding a catalog entry
  needs **no component change**.
- Each `CatalogOp` with `kind: "script"` carries a `run` field that is an npm script
  name invoked as `bun run <run>` in the package dir. For the op to be runnable, that
  key must exist in the package's `package.json` scripts.
- The `check(id, run, label)` helper builds a read-only op
  (`writes: false, destructive: false, readonly: true`). Read-only ops need no
  confirm phrase (`canRun` returns `true` early for `readonly`).

### Observed state (verified against the real package)

`@repo/prisma-shared-schema-platform/package.json` scripts, cross-referenced with
`prisma/*.ts` files:

- Every current `kind: "script"` catalog op maps to a real script — the existing
  `platform-catalog-drift.test.ts` passes, no phantom ops.
- Scripts present in the package but **not** surfaced in the catalog:
  - `db:check.endpoint-permission` → `prisma/check.endpoint-permission-coverage.ts`
    — a read-only coverage check (its docstring: "Never touches the database and
    never writes a file"). It compares the gateway source against the permission
    seed, unlike the three existing DB-drift checks that compare the seed against the
    database. It still belongs in the `check` group.
  - `db:migrate` → `prisma migrate dev --skip-generate` — see "Deliberately excluded".
  - `db:generate` → `prisma generate` — see "Deliberately excluded".

## Changes

### 1. Add the endpoint-permission check op

In `lib/platform-migrations.ts`, alongside the other `check(...)` entries:

```ts
check("check-endpoint-permission", "db:check.endpoint-permission", "Check: endpoint permission coverage"),
```

- Renders automatically under the existing "Drift checks (read-only)" group — no
  component change.
- Read-only, so no confirm phrase and no destructive/create gating.
- Distinct from the DB-drift checks in that it reads the gateway source (default
  `GATEWAY_SRC` resolves to the sibling `apps/backend-gateway/src`) rather than the
  target DB; a non-zero exit if that source is absent surfaces through the normal ops
  runner, same as any other failing op.

### 2. Deliberately excluded (documented, not added)

- `db:migrate` (`prisma migrate dev`) — an interactive **development** command that
  can prompt for, or trigger, a database reset when it detects drift. That is unsafe
  against the live shared DB this tool targets. The correct production path,
  `db:deploy` (`prisma migrate deploy`), is already surfaced as `prisma-deploy`.
- `db:generate` (`prisma generate`) — regenerates the Prisma client locally and has
  no effect on the target database, so it is irrelevant to a DB-ops console. Surfacing
  it would imply a DB action that does not happen.

These exclusions are intentional; the reverse-drift guard below is scoped so it does
**not** flag them.

### 3. Reverse-drift guardrail

Extend `lib/__tests__/platform-catalog-drift.test.ts` with a second assertion (same
`test.skipIf(!scripts)` guard, so it is skipped when the sibling package is absent,
e.g. CI without the monorepo):

> Every real script whose name matches `db:seed.*` or `db:check.*` has a catalog op
> with a matching `run`.

Scoping to those two families keeps the deliberate exclusions (`db:generate`,
`db:migrate`, `db:deploy`, `db:migrate:reset`, `build`) out of scope while catching
exactly the drift this spec fixes. Implementation sketch:

```ts
const SURFACED_FAMILIES = /^db:(seed|check)\./;
const catalogRuns = new Set(CATALOG.map((o) => o.run));
const unsurfaced = Object.keys(scripts!)
  .filter((name) => SURFACED_FAMILIES.test(name) && !catalogRuns.has(name));
expect(unsurfaced).toEqual([]);
```

### 4. Update the expectation test

In `lib/__tests__/platform-migrations.test.ts`, add `"check-endpoint-permission"` to
the `arrayContaining` id list in "catalog exposes the expected operation ids across
groups". The list already uses `arrayContaining` (so it does not break today); this
records the new op as expected.

## Out of scope

- No changes to `components/platform-migrations.tsx` (UI is data-driven).
- No changes to the seed/migrate `.ts` scripts inside the sibling package.
- No new `GROUPS` entry — the op lands in the existing `check` group.

## Verification

- `bun run test` (at minimum `lib/__tests__/platform-catalog-drift.test.ts`,
  `lib/__tests__/platform-migrations.test.ts`,
  `components/__tests__/platform-migrations.test.tsx`).
- `bun run typecheck` and `bun run lint` (repo is lint-clean; keep it that way).
- Optional manual check: boot an authed god route, open `/platform-migrations`, and
  confirm "Check: endpoint permission coverage" appears under "Drift checks
  (read-only)". (Per the RSC/run-the-app note, UI wiring is verified by booting the
  route, not by jsdom tests alone.)
