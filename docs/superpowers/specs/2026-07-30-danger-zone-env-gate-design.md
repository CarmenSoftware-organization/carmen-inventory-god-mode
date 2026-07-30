# Gate the platform-migrations danger zone behind `ALLOW_DANGER_OPS`

**Date:** 2026-07-30
**Status:** Approved

## Problem

The `/platform-migrations` page surfaces a "Danger zone" group containing the
`migrate-reset` op (`db:migrate:reset` — drops and recreates the target
schema). This instance points at a live dev database, so a reset is a
permanent, high-blast-radius action. The operator wants it gone from daily
use, but still reachable on purpose (e.g. against a scratch database) without
a code change.

## Decision

Hide the `danger` catalog group by default and gate it behind a server-side
env flag, enforced in both the page (visibility) and the API route
(execution). No UI component changes; the catalog stays a pure data module.

## Design

### Env flag — `lib/env.ts`

- Add `ALLOW_DANGER_OPS: z.string().optional()` to the zod schema.
- Add `allowDangerOps: boolean` to `Env`, mapped as
  `p.ALLOW_DANGER_OPS === "true"` (same pattern as `backendApiInsecureTls`).
- Default is **off**. No env file in this repo sets it; enabling requires an
  explicit `ALLOW_DANGER_OPS=true`.

### Catalog filter — `lib/platform-migrations.ts`

`CATALOG`, `OpGroup`, and the `migrate-reset` entry are unchanged. Add one
pure function:

```ts
export function visibleCatalog(allowDanger: boolean): CatalogOp[] {
  return allowDanger ? CATALOG : CATALOG.filter((o) => o.group !== "danger");
}
```

Keeping `CATALOG` complete preserves the drift tests, which compare the full
catalog against the platform package's real scripts without touching env.

### Page — `app/(god)/platform-migrations/page.tsx`

Replace direct `CATALOG` usage with
`const catalog = visibleCatalog(env().allowDangerOps)` for both the
`scriptInfo` map and the `catalog` prop. With the flag off the client never
receives the op, and the "Danger zone" fieldset disappears on its own — the
component already skips empty groups (`if (!ops.length) return null`), so
`components/platform-migrations.tsx` needs no edit.

### Route — `app/api/ops/platform-migrate/route.ts`

After `findOp(opId)` resolves, add:

```ts
if (op.group === "danger" && !env().allowDangerOps)
  return bad("Danger operations are disabled; set ALLOW_DANGER_OPS=true to enable", 403);
```

403 (not 404) on purpose: this is an operator tool, so a clear "disabled, and
here is how to enable it" beats pretending the op does not exist. With the
flag on, all existing gates still apply (confirm phrase = schema name, the
destroy checkbox, `confirmDestroy: true` on the API).

## Error handling

| Scenario | Result |
| --- | --- |
| Flag off, UI | Danger group not rendered; op absent from the client catalog |
| Flag off, direct API call with `migrate-reset` | 403 with the enable hint |
| Flag on | Behavior identical to today (full confirm ceremony) |

## Testing

- `lib/__tests__/platform-migrations.test.ts`: new test — `visibleCatalog(false)`
  contains no `danger`-group op; `visibleCatalog(true)` includes
  `migrate-reset`. Existing tests stand unchanged (`CATALOG` is still full).
- `lib/__tests__/platform-migrate-route.test.ts` (runs with the flag off by
  default): `delete process.env.ALLOW_DANGER_OPS` in `beforeAll` so a value
  leaking from the developer's shell cannot flip the flag; switch the
  destructive-gate test from `migrate-reset` to `tenant-revert` (also
  `destructive: true`; psql is already mocked), and add a test asserting
  `migrate-reset` returns 403.
- New `lib/__tests__/platform-migrate-route-danger.test.ts`: sets
  `process.env.ALLOW_DANGER_OPS = "true"` in `beforeAll` (vitest gives each
  file a fresh module registry, so the cached `env()` singleton picks it up)
  and asserts `migrate-reset` runs with the full confirm set.
- E2E: no spec references the danger zone; no changes.

## Documentation

- README env section: one line describing `ALLOW_DANGER_OPS`.
- `.env.example`: commented `# ALLOW_DANGER_OPS=true` with a short warning.

## Out of scope

- No component/styling changes (the danger styling still serves flag-on mode).
- No edits to historical specs/plans that mention `migrate-reset`.
- `tenant-revert` stays ungated — the request covers the danger group only.
