# Audit Log Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add forward-only cursor (keyset) pagination to the `/audit` page so an operator can page back through the full audit history instead of seeing only the newest 200 rows.

**Architecture:** Add `listAuditPage()` to `lib/audit.ts` that pages by keyset on `(at DESC, id DESC)` and returns `{ entries, nextCursor }`; refactor the existing `listAudit()` to delegate to it and return just `.entries` so all current callers stay unchanged. The `/audit` server component reads a `cursor` search param, renders a filter-preserving "Next page →" link, and drops the misleading `#` column.

**Tech Stack:** Next.js 16 (RSC), TypeScript, `postgres` lib (`getSql().unsafe`), Vitest with embedded-postgres (`@/test/pg`).

## Global Constraints

- `bun run lint` must stay **clean** repo-wide — keep it that way.
- Run tests with `bun run test` (Vitest) — **never** `bun test`. Typecheck with `bun run typecheck`.
- `.int.test.ts` files use embedded-postgres via `@/test/pg` `startPg()` — one fresh container per file, `fileParallelism: false`, 60s timeout.
- Type `postgres` query results via `(await sql.unsafe(...)) as unknown as { … }[]`; a `postgres` Row will not cast to a typed shape directly (TS2352).
- Cursor encoding mirrors `lib/rows.ts`: `base64url(JSON.stringify(...))`.
- Dev server runs on port **3305** (`bun run dev`).

---

### Task 1: Keyset pagination in the data layer

**Files:**
- Modify: `lib/audit.ts` (add `AuditRow` type, `encodeCursor`/`decodeCursor` helpers, `listAuditPage()`; refactor `listAudit()` to delegate)
- Test: `lib/__tests__/audit.int.test.ts` (add one pagination test)

**Interfaces:**
- Consumes: `getSql` from `@/lib/db`; `auditRel()`, `Operation`, `writeAudit`, `ensureAuditTable` already in `lib/audit.ts`; `withTransaction` from `@/lib/db`.
- Produces:
  - `type AuditRow = { id: string; at: string; actor: string; schemaName: string; tableName: string | null; operation: Operation; pk: unknown; oldValues: unknown; newValues: unknown; statement: string | null }`
  - `listAuditPage(filter?: { schema?: string; table?: string; operation?: Operation; limit?: number; cursor?: string | null }): Promise<{ entries: AuditRow[]; nextCursor: string | null }>`
  - `listAudit(filter?: { schema?: string; table?: string; operation?: Operation; limit?: number }): Promise<AuditRow[]>` (unchanged return type — still an array)

- [ ] **Step 1: Write the failing pagination test**

Append this test to `lib/__tests__/audit.int.test.ts` (after the existing `writeAudit persists an entry` test). The existing test seeds one `DELETE`; this test seeds 55 `INSERT`s, so filtering by `INSERT` isolates exactly these 55 rows within the file's shared container.

```ts
test("listAuditPage keyset-pages without gaps or overlap", async () => {
  const { ensureAuditTable, writeAudit, listAuditPage } = await import("@/lib/audit");
  const { withTransaction } = await import("@/lib/db");
  await ensureAuditTable();

  // Seed 55 INSERT entries (this file's only INSERTs).
  await withTransaction(null, async (tx) => {
    for (let i = 0; i < 55; i++) {
      await writeAudit(tx, {
        actor: "pager", schemaName: "app", tableName: "item",
        operation: "INSERT", pk: { id: i }, oldValues: null,
        newValues: { id: i }, statement: null,
      });
    }
  });

  const page1 = await listAuditPage({ operation: "INSERT", limit: 50 });
  expect(page1.entries.length).toBe(50);
  expect(page1.nextCursor).not.toBeNull();

  const page2 = await listAuditPage({ operation: "INSERT", limit: 50, cursor: page1.nextCursor });
  expect(page2.entries.length).toBe(5);
  expect(page2.nextCursor).toBeNull();

  // Union of both pages must be 55 distinct ids: keyset neither skips nor duplicates.
  const ids = new Set([...page1.entries, ...page2.entries].map((e) => e.id));
  expect(ids.size).toBe(55);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test lib/__tests__/audit.int.test.ts`
Expected: FAIL — `listAuditPage` is not exported (`listAuditPage is not a function` / import undefined).

