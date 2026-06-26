# Cluster management page (add / edit / soft delete / hard delete + batch)

Date: 2026-06-26
Branch base: extends the existing CRUD + batch-delete infrastructure

## Goal

Give the operator a dedicated `/clusters` page to manage `CARMEN_SYSTEM.tb_cluster`
records with:

- **Add** and **Edit** clusters
- **Soft delete** (reversible — sets `deleted_at`) and **Restore**
- **Hard delete** (permanent cascade, with an optional drop of orphaned tenant
  Postgres schemas)
- **Batch** variants of soft delete, restore, and hard delete

The page follows the established `/schemas` (Business Units) precedent: a
Server Component wrapping a dedicated client table component, reusing the
battle-tested cascade/batch-delete engine for the dangerous hard-delete path and
adding a small, isolated soft-delete helper for the new reversible paths.

## Background

The god-mode tool already has:

- A **generic** CRUD grid at `/[schema]/[table]` (`components/row-grid.tsx`,
  `components/row-form.tsx`, `server/rows.ts`) — introspection-driven add/edit
  and **hard cascade delete**.
- A **dedicated** `/schemas` page (`app/(god)/schemas/page.tsx` +
  `components/business-units-table.tsx`) that manages Business Units with
  multi-select batch delete.
- A cascade engine (`lib/cascade.ts`) with blast-radius preview, typed-`DELETE`
  confirm gate (`components/confirm-delete.tsx`, `lib/delete-confirm.ts`),
  all-or-nothing single-transaction execution, FK-cycle/blast-cap refusal, and
  audit logging. Single-row BU delete can optionally `DROP SCHEMA … CASCADE` one
  tenant schema.
- The data hierarchy `tb_cluster` → `tb_business_unit` → tenant schema, all in
  `CARMEN_SYSTEM`. FKs into `tb_business_unit` are `NO ACTION`, so cascades are
  resolved at the application level by the engine.

**Soft delete does not exist anywhere yet** — it is the only genuinely new
mechanism in this feature.

## Decisions (from brainstorming)

| Decision | Choice |
| --- | --- |
| Soft-delete representation | `deleted_at` timestamp column. `NULL` = active, a timestamp = soft-deleted. |
| Hard delete behavior | Full cascade (reuse engine) **+ optional drop of orphaned tenant schemas** (single hard delete only). |
| Batch actions | Batch **soft delete**, batch **restore**, batch **hard delete**. |
| Layout | Two tabs: **Active** \| **Deleted** (recycle-bin model). |
| Hard-delete placement | Only from the **Deleted** tab (soft-delete first, then permanently delete). |
| Add/Edit | Dedicated `/clusters/new` + `/clusters/[id]/edit` routes reusing the generic `RowForm`. |
| Approach | Approach A — dedicated page, soft-delete logic in a small reusable `lib/soft-delete.ts` helper; no changes to the shared `RowGrid`. |

## Prerequisite — verify `deleted_at`

No `tb_cluster` DDL exists in the repo. **Before implementing**, introspect the
real table to confirm it has a `deleted_at` column (and `code` / `name`). **If
`deleted_at` is absent, add a migration** that creates it
(`ALTER TABLE "CARMEN_SYSTEM".tb_cluster ADD COLUMN deleted_at timestamptz`)
as the first implementation step.

## Design

### 1. Route — `app/(god)/clusters/page.tsx`

Server Component (`export const dynamic = "force-dynamic"`). Calls the new
`listClusters()` and renders `<ClustersTable clusters={…} system={…} />`. A nav
link to `/clusters` is added to `/schemas` (near the System section) for
reachability.

### 2. Registry — `lib/registry.ts` → `listClusters()`

Mirrors `listBusinessUnits()`. Returns:

```ts
export type Cluster = {
  id: string;
  code: string;
  name: string;
  deletedAt: string | null;       // ISO string or null
  businessUnitCount: number;      // # of tb_business_unit rows referencing this cluster
};
```

- One query selecting `id::text, code, name, deleted_at`, plus a correlated
  subquery / join count of `tb_business_unit` rows per `cluster_id`.
- Swallows `42P01` (missing table) → returns `[]`, same pattern as
  `listBusinessUnits()`.
- `businessUnitCount` powers the cascade warning in the UI.

### 3. Component — `components/clusters-table.tsx` (`"use client"`)

Two tabs over the same fetched list, split client-side by `deletedAt`:

