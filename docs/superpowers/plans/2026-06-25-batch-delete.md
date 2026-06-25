# Batch (multi-select) Cascade Delete — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator check multiple rows on a table grid and cascade-delete them together via one combined blast-radius preview and a single typed `DELETE`, executed all-or-nothing in one transaction.

**Architecture:** Generalize the existing single-row cascade engine (`lib/cascade.ts`) to operate on N seed rows, sharing one BFS and one transactional delete loop with the single-row path. Add a batch confirm route that reuses the existing `ConfirmDelete` component, a thin server action, and checkbox selection state in the existing `RowGrid` client component.

**Tech Stack:** Next.js 16 App Router + TypeScript, React Server Components for reads + Server Actions for mutations, `postgres` (postgres.js) raw SQL with runtime catalog introspection, Vitest (+ embedded-postgres for integration, jsdom + Testing Library for components), Tailwind.

## Global Constraints

- **No ORM.** All DB access is raw SQL via `postgres.js` (`getSql()`, `withTransaction`) with identifiers quoted through `lib/sql-guard` (`ident`, `qualified`).
- **Cascade fail-safes are mandatory and unchanged:** refuse if the blast radius is `truncated` (exceeds `CASCADE_MAX_ROWS` / `CASCADE_MAX_DEPTH`), and refuse if involved tables form an FK cycle.
- **Batch never drops tenant Postgres schemas** (v1). Only the per-row BU delete does.
- **Every mutation writes an audit row** (`CASCADE_DELETE`) via `writeAudit(tx, …)` inside the same transaction.
- **Test runner:** `bun run test` runs all tests (`vitest run`); target one file with `bunx vitest run <path>`. `.tsx` tests run in jsdom; integration tests start embedded-postgres via `startPg()` from `@/test/pg`. `fileParallelism` is off.
- **Verification gates per task:** `bun run typecheck` clean and the task's tests pass. Lint has pre-existing repo-wide `@typescript-eslint/no-explicit-any` debt (incl. `lib/cascade.ts`'s `as any[]`); do **not** introduce new lint errors in files that are currently clean, and match the existing `as any[]` style where moving existing code.
- **Commit after each task.**

---

### Task 1: Generalize blast-radius computation to N seeds

**Files:**
- Modify: `lib/cascade.ts` (replace `computeBlastRadius`, lines 21-94)
- Test: `lib/__tests__/cascade-batch.int.test.ts` (create)

**Interfaces:**
- Consumes: existing `rowKey`, `childrenFks`, `CascadeRow`, `BlastRadius`, `listForeignKeys`, `describeTable`, `env`, `getSql`, `ident`, `qualified`, `whereFromPk`.
- Produces: `computeBlastRadiusMany(schema: string, table: string, pks: Record<string, unknown>[]): Promise<BlastRadius>`. `computeBlastRadius(schema, table, pk)` now delegates to it with `[pk]`.

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/cascade-batch.int.test.ts`:

```ts
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import type { Pg } from "@/test/pg";
import { startPg } from "@/test/pg";