- [ ] **Step 3: Implement `listAuditPage` and refactor `listAudit`**

In `lib/audit.ts`, add the cursor helpers and `AuditRow` type near the top (below the existing `AuditEntry` type on line 7), then **replace** the entire existing `listAudit` function (lines 36–58) with the two functions below.

Add after line 7 (the `AuditEntry` type):

```ts
export type AuditRow = {
  id: string; at: string; actor: string; schemaName: string;
  tableName: string | null; operation: Operation;
  pk: unknown; oldValues: unknown; newValues: unknown; statement: string | null;
};

function encodeCursor(v: [string, string]): string {
  return Buffer.from(JSON.stringify(v)).toString("base64url");
}
function decodeCursor(c: string): [string, string] {
  return JSON.parse(Buffer.from(c, "base64url").toString("utf8")) as [string, string];
}
```

Replace the existing `listAudit` (lines 36–58) with:

```ts
export async function listAuditPage(
  filter: { schema?: string; table?: string; operation?: Operation; limit?: number; cursor?: string | null } = {},
): Promise<{ entries: AuditRow[]; nextCursor: string | null }> {
  const conds: string[] = []; const args: (string | number)[] = [];
  if (filter.schema) { args.push(filter.schema); conds.push(`schema_name = $${args.length}`); }
  if (filter.table) { args.push(filter.table); conds.push(`table_name = $${args.length}`); }
  if (filter.operation) { args.push(filter.operation); conds.push(`operation = $${args.length}`); }
  if (filter.cursor) {
    const [curAt, curId] = decodeCursor(filter.cursor);
    args.push(curAt); const atIdx = args.length;
    args.push(curId); const idIdx = args.length;
    // Keyset for ORDER BY at DESC, id DESC: next page is strictly "less than" the cursor row.
    conds.push(`(at, id) < ($${atIdx}::timestamptz, $${idIdx}::uuid)`);
  }
  const limit = Math.min(filter.limit ?? 50, 500);
  args.push(limit + 1);
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const rows = (await getSql().unsafe(
    `SELECT id::text, at::text, actor, schema_name, table_name, operation, pk, old_values, new_values, statement
     FROM ${auditRel()} ${where} ORDER BY at DESC, id DESC LIMIT $${args.length}`, args)) as unknown as {
    id: string; at: string; actor: string; schema_name: string; table_name: string | null;
    operation: string; pk: unknown; old_values: unknown; new_values: unknown; statement: string | null;
  }[];

  let nextCursor: string | null = null;
  if (rows.length > limit) {
    rows.pop();
    const last = rows[rows.length - 1];
    nextCursor = encodeCursor([last.at, last.id]);
  }

  const parseJson = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);
  const entries: AuditRow[] = rows.map((r) => ({
    id: r.id, at: r.at, actor: r.actor, schemaName: r.schema_name, tableName: r.table_name,
    operation: r.operation as Operation,
    pk: r.pk == null ? null : parseJson(r.pk),
    oldValues: r.old_values == null ? null : parseJson(r.old_values),
    newValues: r.new_values == null ? null : parseJson(r.new_values),
    statement: r.statement,
  }));
  return { entries, nextCursor };
}

export async function listAudit(
  filter: { schema?: string; table?: string; operation?: Operation; limit?: number } = {},
): Promise<AuditRow[]> {
  return (await listAuditPage(filter)).entries;
}
```

- [ ] **Step 4: Run the pagination test to verify it passes**

Run: `bun run test lib/__tests__/audit.int.test.ts`
Expected: PASS — both tests in the file green (the new pagination test and the pre-existing `writeAudit persists an entry`).

- [ ] **Step 5: Verify backward compatibility across all `listAudit` callers**

Run: `bun run test lib/__tests__/write.int.test.ts lib/__tests__/soft-delete.int.test.ts lib/__tests__/cascade-batch.int.test.ts lib/__tests__/cascade.int.test.ts lib/__tests__/sql-runner.int.test.ts lib/__tests__/audit-self-ensure.int.test.ts`
Expected: PASS — these call `listAudit(...)` as an array (`.length`, `audit[0]`); the array return type is unchanged, so all stay green.

