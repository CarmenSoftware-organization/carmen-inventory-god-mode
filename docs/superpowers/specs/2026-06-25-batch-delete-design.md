# Batch (multi-select) Cascade Delete

**Design spec** · 2026-06-25

## 1. Purpose

Let an operator select multiple rows on a table grid (e.g.
`/CARMEN_SYSTEM/tb_cluster`) and cascade-delete them together, instead of one
row at a time. The feature reuses the existing runtime FK-graph cascade engine,
audit log, and type-to-confirm safety gate — it only generalizes them from one
target row to N.

## 2. Decisions (from brainstorming)

| Topic | Decision |
|---|---|
| Selection scope | Checked rows on the **current page only** (grid paginates at 50). No cross-page / "select entire table". |
| Confirmation | One **combined** blast-radius preview + type `DELETE` once. |
| Atomicity | **All-or-nothing**: every selected row's blast radius is deleted in a single transaction. |
| Drop tenant schema | **Not supported in batch** (v1). Use the per-row BU delete for that. |
| Orphan warning | When the combined blast radius touches `tb_business_unit`, show a warning that tenant Postgres schemas will be left orphaned. |
| pk transport | Selected pks travel in the URL query (`?pks=<encoded JSON array>`), same GET pattern as the existing single-delete page. Bounded by the 50-row page cap. |

## 3. Architecture

Generalize the single-row cascade engine to many rows, then reuse the existing
confirmation UI. Five touch points:

### 3.1 `lib/cascade.ts` — generalize to N rows (core logic)

- **`computeBlastRadiusMany(schema, table, pks[])`** — a single BFS seeded with
  *all* selected rows, sharing one `seen` set and the existing
  `CASCADE_MAX_ROWS` / `CASCADE_MAX_DEPTH` caps. Produces the true **combined**
  blast radius (`BlastRadius`) with no double-counting across overlapping
  subtrees.
- **Refactor** the existing `computeBlastRadius(schema, table, pk)` to delegate
  to `computeBlastRadiusMany(schema, table, [pk])` so there is exactly one BFS
  implementation. Single-target behavior must remain identical (existing tests
  must pass unchanged).
- **`executeCascadeMany(schema, table, pks[])`** — computes the combined radius,
  refuses if `truncated` (exceeds caps) or if an FK cycle exists among involved
  tables (same fail-safes as `executeCascade` today), then deletes every row in
  topological order inside **one transaction**, writing a `CASCADE_DELETE` audit
  entry per row. Returns `{ deleted }`.
- **Factor** the shared "delete an ordered radius within a tx, with audit" body
  out of `executeCascade` so single and batch paths share it. The single-row
  `executeCascade` keeps its BU `dropTenantSchema` option; the batch path never
  drops schemas.

### 3.2 `components/row-grid.tsx` — selection UI (client component)

- Leftmost checkbox column; a header checkbox toggles select-all **on the
  current page**.
- Local React state: a `Set<string>` of pk-JSON strings for the checked rows.
- A toolbar above the table, shown only when ≥1 row is checked: **"Delete N
  selected"**, which uses `useRouter().push` to navigate to the batch confirm
  route with the selected pks JSON-encoded in `?pks=`.
- Selection UI and the checkbox column render only when the table has a primary
  key (`!readOnly`). Paginating away clears selection (acceptable per scope).

### 3.3 `app/(god)/[schema]/[table]/delete-batch/page.tsx` — confirm route (new)

- Reads `?pks=<encoded JSON array of pk objects>`; `notFound()` if absent/empty.
- Calls `computeBlastRadiusMany` for the combined preview.
- **Reuses the existing `ConfirmDelete` component** with `isBusinessUnit=false`
  and `tenantSchema=null` (so the drop-schema box never appears), `radius` = the
  combined radius, `requiredPhrase` = `DELETE`, `action` =
  `confirmBatchDelete` bound to `(schema, table, pksJson)`.
- Renders the orphan-schema warning when any entry in `radius.byTable` has
  `table === "tb_business_unit"` and `schema === env().systemSchemaName`.
- Heading: `Delete N selected row(s) from {schema}.{table}`.

### 3.4 `server/delete.ts` — `confirmBatchDelete(schema, table, pksJson, formData)`

- `requireAuth()`.
- Parse `pksJson` to a `Record<string, unknown>[]`.
- Require the typed phrase to equal `DELETE`
  (`requiredPhrase({ isBusinessUnit: false, dropSchema: null })`); throw on
  mismatch (mirrors `confirmDelete`).
- `await executeCascadeMany(schema, table, pks)`.
- `revalidatePath("/" + schema + "/" + table)` and `redirect` back to the
  `/{schema}/{table}` grid.

### 3.5 Tests

- `lib/__tests__/cascade.int.test.ts` (or a sibling): integration tests against
  the dev DB for
  - `computeBlastRadiusMany`: union + dedup of overlapping blast radii; combined
    counts match the sum of distinct rows.
  - `executeCascadeMany`: deletes all selected subtrees; all-or-nothing (a
    failure leaves the DB unchanged); audit rows written per deleted row.
- Existing single-target cascade tests must still pass after the refactor.

## 4. Data Flow

1. Operator checks rows in `RowGrid` → `Set` of pk-JSON strings.
2. Clicks **Delete N selected** → `router.push` to
   `/{schema}/{table}/delete-batch?pks=<encoded JSON>`.
3. Confirm page computes the combined blast radius and renders `ConfirmDelete`.
4. Operator types `DELETE`, submits → `confirmBatchDelete` validates, calls
   `executeCascadeMany` (one transaction, audit per row), redirects to the grid.

## 5. Out of Scope (v1)

- Cross-page selection / "delete all rows in table".
- Dropping tenant Postgres schemas as part of a batch.
- Per-row differing confirmation phrases.
