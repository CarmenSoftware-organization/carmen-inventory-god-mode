# Audit log pagination

Date: 2026-07-06
Branch base: main (proposed branch: `feat/audit-pagination`)

## Goal

The `/audit` page (`app/(god)/audit/page.tsx`) currently loads a single fixed
slice — `listAudit({ limit: 200 })`, capped at 500 in the query — ordered
`at DESC`. Any action older than the newest 200 (per filter) is invisible. Add
pagination so an operator can page back through the full history.

## Approach

**Cursor / keyset pagination, forward-only ("Next page →").** This mirrors the
existing rows browser (`lib/rows.ts` + `components/row-grid.tsx`), which is the
only other paginating surface in the app. Chosen over offset+page-numbers
because:

- It stays consistent with the one pagination pattern already in the codebase.
- The audit table is append-only ordered `at DESC`; keyset is stable when new
  rows are prepended mid-browse (offset would shift rows and skip/duplicate).
- No `COUNT(*)` needed; scales regardless of table size.

Trade-off accepted: no "page N of M", no jump-to-page, no "Previous" button —
back navigation uses the browser back button, exactly as the rows browser does.

Page size: **50** (matches `readRows`'s default).

## Data layer — `lib/audit.ts`

Add a new exported function and refactor the existing one to delegate to it, so
the query lives in one place and every current caller of `listAudit` keeps
working unchanged.

```
export type AuditRow = {
  id: string; at: string; actor: string; schemaName: string;
  tableName: string | null; operation: Operation;
  pk: unknown; oldValues: unknown; newValues: unknown; statement: string | null;
};

export async function listAuditPage(
  filter: { schema?: string; table?: string; operation?: Operation; limit?: number; cursor?: string | null } = {},
): Promise<{ entries: AuditRow[]; nextCursor: string | null }>;

export async function listAudit(filter = {}): Promise<AuditRow[]> {
  return (await listAuditPage(filter)).entries;
}
```

Details:

- **ORDER BY** changes from `at DESC` to `at DESC, id DESC`. `at` is not unique,
  so `id` (uuid) is the tiebreaker that gives keyset a total, stable order. The
  newest row is still first, so existing tests that read `entries[0]` are
  unaffected.
- **Cursor encoding** reuses the rows.ts convention:
  `base64url(JSON.stringify([at, id]))`, where `at`/`id` are the `::text` values
  already selected. Add local `encodeCursor` / `decodeCursor` helpers (mirroring
  `lib/rows.ts`; not shared yet — YAGNI).
- **Keyset predicate**: when `filter.cursor` is present, append the condition
  `(at, id) < ($n::timestamptz, $m::uuid)` to the existing filter conditions
  (schema/table/operation). Row-wise comparison against the casted cursor values
  ensures no gap and no overlap even when several rows share the same `at`.
- **Next-page detection**: fetch `limit + 1` rows. If more than `limit` come
  back, pop the extra and set `nextCursor = encodeCursor([last.at, last.id])`;
  otherwise `nextCursor = null`.
- `limit` default 50, still capped at 500.

## Page — `app/(god)/audit/page.tsx`

- Extend `searchParams` to include `cursor?: string`; call
  `listAuditPage({ schema, table, operation, cursor, limit: 50 })`.
- Render a **"Next page →"** link only when `nextCursor` is set, styled like the
  rows browser's control in `components/row-grid.tsx`.
- The link **preserves the active filters**: build the query string with
  `URLSearchParams` from the current `schema` / `table` / `operation` values
  plus the new `cursor`.
- The filter form is already a GET form with no `cursor` field, so submitting a
  new filter produces a URL without `cursor` — pagination **resets to the first
  page automatically**. No change needed there.
- **Remove the `#` column** (header and cell). It currently renders
  `entries.length - i` zero-padded, which reads as a global ordinal but is only
  a per-page count; across pages it restarts (page 2 also shows 050→001) and
  misleads. Cursor pagination cannot cheaply produce a true global position, so
  the column is dropped. The table becomes: At · Actor · Target · Op · PK ·
  Changes. Adjust the empty-state `colSpan` from 7 to 6.

## Tests — `lib/__tests__/audit.int.test.ts`

Add one pagination test (embedded-postgres, same `startPg` harness as the
existing test):

- Seed 55 audit entries via `withTransaction(null, tx => writeAudit(tx, …))`.
- First page: `listAuditPage({ limit: 50 })` returns 50 entries and a non-null
  `nextCursor`.
- Second page: `listAuditPage({ limit: 50, cursor })` returns the remaining 5
  entries and a `null` `nextCursor`.
- Assert the two pages share **no `id`** (keyset neither skips nor duplicates).

The existing `writeAudit persists an entry` test and the six other test files
that call `listAudit(...)` as an array are untouched — backward compatibility is
the reason for keeping `listAudit`'s array return.

## Out of scope (YAGNI)

Page-size selector, jump-to-page, total count / "page N of M", and a "Previous"
button. Forward-only + browser-back matches the rows browser and keeps the
change small.