Then run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/audit.ts lib/__tests__/audit.int.test.ts
git commit -m "feat(audit): keyset pagination in listAuditPage; listAudit delegates"
```

---

### Task 2: Wire pagination into the `/audit` page

**Files:**
- Modify: `app/(god)/audit/page.tsx` (switch to `listAuditPage`, add `cursor` param, add "Next page →" link, remove the `#` column)

**Interfaces:**
- Consumes: `listAuditPage` from `@/lib/audit` (from Task 1), `Link` from `next/link`.
- Produces: no new exports — page-level UI change only.

- [ ] **Step 1: Replace the page with the paginated version**

Replace the **entire** contents of `app/(god)/audit/page.tsx` with:

```tsx
import Link from "next/link";
import { Filter } from "lucide-react";
import { listAuditPage, type Operation } from "@/lib/audit";
import { Table, THead, TBody, TR, Th, Td } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";
const OPS: Operation[] = ["INSERT", "UPDATE", "DELETE", "CASCADE_DELETE", "CREATE_SCHEMA", "DROP_SCHEMA", "RAW_SQL"];

// Irreversible operations carry the seal mark in the record.
const SEALED: ReadonlySet<Operation> = new Set(["DELETE", "CASCADE_DELETE", "DROP_SCHEMA"]);

// Map operation types to badge variants (status never by color alone: text carries it).
function opVariant(op: Operation) {
  switch (op) {
    case "DELETE":
    case "CASCADE_DELETE":
    case "DROP_SCHEMA":
      return "danger" as const;
    case "INSERT":
    case "CREATE_SCHEMA":
      return "success" as const;
    case "UPDATE":
    case "RAW_SQL":
    default:
      return "neutral" as const;
  }
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ schema?: string; table?: string; operation?: string; cursor?: string }> }) {
  const sp = await searchParams;
  const { entries, nextCursor } = await listAuditPage({
    schema: sp.schema,
    table: sp.table,
    operation: sp.operation as Operation | undefined,
    cursor: sp.cursor,
    limit: 50,
  });

  // Next-page link keeps the active filters and swaps in the new cursor.
  const nextParams = new URLSearchParams();
  if (sp.schema) nextParams.set("schema", sp.schema);
  if (sp.table) nextParams.set("table", sp.table);
  if (sp.operation) nextParams.set("operation", sp.operation);
  if (nextCursor) nextParams.set("cursor", nextCursor);
  const nextHref = `/audit?${nextParams.toString()}`;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">Audit</p>
        <h1 className="text-2xl font-medium tracking-tight">Audit log</h1>
      </div>

      {/* Filter form */}
      <form className="flex flex-wrap items-center gap-2">
        <Input
          name="schema"
          defaultValue={sp.schema ?? ""}
          placeholder="schema"
          className="max-w-[160px]"
        />
        <Input
          name="table"
          defaultValue={sp.table ?? ""}
          placeholder="table"
          className="max-w-[160px]"
        />
        <select
          name="operation"
          defaultValue={sp.operation ?? ""}
          className="h-9 rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground hover:border-border-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <option value="">any op</option>
          {OPS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <Button type="submit" variant="primary" size="md">
          <Filter className="h-3.5 w-3.5" aria-hidden="true" />
          Filter
        </Button>
      </form>

      {/* Entries */}
      <Table>
        <THead>
          <TR>
            <Th>At</Th>
            <Th>Actor</Th>
            <Th>Target</Th>
            <Th>Op</Th>
            <Th>PK</Th>
            <Th>Changes</Th>
          </TR>
        </THead>
        <TBody>
          {entries.length === 0 ? (
            <tr>
              <td colSpan={6}>
                <EmptyState
                  icon="search"
                  title="No audit entries"
                  hint="No entries match the current filters."
                />
              </td>
            </tr>
          ) : (
            entries.map((e) => (
              <TR key={e.id} className="align-top">
                <Td className="whitespace-nowrap font-mono text-xs text-foreground-muted">
                  {e.at}
                </Td>
                <Td className="text-xs">{e.actor}</Td>
                <Td className="font-mono text-xs">
                  {e.schemaName}
                  {e.tableName ? `.${e.tableName}` : ""}
                </Td>
                <Td>
                  <span className="inline-flex items-center gap-1.5">
                    {SEALED.has(e.operation) && (
                      <span
                        role="img"
                        aria-label="sealed"
                        title="Sealed — irreversible"
                        className="inline-flex h-4 w-4 items-center justify-center rounded-full border-[1.5px] border-seal text-[9px] leading-none text-seal"
                      >
                        ●
                      </span>
                    )}
                    <Badge variant={opVariant(e.operation)}>{e.operation}</Badge>
                  </span>
                </Td>
                <Td className="font-mono text-xs text-foreground-muted">
                  {e.pk ? JSON.stringify(e.pk) : ""}
                </Td>
                <Td className="max-w-md">
                  <details className="group">
                    <summary className="cursor-pointer text-xs font-medium text-link hover:text-link-hover">
                      view
                    </summary>
                    <pre className="mt-1 whitespace-pre-wrap rounded-md bg-surface-muted p-2 font-mono text-xs">
                      old: {JSON.stringify(e.oldValues, null, 2)}
                      {"\n"}new: {JSON.stringify(e.newValues, null, 2)}
                      {e.statement ? `\nsql: ${e.statement}` : ""}
                    </pre>
                  </details>
                </Td>
              </TR>
            ))
          )}
        </TBody>
      </Table>

      {/* Pagination — forward-only, matches the rows browser */}
      {nextCursor && (
        <div className="flex items-center">
          <Link
            href={nextHref}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-foreground-muted transition-colors hover:bg-surface-hover hover:text-foreground"
          >
            Next page
            <span aria-hidden="true">&rarr;</span>
          </Link>
        </div>
      )}
    </div>
  );
}
```