let container: Pg;
beforeAll(async () => {
  const pg = await startPg();
  container = pg.container;
  process.env.DATABASE_URL = pg.url;
  process.env.SYSTEM_DATABASE_URL = pg.url;
  process.env.SYSTEM_SCHEMA_NAME = "CARMEN_SYSTEM";
  process.env.GOD_MODE_PASSWORD = "x";
  process.env.SESSION_SECRET = "x".repeat(32);
  process.env.CASCADE_MAX_ROWS = "5000";
  process.env.CASCADE_MAX_DEPTH = "20";
  vi.mock("@/lib/session", () => ({ getSession: async () => ({ actor: "tester", authed: true }) }));
  const { getSql } = await import("@/lib/db");
  await getSql().unsafe(`
    CREATE SCHEMA "CARMEN_SYSTEM";
    CREATE SCHEMA app;
    CREATE TABLE app.bu (id int primary key, name text);
    CREATE TABLE app.role (id int primary key, bu_id int references app.bu(id));
    CREATE TABLE app.perm (id int primary key, role_id int references app.role(id));
    INSERT INTO app.bu VALUES (1,'BU1'),(2,'BU2');
    INSERT INTO app.role VALUES (10,1),(11,1),(20,2);
    INSERT INTO app.perm VALUES (100,10),(101,11),(200,20);

    -- FK cycle for the refusal test (Task 2)
    CREATE TABLE app.aa (id int primary key, bb_id int);
    CREATE TABLE app.bb (id int primary key, aa_id int references app.aa(id));
    ALTER TABLE app.aa ADD CONSTRAINT aa_bb_fk FOREIGN KEY (bb_id) REFERENCES app.bb(id);
    INSERT INTO app.aa VALUES (1, NULL);
    INSERT INTO app.bb VALUES (1, 1);
    UPDATE app.aa SET bb_id = 1 WHERE id = 1;

    -- isolated subtree with a no-PK child for the atomicity/rollback test (Task 2)
    CREATE TABLE app.iso (id int primary key, name text);
    CREATE TABLE app.iso_child (iso_id int references app.iso(id), note text);
    INSERT INTO app.iso VALUES (1,'iso1');
    INSERT INTO app.iso_child VALUES (1,'blocks');
  `);
  const { ensureAuditTable } = await import("@/lib/audit");
  await ensureAuditTable();
});
afterAll(async () => { await container.stop(); });

test("computeBlastRadiusMany combines distinct seeds without double-counting", async () => {
  const { computeBlastRadiusMany } = await import("@/lib/cascade");
  const r = await computeBlastRadiusMany("app", "bu", [{ id: 1 }, { id: 2 }]);
  // bu1 subtree (5) + bu2 subtree (3) = 8 distinct rows
  expect(r.rows.length).toBe(8);
  expect(r.maxDepth).toBe(2);
});