**Active tab** (`deletedAt === null`)
- Columns: ☐ select · Code · Name · # Business Units · actions.
- Toolbar: **+ Add cluster** (link to `/clusters/new`).
- Per row: **Edit** (link to `/clusters/{id}/edit`) · **Soft delete** (bound
  `softDeleteClusters` form button).
- Multi-select action bar (≥1 ticked): **Soft delete N selected**.

**Deleted tab** (`deletedAt !== null`) — the recycle bin
- Columns: ☐ select · Code · Name · Deleted at · actions. Rows muted/strikethrough.
- Per row: **Restore** (bound `restoreClusters`) · **Hard delete** (link to the
  existing single `delete` confirm route).
- Multi-select action bar: **Restore N selected** · **Hard delete N selected**
  (link to the existing `delete-batch` confirm route).

Selection state mirrors `RowGrid`: `useState<Set<string>>`, key =
`JSON.stringify({ id })`, `toggle` / `toggleAll`. Selection resets when
switching tabs. No pagination (cluster list is small).

Batch hard-delete link target (same shape as `RowGrid`):
`/{system}/tb_cluster/delete-batch?pks=<encodeURIComponent(JSON.stringify(selectedPks))>`
where `selectedPks` is an array of `{ id }`.

### 4. Soft delete & restore — `lib/soft-delete.ts` (new, reusable)

Generic over a `deleted_at` convention:

```ts
softDeleteRows(schema, table, pks: Record<string, unknown>[], opts?: { deletedAtColumn?: string }): Promise<{ affected: number }>
restoreRows(schema, table, pks: Record<string, unknown>[], opts?: { deletedAtColumn?: string }): Promise<{ affected: number }>
```

- `deletedAtColumn` defaults to `"deleted_at"`.
- Soft delete: `UPDATE qualified(schema, table) SET deleted_at = now() WHERE <pk match>`.
- Restore: `… SET deleted_at = NULL WHERE <pk match>`.
- Single transaction, all-or-nothing (same guarantee as batch delete), using
  `qualified` / `ident` from `lib/sql-guard`.
- Writes one audit row per affected record (`SOFT_DELETE` / `RESTORE`),
  mirroring `lib/cascade.ts`'s `writeAudit` usage.
- Idempotent: re-soft-deleting or re-restoring simply re-applies the value.

### 5. Server actions — `server/cluster-actions.ts` (`"use server"`)

```ts
softDeleteClusters(pksJson: string): Promise<void>
restoreClusters(pksJson: string): Promise<void>
```

