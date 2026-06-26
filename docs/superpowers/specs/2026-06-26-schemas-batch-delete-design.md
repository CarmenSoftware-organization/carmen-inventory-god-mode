# Multi-select batch delete on /schemas (Business Units)

Date: 2026-06-26
Branch base: feat/batch-delete (extends the batch-delete infrastructure)

## Goal

Let the operator tick multiple Business Units on the `/schemas` page and delete
them in one combined cascade, reusing the batch-delete infrastructure already
built for the generic table grid (`/[schema]/[table]`).

## Background

The `/schemas` page (`app/(god)/schemas/page.tsx`) is a Server Component that
hand-rolls a Business Units table — it does NOT use the reusable `RowGrid`
component. Each row currently has an `open →` link and a single-row `delete`
link. Single-row BU delete already redirects back to `/schemas` (a special case
in `confirmDelete`).

The batch-delete backend already exists from the prior feature and is reused
unchanged:

- `delete-batch` confirm route (`app/(god)/[schema]/[table]/delete-batch/page.tsx`)
- `confirmBatchDelete` server action (`server/delete.ts`)
- `computeBlastRadiusMany` / `executeCascadeMany` (`lib/cascade.ts`)
- `radiusTouchesBusinessUnits` orphan-schema warning (`lib/delete-confirm.ts`)
- `ConfirmDelete` component (combined blast-radius preview + type `DELETE` once)
- All-or-nothing single-transaction cascade
- v1 rule: **batch never drops tenant schemas** (the orphan warning covers it)

## Design

### 1. New client component — `components/business-units-table.tsx`

`"use client"`. Renders just the Business Units table section. Props:

- `bus` — the Business Unit array (shape from `listBusinessUnits()`:
  `{ id, code, name, isActive, tenantSchema }`)
- `system` — the system schema name (`sel.system`)

Behavior:

- Same columns as today: Code, Name, Active, Tenant schema, plus an actions
  cell with `open →` (when `tenantSchema` present) and per-row `delete`
  (both preserved unchanged from the current page).
- Adds a leading checkbox column with a select-all header checkbox. Selection
  logic mirrors `RowGrid`: `useState<Set<string>>`, key =
  `JSON.stringify({ id: b.id })`, `toggle`/`toggleAll` helpers.
- A "Delete N selected" action bar shown only when ≥1 row is ticked, linking to
  the existing route:
  `/{system}/tb_business_unit/delete-batch?pks=<encodeURIComponent(JSON.stringify(selectedPks))>`
  where `selectedPks` is the array of `{ id }` objects.

Notes:

- No pagination: `listBusinessUnits()` returns all BUs, so select-all selects
  all of them. No cross-page concern.
- BUs always have an `id` primary key, so there is no read-only / no-PK case to
  handle (unlike `RowGrid`).

### 2. `app/(god)/schemas/page.tsx`

Stays a Server Component. The inline `<table>` inside the Business Units
`<section>` is replaced with `<BusinessUnitsTable bus={bus} system={sel.system} />`.
The System section and the All-schemas section are untouched. The existing
`delete`/`open →` per-row link markup moves into the new component verbatim.

### 3. `server/delete.ts` → `confirmBatchDelete`

Add Business-Unit detection mirroring `confirmDelete`:

```ts
const isBusinessUnit = schema === env().systemSchemaName && table === "tb_business_unit";
// ...after executeCascadeMany(schema, table, pks):
if (isBusinessUnit) {
  revalidatePath("/schemas");
  redirect("/schemas");
}
revalidatePath(`/${schema}/${table}`);
redirect(`/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`);
```

`env` is already imported in `server/delete.ts`. This also makes batch-deleting
BUs from the raw table grid land on `/schemas`, consistent with the single-row
BU delete branch.

## Data flow

1. Operator ticks BU rows on `/schemas`.
2. "Delete N selected" → `/{system}/tb_business_unit/delete-batch?pks=[{id},…]`.
3. The existing `delete-batch` page computes the **combined** blast radius
   (`computeBlastRadiusMany`), shows the orphan-schema warning (it fires because
   the radius touches `tb_business_unit`), and gates on typing `DELETE` once.
4. `confirmBatchDelete` runs the all-or-nothing cascade and redirects to
   `/schemas`.

## Testing

- New component test `components/__tests__/business-units-table.test.tsx`
  (mirrors `row-grid.test.tsx`: mock `next/link` to a passthrough anchor,
  `afterEach(cleanup)`):
  - rows render (code/name visible)
  - select-all toggles all rows
  - "Delete N selected" href targets the `delete-batch` route with correctly
    encoded `pks` (array of `{ id }`)
  - per-row `delete` and `open →` links preserved
- The `confirmBatchDelete` change is a two-line mirror of the already-tested
  `confirmDelete` BU branch; covered by typecheck and the existing
  `executeCascadeMany` integration tests. No new server-action test (parity with
  the existing single-row pattern, which is gated by typecheck + smoke).

## Out of scope (YAGNI)

- Dropping tenant Postgres schemas in batch (v1 rule stands; orphan warning
  surfaces it).
- Pagination / cross-page selection (the BU list is not paginated).
- Changing the All-schemas section or the System section.