test("computeBlastRadiusMany dedups identical seeds", async () => {
  const { computeBlastRadiusMany } = await import("@/lib/cascade");
  const r = await computeBlastRadiusMany("app", "role", [{ id: 10 }, { id: 10 }]);
  // role10 + perm100 only, the duplicate seed is ignored
  expect(r.rows.length).toBe(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run lib/__tests__/cascade-batch.int.test.ts`
Expected: FAIL — `computeBlastRadiusMany` is not exported from `@/lib/cascade`.

- [ ] **Step 3: Replace `computeBlastRadius` in `lib/cascade.ts`**

Replace the entire current `computeBlastRadius` function (lines 21-94) with these two functions:

```ts
export async function computeBlastRadius(schema: string, table: string, pk: Record<string, unknown>): Promise<BlastRadius> {
  return computeBlastRadiusMany(schema, table, [pk]);
}

export async function computeBlastRadiusMany(schema: string, table: string, pks: Record<string, unknown>[]): Promise<BlastRadius> {
  const maxRows = env().cascadeMaxRows, maxDepth = env().cascadeMaxDepth;
  const fkCache = new Map<string, ForeignKey[]>();
  async function fksFor(s: string): Promise<ForeignKey[]> {
    if (!fkCache.has(s)) fkCache.set(s, await listForeignKeys(s));
    return fkCache.get(s)!;
  }
  const pkColsCache = new Map<string, string[]>();
  async function pkCols(s: string, t: string): Promise<string[]> {
    const k = `${s}.${t}`;
    if (!pkColsCache.has(k)) pkColsCache.set(k, (await describeTable(s, t)).primaryKey);
    return pkColsCache.get(k)!;
  }

  const seen = new Set<string>();
  const rows: CascadeRow[] = [];
  let truncated = false;
  const queue: CascadeRow[] = [];
  for (const pk of pks) {
    const key = rowKey(schema, table, pk);
    if (seen.has(key)) continue;
    seen.add(key);
    const seed: CascadeRow = { schema, table, pk, depth: 0 };
    rows.push(seed);
    queue.push(seed);
  }

  while (queue.length) {
    const node = queue.shift()!;
    if (node.depth >= maxDepth) { truncated = true; continue; }
    const fks = await fksFor(node.schema);
    for (const f of childrenFks(fks, node.schema, node.table)) {
      const childPk = await pkCols(f.childSchema, f.childTable);
      if (childPk.length === 0) continue; // can't address rows without a pk
      const whereParts = f.childColumns.map((c, i) => `${ident(c)} = $${i + 1}`);
      // C1 fix: if the FK references a non-PK unique column, node.pk won't have those values.
      // Fast path: all parentColumns are present in node.pk.
      let refValues: unknown[];
      const allInPk = f.parentColumns.every((pc) => pc in node.pk);
      if (allInPk) {
        refValues = f.parentColumns.map((pc) => node.pk[pc]);
      } else {
        // Slow path: SELECT the referenced columns from the parent row using the PK.
        const { clause: pkClause, args: pkArgs } = whereFromPk(node.pk, 1);
        const selectCols = f.parentColumns.map(ident).join(", ");
        const refRows = await getSql().unsafe(
          `SELECT ${selectCols} FROM ${qualified(node.schema, node.table)} WHERE ${pkClause} LIMIT 1`,
          pkArgs as any[],
        ) as Record<string, unknown>[];
        if (refRows.length === 0) continue; // parent row doesn't exist, skip
        refValues = f.parentColumns.map((pc) => refRows[0][pc]);
      }
      const args = refValues;
      const selectPk = childPk.map(ident).join(", ");
      const found = await getSql().unsafe(
        `SELECT ${selectPk} FROM ${qualified(f.childSchema, f.childTable)} WHERE ${whereParts.join(" AND ")}`, args as any[],
      ) as Record<string, unknown>[];
      for (const r of found) {
        const cpk = Object.fromEntries(childPk.map((c) => [c, r[c]]));
        const key = rowKey(f.childSchema, f.childTable, cpk);
        if (seen.has(key)) continue;
        seen.add(key);
        const childRow: CascadeRow = { schema: f.childSchema, table: f.childTable, pk: cpk, depth: node.depth + 1 };
        rows.push(childRow);
        queue.push(childRow);
        if (rows.length >= maxRows) { truncated = true; queue.length = 0; break; }
      }
      if (truncated) break;
    }
  }

  const counts = new Map<string, number>();
  let maxDepthSeen = 0;
  for (const r of rows) {
    counts.set(`${r.schema}.${r.table}`, (counts.get(`${r.schema}.${r.table}`) ?? 0) + 1);
    if (r.depth > maxDepthSeen) maxDepthSeen = r.depth;
  }
  const byTable = [...counts].map(([k, count]) => { const [s, t] = k.split("."); return { schema: s, table: t, count }; });
  return { rows, byTable, maxDepth: maxDepthSeen, truncated };
}
```

- [ ] **Step 4: Run the new + existing cascade tests to verify they pass**

Run: `bunx vitest run lib/__tests__/cascade-batch.int.test.ts lib/__tests__/cascade.int.test.ts`
Expected: PASS — both batch compute tests pass, and the existing single-target tests (`computeBlastRadius finds all descendants`, the C1 non-PK test) still pass unchanged.

- [ ] **Step 5: Commit**

```bash
git add lib/cascade.ts lib/__tests__/cascade-batch.int.test.ts
git commit -m "feat: computeBlastRadiusMany — combined blast radius for N rows"
```

---

### Task 2: Shared transactional delete + `executeCascadeMany`

**Files:**
- Modify: `lib/cascade.ts` (replace `executeCascade`, lines 96-149)
- Test: `lib/__tests__/cascade-batch.int.test.ts` (append)

**Interfaces:**
- Consumes: `computeBlastRadius`, `computeBlastRadiusMany` (Task 1), `currentActor`, `orderTablesForDeletion`, `listForeignKeys`, `writeAudit`, `withTransaction`, `TableRef`, `ForeignKey`, `CascadeRow`, `BlastRadius`.
- Produces: `executeCascadeMany(schema: string, table: string, pks: Record<string, unknown>[]): Promise<{ deleted: number }>`. Private `deleteRadius(actor, radius, opts)` shared by `executeCascade` and `executeCascadeMany`. `executeCascade`'s public signature and behavior are unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `lib/__tests__/cascade-batch.int.test.ts`:

```ts
test("executeCascadeMany refuses on FK cycle and deletes nothing", async () => {
  const { executeCascadeMany } = await import("@/lib/cascade");
  const { getSql } = await import("@/lib/db");
  await expect(executeCascadeMany("app", "aa", [{ id: 1 }])).rejects.toThrow(/cycle/i);
  const left = await getSql().unsafe(`SELECT count(*)::int n FROM app.aa`);
  expect(left[0].n).toBe(1);
});

test("executeCascadeMany rolls back the whole batch if any delete fails", async () => {
  // app.iso_child has no PK, so it is not in the blast radius and is never deleted;
  // deleting app.iso then violates iso_child's FK, which must abort the transaction.
  const { executeCascadeMany } = await import("@/lib/cascade");
  const { getSql } = await import("@/lib/db");
  await expect(executeCascadeMany("app", "iso", [{ id: 1 }])).rejects.toThrow();
  const left = await getSql().unsafe(`SELECT count(*)::int n FROM app.iso`);
  expect(left[0].n).toBe(1); // unchanged — rolled back
});

test("executeCascadeMany deletes all selected subtrees and audits each row", async () => {
  const { executeCascadeMany } = await import("@/lib/cascade");
  const { getSql } = await import("@/lib/db");
  const res = await executeCascadeMany("app", "bu", [{ id: 1 }, { id: 2 }]);
  expect(res.deleted).toBe(8);
  for (const t of ["bu", "role", "perm"]) {
    const left = await getSql().unsafe(`SELECT count(*)::int n FROM app.${t}`);
    expect(left[0].n).toBe(0);
  }
  const { listAudit } = await import("@/lib/audit");
  const audit = await listAudit({ operation: "CASCADE_DELETE", limit: 50 });
  expect(audit.length).toBe(8);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run lib/__tests__/cascade-batch.int.test.ts`
Expected: FAIL — `executeCascadeMany` is not exported from `@/lib/cascade`.

- [ ] **Step 3: Replace `executeCascade` in `lib/cascade.ts`**

Replace the entire current `executeCascade` function (lines 96-149) with the shared helper plus both public functions:

```ts
async function deleteRadius(
  actor: string, radius: BlastRadius, opts: { dropTenantSchema?: string | null },
): Promise<{ deleted: number; droppedSchema: string | null }> {
  if (radius.truncated) throw new Error("Blast radius exceeds configured caps; refusing to cascade. Raise CASCADE_MAX_ROWS/DEPTH or narrow the target.");

  const involvedTables: TableRef[] = [...new Set(radius.rows.map((r) => `${r.schema}.${r.table}`))]
    .map((k) => { const [s, t] = k.split("."); return { schema: s, table: t }; });
  const allFks: ForeignKey[] = [];
  for (const s of new Set(involvedTables.map((t) => t.schema))) allFks.push(...await listForeignKeys(s));
  const { order, cycles } = orderTablesForDeletion(involvedTables, allFks);

  // If a genuine multi-table FK cycle exists, refuse to proceed (fail-safe).
  if (cycles.length > 0) {
    throw new Error(
      "Cannot cascade: foreign-key cycle among tables " +
      cycles.flat().join(", ") +
      " (NO ACTION FKs cannot be deleted in any order). Resolve manually.",
    );
  }

  const rowsByTable = new Map<string, CascadeRow[]>();
  for (const r of radius.rows) {
    const k = `${r.schema}.${r.table}`;
    if (!rowsByTable.has(k)) rowsByTable.set(k, []);
    rowsByTable.get(k)!.push(r);
  }

  return withTransaction(null, async (tx) => {
    let deleted = 0;
    for (const t of order) {
      const list = rowsByTable.get(`${t.schema}.${t.table}`) ?? [];
      for (const r of list) {
        const keys = Object.keys(r.pk);
        const clause = keys.map((k, i) => `${ident(k)} = $${i + 1}`).join(" AND ");
        const args = keys.map((k) => r.pk[k]);
        const oldRows = await tx.unsafe(`SELECT * FROM ${qualified(t.schema, t.table)} WHERE ${clause}`, args as any[]);
        await tx.unsafe(`DELETE FROM ${qualified(t.schema, t.table)} WHERE ${clause}`, args as any[]);
        await writeAudit(tx, { actor, schemaName: t.schema, tableName: t.table, operation: "CASCADE_DELETE",
          pk: r.pk, oldValues: oldRows[0] ?? null, newValues: null, statement: `DELETE FROM ${qualified(t.schema, t.table)}` });
        deleted += 1;
      }
    }
    let droppedSchema: string | null = null;
    if (opts.dropTenantSchema) {
      await tx.unsafe(`DROP SCHEMA ${ident(opts.dropTenantSchema)} CASCADE`);
      droppedSchema = opts.dropTenantSchema;
      await writeAudit(tx, { actor, schemaName: opts.dropTenantSchema, tableName: null, operation: "DROP_SCHEMA",
        pk: null, oldValues: null, newValues: null, statement: `DROP SCHEMA ${ident(opts.dropTenantSchema)} CASCADE` });
    }
    return { deleted, droppedSchema };
  });
}

export async function executeCascade(
  schema: string, table: string, pk: Record<string, unknown>, opts: { dropTenantSchema?: string | null },
): Promise<{ deleted: number; droppedSchema: string | null }> {
  const actor = await currentActor();
  const radius = await computeBlastRadius(schema, table, pk);
  return deleteRadius(actor, radius, opts);
}

export async function executeCascadeMany(
  schema: string, table: string, pks: Record<string, unknown>[],
): Promise<{ deleted: number }> {
  const actor = await currentActor();
  const radius = await computeBlastRadiusMany(schema, table, pks);
  const { deleted } = await deleteRadius(actor, radius, { dropTenantSchema: null });
  return { deleted };
}
```

- [ ] **Step 4: Run the full cascade suite to verify it passes**

Run: `bunx vitest run lib/__tests__/cascade-batch.int.test.ts lib/__tests__/cascade.int.test.ts lib/__tests__/cascade-truncate.int.test.ts`
Expected: PASS — new batch execute tests pass and all existing cascade tests (single delete, cycle refusal, truncate) still pass.

- [ ] **Step 5: Commit**

```bash
git add lib/cascade.ts lib/__tests__/cascade-batch.int.test.ts
git commit -m "feat: executeCascadeMany — all-or-nothing batch cascade delete"
```

---

### Task 3: `radiusTouchesBusinessUnits` helper

**Files:**
- Modify: `lib/delete-confirm.ts`
- Test: `lib/__tests__/delete-confirm.test.ts` (append)

**Interfaces:**
- Produces: `radiusTouchesBusinessUnits(byTable: Array<{ schema: string; table: string }>, systemSchema: string): boolean`.

- [ ] **Step 1: Write the failing tests**

Append to `lib/__tests__/delete-confirm.test.ts`:

```ts
import { radiusTouchesBusinessUnits } from "@/lib/delete-confirm";

test("radiusTouchesBusinessUnits is true when system tb_business_unit is present", () => {
  const byTable = [
    { schema: "CARMEN_SYSTEM", table: "tb_cluster" },
    { schema: "CARMEN_SYSTEM", table: "tb_business_unit" },
  ];
  expect(radiusTouchesBusinessUnits(byTable, "CARMEN_SYSTEM")).toBe(true);
});

test("radiusTouchesBusinessUnits is false for other tables or a different schema", () => {
  expect(radiusTouchesBusinessUnits([{ schema: "CARMEN_SYSTEM", table: "tb_cluster" }], "CARMEN_SYSTEM")).toBe(false);
  expect(radiusTouchesBusinessUnits([{ schema: "app", table: "tb_business_unit" }], "CARMEN_SYSTEM")).toBe(false);
});
```

> Note: if `delete-confirm.test.ts` does not already `import { expect, test } from "vitest";`, add it at the top (match the existing imports in that file).

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run lib/__tests__/delete-confirm.test.ts`
Expected: FAIL — `radiusTouchesBusinessUnits` is not exported from `@/lib/delete-confirm`.

- [ ] **Step 3: Add the helper to `lib/delete-confirm.ts`**

Append to `lib/delete-confirm.ts`:

```ts
export function radiusTouchesBusinessUnits(
  byTable: Array<{ schema: string; table: string }>,
  systemSchema: string,
): boolean {
  return byTable.some((b) => b.schema === systemSchema && b.table === "tb_business_unit");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run lib/__tests__/delete-confirm.test.ts`
Expected: PASS — 5 tests (3 existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add lib/delete-confirm.ts lib/__tests__/delete-confirm.test.ts
git commit -m "feat: radiusTouchesBusinessUnits helper for orphan-schema warning"
```

---

### Task 4: Batch confirm route + `confirmBatchDelete` server action

**Files:**
- Create: `app/(god)/[schema]/[table]/delete-batch/page.tsx`
- Modify: `server/delete.ts`

**Interfaces:**
- Consumes: `computeBlastRadiusMany`, `executeCascadeMany` (Tasks 1-2), `radiusTouchesBusinessUnits` (Task 3), `requiredPhrase`, `phraseMatches`, `ConfirmDelete`, `SchemaBanner`, `env`, `requireAuth`, `revalidatePath`, `redirect`.
- Produces: `confirmBatchDelete(schema: string, table: string, pksJson: string, formData: FormData): Promise<void>`; the `/(god)/[schema]/[table]/delete-batch` route.

> This task is glue over already-tested units (RSC page + server action with `redirect`), which the repo does not unit-test (cf. the existing single-row `confirmDelete`). Its gate is typecheck + a route smoke check.

- [ ] **Step 1: Add `confirmBatchDelete` to `server/delete.ts`**

Change the cascade import line:

```ts
import { executeCascade, executeCascadeMany } from "@/lib/cascade";
```

Append this function to `server/delete.ts`:

```ts
export async function confirmBatchDelete(schema: string, table: string, pksJson: string, formData: FormData): Promise<void> {
  await requireAuth();
  const pks = JSON.parse(pksJson) as Record<string, unknown>[];
  if (!Array.isArray(pks) || pks.length === 0) throw new Error("No rows selected");
  const phrase = requiredPhrase({ isBusinessUnit: false, dropSchema: null });
  if (!phraseMatches(String(formData.get("confirm") ?? ""), phrase)) {
    throw new Error(`Confirmation text must equal "${phrase}"`);
  }
  await executeCascadeMany(schema, table, pks);
  revalidatePath(`/${schema}/${table}`);
  redirect(`/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`);
}
```

- [ ] **Step 2: Create the batch confirm page**

Create `app/(god)/[schema]/[table]/delete-batch/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { env } from "@/lib/env";
import { computeBlastRadiusMany } from "@/lib/cascade";
import { requiredPhrase, radiusTouchesBusinessUnits } from "@/lib/delete-confirm";
import { confirmBatchDelete } from "@/server/delete";
import { ConfirmDelete } from "@/components/confirm-delete";
import { SchemaBanner } from "@/components/schema-banner";

export const dynamic = "force-dynamic";

export default async function DeleteBatchPage({
  params, searchParams,
}: { params: Promise<{ schema: string; table: string }>; searchParams: Promise<{ pks?: string }> }) {
  const { schema, table } = await params;
  const { pks: pksParam } = await searchParams;
  if (!pksParam) notFound();
  const pks = JSON.parse(pksParam) as Record<string, unknown>[];
  if (!Array.isArray(pks) || pks.length === 0) notFound();
  const radius = await computeBlastRadiusMany(schema, table, pks);
  const action = confirmBatchDelete.bind(null, schema, table, JSON.stringify(pks));
  const orphanWarning = radiusTouchesBusinessUnits(radius.byTable, env().systemSchemaName);
  return (
    <div>
      <SchemaBanner schema={schema} />
      <h1 className="my-3 text-lg font-semibold font-mono">Delete {pks.length} selected row(s) from {schema}.{table}</h1>
      {orphanWarning && (
        <p className="mb-3 rounded border border-amber-400 bg-amber-50 p-2 text-sm text-amber-900">
          ⚠ This cascade deletes <strong>business-unit registry rows</strong>, but their tenant Postgres schemas are not
          linked by a foreign key and will <strong>not</strong> be dropped — they will be left orphaned. To drop a tenant
          schema, delete that business unit individually from the registry.
        </p>
      )}
      <ConfirmDelete schema={schema} table={table} pkJson={JSON.stringify(pks)} radius={radius}
        action={action} isBusinessUnit={false} tenantSchema={null}
        requiredPhrase={requiredPhrase({ isBusinessUnit: false, dropSchema: null })} />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: clean (no output, exit 0).

- [ ] **Step 4: Smoke-check the route compiles**

Ensure the dev server is running (`bun run dev`), then:

Run: `curl -s -o /dev/null -w "%{http_code}" "http://localhost:3305/CARMEN_SYSTEM/tb_cluster/delete-batch?pks=%5B%5D"`
Expected: `307` (unauthenticated → redirected to `/login` by middleware). A `500` means the module failed to compile — fix before continuing. (Authenticated rendering is verified manually in the final review.)

- [ ] **Step 5: Commit**

```bash
git add server/delete.ts "app/(god)/[schema]/[table]/delete-batch/page.tsx"
git commit -m "feat: batch delete confirm route + confirmBatchDelete action"
```

---

### Task 5: Selection UI in RowGrid

**Files:**
- Modify: `components/row-grid.tsx`
- Test: `components/__tests__/row-grid.test.tsx` (create)

**Interfaces:**
- Consumes: the `/{schema}/{table}/delete-batch?pks=…` route (Task 4) as a plain href string; `RowPage` type.
- Produces: checkbox selection + a "Delete N selected" link in `RowGrid`. Existing per-row edit/delete links and pagination are preserved.

- [ ] **Step 1: Write the failing tests**

Create `components/__tests__/row-grid.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
import type { RowPage } from "@/lib/rows";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

const page: RowPage = {
  columns: [{ name: "id", dataType: "integer", udtName: "int4", isNullable: false, default: null, isPrimaryKey: true }],
  primaryKey: ["id"],
  rows: [{ id: 1 }, { id: 2 }],
  nextCursor: null,
};

test("no Delete-selected control until a row is checked", async () => {
  const { RowGrid } = await import("@/components/row-grid");
  render(<RowGrid schema="app" table="t" page={page} />);
  expect(screen.queryByText(/Delete .* selected/)).not.toBeInTheDocument();
});

test("checking a row reveals Delete N selected with the correct href", async () => {
  const { RowGrid } = await import("@/components/row-grid");
  render(<RowGrid schema="app" table="t" page={page} />);
  fireEvent.click(screen.getByLabelText("select row 0"));
  const link = screen.getByText("Delete 1 selected").closest("a")!;
  expect(link).toHaveAttribute("href", `/app/t/delete-batch?pks=${encodeURIComponent(JSON.stringify([{ id: 1 }]))}`);
});

test("select-all checks every row on the page", async () => {
  const { RowGrid } = await import("@/components/row-grid");
  render(<RowGrid schema="app" table="t" page={page} />);
  fireEvent.click(screen.getByLabelText("select all"));
  expect(screen.getByText("Delete 2 selected")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run components/__tests__/row-grid.test.tsx`
Expected: FAIL — there are no `select row 0` / `select all` checkboxes yet.

- [ ] **Step 3: Replace `components/row-grid.tsx`**

Replace the whole file with:

```tsx
"use client";
import { useState } from "react";
import Link from "next/link";
import type { RowPage } from "@/lib/rows";

export function RowGrid({ schema, table, page }: { schema: string; table: string; page: RowPage }) {
  const readOnly = page.primaryKey.length === 0;
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function pkKey(row: Record<string, unknown>): string {
    return JSON.stringify(pk(row, page.primaryKey));
  }
  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) => (prev.size === page.rows.length ? new Set() : new Set(page.rows.map(pkKey))));
  }

  const selectedPks = [...selected].map((k) => JSON.parse(k) as Record<string, unknown>);
  const batchHref = `/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/delete-batch?pks=${encodeURIComponent(JSON.stringify(selectedPks))}`;
  const allSelected = page.rows.length > 0 && selected.size === page.rows.length;

  return (
    <div className="overflow-x-auto">
      {readOnly && <p className="mb-2 rounded bg-yellow-100 p-2 text-sm">No primary key — this table is read-only in god mode.</p>}
      {!readOnly && selected.size > 0 && (
        <div className="mb-2 flex items-center gap-3">
          <span className="text-sm">{selected.size} selected</span>
          <Link href={batchHref} className="rounded bg-red-600 px-3 py-1 text-sm font-semibold text-white">
            Delete {selected.size} selected
          </Link>
        </div>
      )}
      <table className="min-w-full text-sm">
        <thead><tr className="border-b text-left">
          {!readOnly && <th className="px-2"><input type="checkbox" aria-label="select all" checked={allSelected} onChange={toggleAll} /></th>}
          {page.columns.map((c) => <th key={c.name} className="px-2 py-1 font-mono">{c.name}</th>)}
          {!readOnly && <th className="px-2">actions</th>}
        </tr></thead>
        <tbody>
          {page.rows.map((row, i) => {
            const key = readOnly ? String(i) : pkKey(row);
            return (
              <tr key={i} className="border-b">
                {!readOnly && <td className="px-2"><input type="checkbox" aria-label={`select row ${i}`} checked={selected.has(key)} onChange={() => toggle(key)} /></td>}
                {page.columns.map((c) => <td key={c.name} className="max-w-xs truncate px-2 py-1">{format(row[c.name])}</td>)}
                {!readOnly && <td className="whitespace-nowrap px-2">
                  <Link className="text-blue-600" href={`/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/edit?pk=${encodeURIComponent(JSON.stringify(pk(row, page.primaryKey)))}`}>edit</Link>
                  {" · "}
                  <Link className="text-red-600" href={`/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/delete?pk=${encodeURIComponent(JSON.stringify(pk(row, page.primaryKey)))}`}>delete</Link>
                </td>}
              </tr>
            );
          })}
        </tbody>
      </table>
      {page.nextCursor && (
        <Link className="mt-3 inline-block text-blue-600" href={`/${encodeURIComponent(schema)}/${encodeURIComponent(table)}?cursor=${encodeURIComponent(page.nextCursor)}`}>next →</Link>
      )}
    </div>
  );
}

function pk(row: Record<string, unknown>, keys: string[]) { return Object.fromEntries(keys.map((k) => [k, row[k]])); }
function format(v: unknown): string {
  if (v === null || v === undefined) return "∅";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run components/__tests__/row-grid.test.tsx`
Expected: PASS — all 3 selection tests pass.

- [ ] **Step 5: Full verification**

Run: `bun run typecheck && bun run test`
Expected: typecheck clean; all tests pass (existing suite + the new batch, helper, and grid tests).

- [ ] **Step 6: Commit**

```bash
git add components/row-grid.tsx components/__tests__/row-grid.test.tsx
git commit -m "feat: multi-select rows + Delete N selected on table grid"
```

---

## Final manual verification (after Task 5)

With `bun run dev` running and logged in, open `http://localhost:3305/CARMEN_SYSTEM/tb_cluster`:
1. Check two cluster rows → a "Delete 2 selected" button appears.
2. Click it → the batch confirm page shows the **combined** blast radius, the orphaned-tenant-schema warning (because clusters cascade into `tb_business_unit`), and a type-`DELETE` box.
3. (On disposable data only) type `DELETE` and submit → rows deleted in one transaction, redirected back to the grid, and the audit log shows one `CASCADE_DELETE` per deleted row.

## Self-Review

- **Spec coverage:** §3.1 → Tasks 1-2; §3.2 → Task 5; §3.3 → Task 4 (page); §3.4 → Task 4 (action); §3.5 → tests in Tasks 1-3, 5; orphan warning (§2) → Task 3 helper + Task 4 page; all-or-nothing (§2) → Task 2 rollback test; current-page-only / no-drop-schema (§5) → enforced by Task 5 (page-scoped selection) and Task 4 (`dropTenantSchema: null`). No gaps.
- **Type consistency:** `computeBlastRadiusMany(schema, table, pks)` and `executeCascadeMany(schema, table, pks)` used identically across Tasks 1-2-4; `radiusTouchesBusinessUnits(byTable, systemSchema)` defined in Task 3 and called with `radius.byTable` in Task 4; `confirmBatchDelete(schema, table, pksJson, formData)` defined and bound consistently.
- **Placeholder scan:** none — every step shows complete code or an exact command with expected output.