Changes vs. the original, for reviewer clarity:
- Import `Link` from `next/link`; import `listAuditPage` instead of `listAudit`.
- `searchParams` type gains `cursor?: string`.
- Call `listAuditPage({ …, cursor: sp.cursor, limit: 50 })` and destructure `{ entries, nextCursor }` (was `entries = await listAudit({ …, limit: 200 })`).
- Build `nextHref` with `URLSearchParams` preserving `schema`/`table`/`operation` + `cursor`.
- Removed the `#` `<Th>` and its `<Td>` cell; loop is `entries.map((e) => …)` (index `i` no longer needed).
- Empty-state `colSpan` changed `7` → `6`.
- Added the `nextCursor` "Next page →" link block after the table.

- [ ] **Step 2: Typecheck and lint**

Run: `bun run typecheck && bun run lint`
Expected: no type errors; lint clean.

- [ ] **Step 3: Manual verification in the browser**

Boot the app authed (RSC/prop-serialization bugs escape typecheck) and exercise the flow:

Run: `bun run dev` (port 3305), then in the browser visit `http://localhost:3305/audit`.
Verify:
- The table has **no `#` column** (columns: At · Actor · Target · Op · PK · Changes).
- If there are more than 50 entries, a **"Next page →"** link appears below the table; clicking it loads older entries and the URL gains a `cursor=` param.
- Enter a filter (e.g. a schema name) and click **Filter**; when a `nextCursor` exists, the "Next page →" link's URL still carries that filter **and** the cursor. Submitting a new filter drops `cursor` from the URL (resets to the first page).
- Paging to the last page shows no "Next page →" link.

- [ ] **Step 4: Commit**

```bash
git add "app/(god)/audit/page.tsx"
git commit -m "feat(audit): paginate /audit with Next page link; drop # column"
```

---

## Self-Review Notes

- **Spec coverage:** Data layer `listAuditPage` + `listAudit` delegate (Task 1) ← spec §"Data layer"; keyset `(at DESC, id DESC)`, `limit+1` detection, cursor predicate (Task 1 Step 3) ← spec §"Data layer" bullets; page `cursor` param + filter-preserving "Next page →" + reset-on-filter + drop `#` column + `colSpan` 6 (Task 2) ← spec §"Page"; 55-seed pagination test asserting 50/5 split and no-overlap (Task 1 Step 1) ← spec §"Tests"; the six other callers verified untouched (Task 1 Step 5) ← spec §"Tests" backward-compat.
- **Out of scope confirmed absent:** no page-size selector, jump-to-page, total count, or Previous button.
- **Type consistency:** `listAuditPage` returns `{ entries: AuditRow[]; nextCursor: string | null }` in Task 1 and is consumed with exactly that destructuring in Task 2; `AuditRow` fields (`at`, `id`, `schemaName`, `tableName`, `operation`, `pk`, `oldValues`, `newValues`, `statement`) match the page's usage.