Each: `requireAuth()` → parse `pks` (guard `length === 0`) → call the helper
against `env().systemSchemaName` + `tb_cluster` → `revalidatePath("/clusters")`.
Single-row = array of one, so the same action backs both per-row and batch
buttons (bound in the client component's `<form action={…}>`). **No typed-`DELETE`
gate** — soft delete and restore are reversible, so they are plain submit
buttons.

### 6. Hard delete — reuse the cascade infra

Reuses the existing `delete` / `delete-batch` confirm routes and `confirmDelete`
/ `confirmBatchDelete` (`server/delete.ts`) targeted at `CARMEN_SYSTEM/tb_cluster`,
with these changes:

**6a. Redirect to `/clusters`.** Add an `isCluster` branch to `confirmDelete`
and `confirmBatchDelete` mirroring the existing `isBusinessUnit` branch:

```ts
const isCluster = schema === env().systemSchemaName && table === "tb_cluster";
// after cascade:
if (isCluster) { revalidatePath("/clusters"); redirect("/clusters"); }
```

**6b. Multi-schema drop (single hard delete only).** A cluster can own several
business units, each with its own tenant schema, so "offer schema drop" means
dropping **N** schemas. Generalize the engine:

- `lib/cascade.ts` `deleteRadius` option `dropTenantSchema: string | null` →
  `dropTenantSchemas: string[]` (default `[]`); loop `DROP SCHEMA <ident> CASCADE`
  + audit per schema, all inside the existing transaction. Return
  `droppedSchemas: string[]`.
- `executeCascade` opts updated likewise. The existing BU single-delete call
  site passes `[dropSchema]` when the box is checked (`[]` otherwise).
- New registry helper `resolveTenantSchemasForCluster(clusterId): Promise<string[]>`
  — distinct, non-null tenant schemas across the cluster's BUs.
- `confirm-delete.tsx` extended: alongside the existing single-BU case, a cluster
  case that lists the N orphaned tenant schemas above one checkbox ("Also drop
  these N tenant schemas"). Required phrase stays `DELETE` (the schema list is
  shown prominently; we do not switch the phrase to a single schema name in the
  multi-schema case).

**6c. Batch hard delete keeps existing behavior:** combined blast-radius preview
+ typed-`DELETE`, **no schema drop** (the orphan-schema warning surfaces it),
consistent with the current "batch never drops schemas" v1 rule.

### 7. Add & edit — dedicated routes reusing `RowForm`

- `app/(god)/clusters/new/page.tsx` and `app/(god)/clusters/[id]/edit/page.tsx`.
- Both call `describeTable(systemSchema, "tb_cluster")`, **filter** the column
  list to editable cluster fields (exclude `id`, `deleted_at`, and any audit
  columns like `created_at` / `updated_at`), and render the existing generic
  `RowForm`.
- Thin actions `submitClusterInsert` / `submitClusterUpdate` live in
  `server/cluster-actions.ts` (alongside the soft-delete/restore actions, so all
  cluster server actions sit in one file). They reuse the existing
  `valuesFromForm` / `applyInsert` / `applyUpdate` machinery from `server/rows.ts`
  and `lib/write.ts`, then `revalidatePath("/clusters")` and redirect to
  `/clusters`. (`valuesFromForm` is currently a private helper in `server/rows.ts`
  — export it so it can be shared.)

## Data flow

- **Soft delete:** Active tab → tick → "Soft delete N" → `softDeleteClusters` →
  `deleted_at = now()` → revalidate → rows appear under Deleted tab.
- **Restore:** Deleted tab → tick → "Restore N" → `restoreClusters` →
  `deleted_at = NULL` → rows return to Active.
- **Hard delete (batch):** Deleted tab → tick → "Hard delete N" → existing
  `delete-batch` confirm (combined blast radius + typed `DELETE`, no schema drop)
  → `confirmBatchDelete` → cascade → redirect `/clusters`.
- **Hard delete (single):** Deleted tab → "Hard delete" → existing `delete`
  confirm page **with the multi-schema drop checkbox** → `confirmDelete` →
  cascade (+ optional schema drops) → redirect `/clusters`.
- **Add / Edit:** toolbar/row link → `/clusters/new` or `/clusters/[id]/edit`
  (filtered `RowForm`) → `submitClusterInsert/Update` → redirect `/clusters`.

## Error handling & edge cases

- `listClusters()` swallows `42P01` → `[]`.
- Soft delete / restore are idempotent; empty selection is guarded both in the
  UI (action bar hidden) and the server action (`pks.length === 0` throws).
- Hard delete inherits all existing safety: blast-radius cap refusal, FK-cycle
  refusal, all-or-nothing transaction, audit logging.
- **Soft delete does not cascade** — only the cluster row is marked; its business
  units are untouched and keep referencing a soft-deleted cluster. This is
  intended v1 behavior and is called out in the UI/doc.

## Testing

- `lib/__tests__/soft-delete.int.test.ts` (embedded-postgres): soft delete sets
  `deleted_at`; restore clears it; batch affects all selected rows; transaction
  rolls back on error; audit rows written.
- `lib/__tests__/registry.int.test.ts` (extend): `listClusters()` returns code/
  name/deletedAt and a correct `businessUnitCount`; `[]` on `42P01`.
- Extend the cascade integration test for `dropTenantSchemas` (drops 0, 1, N
  schemas in one transaction).
- `components/__tests__/clusters-table.test.tsx` (mirrors
  `business-units-table.test.tsx`): tab split by `deletedAt`; select-all per tab;
  action-bar buttons/links present per tab; batch hard-delete link targets the
  `delete-batch` route with correctly encoded `pks` (array of `{ id }`).
- `confirmDelete` / `confirmBatchDelete` cluster branches: covered by typecheck +
  the existing cascade integration tests (parity with the BU branch pattern).

## Out of scope (YAGNI)

- Cascading soft delete to child business units, or soft delete on any other
  table.
- Batch hard delete dropping tenant schemas (single hard delete only; batch keeps
  the orphan warning).
- Generalizing soft delete into the shared `RowGrid` / generic grid.
- Pagination / cross-page selection (the cluster list is small, like BUs).
