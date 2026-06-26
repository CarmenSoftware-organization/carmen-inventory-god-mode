# Cluster Management Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated `/clusters` god-mode page to manage `CARMEN_SYSTEM.tb_cluster` with add, edit, soft delete, restore, hard delete, and batch variants.

**Architecture:** A dedicated Server Component page (`/clusters`) wraps a new `ClustersTable` client component with two tabs (Active | Deleted). Soft delete/restore are new reversible operations backed by a small reusable `lib/soft-delete.ts` helper (sets/clears a `deleted_at` column) and thin server actions. Hard delete reuses the existing cascade/batch-delete engine and confirm routes, generalized to drop *multiple* orphaned tenant schemas. Add/edit reuse the generic `RowForm` on dedicated cluster routes.

**Tech Stack:** Next.js 16.2.9 (App Router, RSC, server actions), React 19, `postgres` (pg driver), iron-session, Zod, Tailwind v4, Vitest + Testing Library, embedded-postgres for integration tests, bun runtime.

## Global Constraints

- **Next.js is heavily modified in this repo.** Per `AGENTS.md`: before writing any code in a route/server-action/component file, read the relevant guide under `node_modules/next/dist/docs/`. Heed deprecation notices.
- **Runtime is bun.** Run scripts with `bun run <script>` (e.g. `bun run test`, `bun run typecheck`, `bun run lint`, `bun run migrate`). Dev server runs on port **3305**.
- **SQL safety is mandatory.** Never interpolate identifiers or values raw. Use `ident()` / `qualified()` from `@/lib/sql-guard` for identifiers and `$1,$2,…` parameters for values (the `postgres` driver, `.unsafe(sql, args)`). Casts like `as any[]` on the args array match existing code style.
- **System schema** comes from `env().systemSchemaName` (default `"CARMEN_SYSTEM"`). The cluster table is `tb_cluster`; its primary key column is `id` (uuid). The soft-delete column is `deleted_at` (`timestamptz`, NULL = active).
- **TDD, DRY, YAGNI, frequent commits.** Each task ends green and committed.
- Async `params` / `searchParams` in App Router routes are **Promises** — `await` them (see existing routes).

---

### Task 1: Idempotent `deleted_at` migration

Ensures `tb_cluster.deleted_at` exists before any soft-delete code runs. Idempotent (`ADD COLUMN IF NOT EXISTS`) so it doubles as the "verify the column exists" step from the spec.

**Files:**
- Create: `lib/migrations.ts`
- Create: `lib/__tests__/migrations.int.test.ts`
- Modify: `scripts/migrate.ts`

**Interfaces:**
- Produces: `ensureClusterDeletedAt(): Promise<void>` — adds `deleted_at timestamptz` to `<systemSchema>.tb_cluster` if missing; silently no-ops if the table is absent (`42P01`).

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/migrations.int.test.ts`:

```ts
import { afterAll, beforeAll, expect, test } from "vitest";
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
  const { getSql } = await import("@/lib/db");
  await getSql().unsafe(`
    CREATE SCHEMA "CARMEN_SYSTEM";
    CREATE TABLE "CARMEN_SYSTEM".tb_cluster (id uuid primary key default gen_random_uuid(), code text, name text);
  `);
});
afterAll(async () => { await container.stop(); });

test("ensureClusterDeletedAt adds the column and is idempotent", async () => {
  const { ensureClusterDeletedAt } = await import("@/lib/migrations");
  const { describeTable } = await import("@/lib/introspect");

  await ensureClusterDeletedAt();
  let cols = (await describeTable("CARMEN_SYSTEM", "tb_cluster")).columns.map((c) => c.name);
  expect(cols).toContain("deleted_at");

  // idempotent: a second run does not throw
  await ensureClusterDeletedAt();
  cols = (await describeTable("CARMEN_SYSTEM", "tb_cluster")).columns.map((c) => c.name);
  expect(cols.filter((c) => c === "deleted_at")).toHaveLength(1);
});

test("ensureClusterDeletedAt no-ops when the table is absent", async () => {
  const { getSql } = await import("@/lib/db");
  await getSql().unsafe(`DROP TABLE "CARMEN_SYSTEM".tb_cluster`);
  const { ensureClusterDeletedAt } = await import("@/lib/migrations");
  await expect(ensureClusterDeletedAt()).resolves.toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test lib/__tests__/migrations.int.test.ts`
Expected: FAIL — cannot resolve `@/lib/migrations`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/migrations.ts`:

```ts
import { getSql } from "@/lib/db";
import { env } from "@/lib/env";
import { qualified } from "@/lib/sql-guard";

/** Ensure tb_cluster has a deleted_at column for soft delete. Idempotent; no-op if the table is absent. */
export async function ensureClusterDeletedAt(): Promise<void> {
  const rel = qualified(env().systemSchemaName, "tb_cluster");
  try {
    await getSql().unsafe(`ALTER TABLE ${rel} ADD COLUMN IF NOT EXISTS deleted_at timestamptz`);
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === "42P01") return; // table absent — nothing to migrate
    throw err;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test lib/__tests__/migrations.int.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Wire into the migrate script**

Replace the contents of `scripts/migrate.ts` with:

```ts
import { ensureAuditTable } from "@/lib/audit";
import { ensureClusterDeletedAt } from "@/lib/migrations";

Promise.resolve()
  .then(() => ensureAuditTable())
  .then(() => ensureClusterDeletedAt())
  .then(() => { console.log("migrations ready"); process.exit(0); })
  .catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 6: Typecheck and commit**

Run: `bun run typecheck`
Expected: no errors.

```bash
git add lib/migrations.ts lib/__tests__/migrations.int.test.ts scripts/migrate.ts
git commit -m "feat: idempotent tb_cluster.deleted_at migration"
```

---

### Task 2: Soft-delete helper + audit operations

The reusable core of soft delete / restore.

**Files:**
- Modify: `lib/audit.ts:6` (extend the `Operation` union)
- Create: `lib/soft-delete.ts`
- Create: `lib/__tests__/soft-delete.int.test.ts`

**Interfaces:**
- Consumes: `currentActor`, `whereFromPk` from `@/lib/write`; `writeAudit` from `@/lib/audit`; `withTransaction` from `@/lib/db`; `ident`, `qualified` from `@/lib/sql-guard`.
- Produces:
  - `softDeleteRows(schema: string, table: string, pks: Record<string, unknown>[], opts?: { deletedAtColumn?: string }): Promise<{ affected: number }>`
  - `restoreRows(schema: string, table: string, pks: Record<string, unknown>[], opts?: { deletedAtColumn?: string }): Promise<{ affected: number }>`
  - Audit `Operation` now includes `"SOFT_DELETE" | "RESTORE"`.

- [ ] **Step 1: Extend the audit Operation union**

In `lib/audit.ts`, change line 6 from:

```ts
export type Operation = "INSERT" | "UPDATE" | "DELETE" | "CASCADE_DELETE" | "DROP_SCHEMA" | "RAW_SQL";
```

to:

```ts
export type Operation = "INSERT" | "UPDATE" | "DELETE" | "CASCADE_DELETE" | "DROP_SCHEMA" | "RAW_SQL" | "SOFT_DELETE" | "RESTORE";
```

- [ ] **Step 2: Write the failing test**

Create `lib/__tests__/soft-delete.int.test.ts`:

```ts
import { afterAll, beforeAll, expect, test } from "vitest";
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
  const { getSql } = await import("@/lib/db");
  await getSql().unsafe(`
    CREATE SCHEMA "CARMEN_SYSTEM";
    CREATE TABLE app_c (id int primary key, name text, deleted_at timestamptz);
    INSERT INTO app_c VALUES (1,'a',NULL),(2,'b',NULL),(3,'c',NULL);
  `);
  const { ensureAuditTable } = await import("@/lib/audit");
  await ensureAuditTable();
});
afterAll(async () => { await container.stop(); });

test("softDeleteRows sets deleted_at on the selected rows only", async () => {
  const { softDeleteRows } = await import("@/lib/soft-delete");
  const { getSql } = await import("@/lib/db");
  const res = await softDeleteRows("public", "app_c", [{ id: 1 }, { id: 2 }]);
  expect(res.affected).toBe(2);
  const rows = await getSql().unsafe(`SELECT id, deleted_at FROM app_c ORDER BY id`);
  expect(rows[0].deleted_at).not.toBeNull();
  expect(rows[1].deleted_at).not.toBeNull();
  expect(rows[2].deleted_at).toBeNull();
});

test("restoreRows clears deleted_at", async () => {
  const { restoreRows } = await import("@/lib/soft-delete");
  const { getSql } = await import("@/lib/db");
  const res = await restoreRows("public", "app_c", [{ id: 1 }]);
  expect(res.affected).toBe(1);
  const rows = await getSql().unsafe(`SELECT deleted_at FROM app_c WHERE id = 1`);
  expect(rows[0].deleted_at).toBeNull();
});

test("soft delete and restore write audit rows", async () => {
  const { listAudit } = await import("@/lib/audit");
  expect((await listAudit({ operation: "SOFT_DELETE", limit: 50 })).length).toBeGreaterThanOrEqual(2);
  expect((await listAudit({ operation: "RESTORE", limit: 50 })).length).toBeGreaterThanOrEqual(1);
});

test("empty selection throws", async () => {
  const { softDeleteRows } = await import("@/lib/soft-delete");
  await expect(softDeleteRows("public", "app_c", [])).rejects.toThrow();
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun run test lib/__tests__/soft-delete.int.test.ts`
Expected: FAIL — cannot resolve `@/lib/soft-delete`.

- [ ] **Step 4: Write minimal implementation**

Create `lib/soft-delete.ts`:

```ts
import { withTransaction } from "@/lib/db";
import { ident, qualified } from "@/lib/sql-guard";
import { writeAudit, type Operation } from "@/lib/audit";
import { currentActor, whereFromPk } from "@/lib/write";

type Opts = { deletedAtColumn?: string };

async function setDeletedAt(
  schema: string, table: string, pks: Record<string, unknown>[],
  valueSql: "now()" | "NULL", operation: Operation, col: string,
): Promise<{ affected: number }> {
  if (!Array.isArray(pks) || pks.length === 0) throw new Error("No rows selected");
  const actor = await currentActor();
  return withTransaction(null, async (tx) => {
    let affected = 0;
    for (const pk of pks) {
      const { clause, args } = whereFromPk(pk, 1);
      const rows = await tx.unsafe(
        `UPDATE ${qualified(schema, table)} SET ${ident(col)} = ${valueSql} WHERE ${clause} RETURNING *`,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        args as any[],
      );
      if (rows.length > 0) {
        await writeAudit(tx, {
          actor, schemaName: schema, tableName: table, operation, pk,
          oldValues: null, newValues: rows[0] ?? null,
          statement: `UPDATE ${qualified(schema, table)} SET ${ident(col)} = ${valueSql}`,
        });
        affected += rows.length;
      }
    }
    return { affected };
  });
}

export async function softDeleteRows(
  schema: string, table: string, pks: Record<string, unknown>[], opts: Opts = {},
): Promise<{ affected: number }> {
  return setDeletedAt(schema, table, pks, "now()", "SOFT_DELETE", opts.deletedAtColumn ?? "deleted_at");
}

export async function restoreRows(
  schema: string, table: string, pks: Record<string, unknown>[], opts: Opts = {},
): Promise<{ affected: number }> {
  return setDeletedAt(schema, table, pks, "NULL", "RESTORE", opts.deletedAtColumn ?? "deleted_at");
}
```

(`valueSql` is a fixed internal literal — never user input — so inlining it is safe; the column name is guarded by `ident()`.)

- [ ] **Step 5: Run test to verify it passes**

Run: `bun run test lib/__tests__/soft-delete.int.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/audit.ts lib/soft-delete.ts lib/__tests__/soft-delete.int.test.ts
git commit -m "feat: reusable soft-delete/restore helper with audit"
```

---

### Task 3: Registry — `listClusters` and `resolveTenantSchemasForCluster`

**Files:**
- Modify: `lib/registry.ts` (add type + two functions)
- Create: `lib/__tests__/registry-clusters.int.test.ts`

**Interfaces:**
- Produces:
  - `type Cluster = { id: string; code: string; name: string; deletedAt: string | null; businessUnitCount: number }`
  - `listClusters(): Promise<Cluster[]>` — all clusters ordered by `code`; returns `[]` on missing table (`42P01`).
  - `resolveTenantSchemasForCluster(clusterId: string): Promise<string[]>` — distinct, non-null tenant schema names across the cluster's business units.

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/registry-clusters.int.test.ts`:

```ts
import { afterAll, beforeAll, expect, test } from "vitest";
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
  const { getSql } = await import("@/lib/db");
  await getSql().unsafe(`
    CREATE SCHEMA "CARMEN_SYSTEM";
    CREATE TABLE "CARMEN_SYSTEM".tb_cluster (
      id uuid primary key default gen_random_uuid(),
      code text not null, name text not null, deleted_at timestamptz
    );
    CREATE TABLE "CARMEN_SYSTEM".tb_business_unit (
      id uuid primary key default gen_random_uuid(),
      cluster_id uuid, code text not null, name text not null,
      is_active boolean default true, db_connection jsonb
    );
    INSERT INTO "CARMEN_SYSTEM".tb_cluster (id, code, name, deleted_at) VALUES
      ('11111111-1111-1111-1111-111111111111','CL-A','Alpha',NULL),
      ('22222222-2222-2222-2222-222222222222','CL-B','Beta', now());
    INSERT INTO "CARMEN_SYSTEM".tb_business_unit (cluster_id, code, name, db_connection) VALUES
      ('11111111-1111-1111-1111-111111111111','BU1','BU One', '{"schema":"tenant_one"}'::jsonb),
      ('11111111-1111-1111-1111-111111111111','BU2','BU Two', '{"schema":"tenant_two"}'::jsonb),
      ('11111111-1111-1111-1111-111111111111','BU3','BU Three', NULL);
  `);
});
afterAll(async () => { await container.stop(); });

test("listClusters returns code/name/deletedAt and businessUnitCount", async () => {
  const { listClusters } = await import("@/lib/registry");
  const clusters = await listClusters();
  const a = clusters.find((c) => c.code === "CL-A")!;
  const b = clusters.find((c) => c.code === "CL-B")!;
  expect(a.deletedAt).toBeNull();
  expect(a.businessUnitCount).toBe(3);
  expect(b.deletedAt).not.toBeNull();
  expect(b.businessUnitCount).toBe(0);
});

test("resolveTenantSchemasForCluster returns distinct non-null schemas", async () => {
  const { resolveTenantSchemasForCluster } = await import("@/lib/registry");
  const schemas = await resolveTenantSchemasForCluster("11111111-1111-1111-1111-111111111111");
  expect(schemas.sort()).toEqual(["tenant_one", "tenant_two"]);
});

test("listClusters returns [] when tb_cluster is absent (42P01)", async () => {
  const { getSql } = await import("@/lib/db");
  await getSql().unsafe(`DROP TABLE "CARMEN_SYSTEM".tb_cluster`);
  const { listClusters } = await import("@/lib/registry");
  expect(await listClusters()).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test lib/__tests__/registry-clusters.int.test.ts`
Expected: FAIL — `listClusters` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `lib/registry.ts`, add after the `BusinessUnit` type/functions:

```ts
export type Cluster = { id: string; code: string; name: string; deletedAt: string | null; businessUnitCount: number };

export async function listClusters(): Promise<Cluster[]> {
  const cl = qualified(env().systemSchemaName, "tb_cluster");
  const bu = qualified(env().systemSchemaName, "tb_business_unit");
  try {
    const rows = await getSql().unsafe(
      `SELECT c.id::text, c.code, c.name, c.deleted_at::text AS deleted_at,
              (SELECT count(*) FROM ${bu} b WHERE b.cluster_id = c.id)::int AS business_unit_count
       FROM ${cl} c ORDER BY c.code`,
    );
    return rows.map((r: any) => ({
      id: r.id, code: r.code, name: r.name,
      deletedAt: r.deleted_at ?? null, businessUnitCount: r.business_unit_count,
    }));
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === "42P01") return [];
    throw err;
  }
}

export async function resolveTenantSchemasForCluster(clusterId: string): Promise<string[]> {
  const bu = qualified(env().systemSchemaName, "tb_business_unit");
  const rows = await getSql().unsafe(
    `SELECT DISTINCT db_connection->>'schema' AS tenant_schema
     FROM ${bu} WHERE cluster_id = $1::uuid AND db_connection->>'schema' IS NOT NULL`,
    [clusterId],
  );
  return rows.map((r: any) => r.tenant_schema as string);
}
```

(`getSql`, `env`, `qualified` are already imported at the top of `lib/registry.ts`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test lib/__tests__/registry-clusters.int.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/registry.ts lib/__tests__/registry-clusters.int.test.ts
git commit -m "feat: listClusters + resolveTenantSchemasForCluster registry helpers"
```

---

### Task 4: Generalize cascade to drop multiple tenant schemas

Behavior-preserving refactor: change the engine's single `dropTenantSchema` option into a `dropTenantSchemas: string[]` list (loop the drops in the same transaction). The BU single-delete call site is updated mechanically; existing behavior is unchanged. Cluster-specific wiring comes in Task 7.

**Files:**
- Modify: `lib/cascade.ts:106-174` (`deleteRadius`, `executeCascade`, `executeCascadeMany`)
- Modify: `server/delete.ts:14-22` (call site)
- Modify: `lib/__tests__/cascade.int.test.ts` (add a multi-schema-drop test)

**Interfaces:**
- Produces (changed signatures):
  - `deleteRadius(actor, radius, opts: { dropTenantSchemas?: string[] }): Promise<{ deleted: number; droppedSchemas: string[] }>`
  - `executeCascade(schema, table, pk, opts: { dropTenantSchemas?: string[] }): Promise<{ deleted: number; droppedSchemas: string[] }>`
  - `executeCascadeMany(schema, table, pks): Promise<{ deleted: number }>` (unchanged signature; internally passes `{ dropTenantSchemas: [] }`)

- [ ] **Step 1: Write the failing test**

Add to `lib/__tests__/cascade.int.test.ts` (append a new test; the `beforeAll` already creates schema `app`):

```ts
test("executeCascade drops multiple tenant schemas in one transaction", async () => {
  const { executeCascade } = await import("@/lib/cascade");
  const { getSql } = await import("@/lib/db");
  await getSql().unsafe(`
    CREATE TABLE app.drv (id int primary key);
    INSERT INTO app.drv VALUES (1);
    CREATE SCHEMA tdrop1;
    CREATE SCHEMA tdrop2;
  `);
  const res = await executeCascade("app", "drv", { id: 1 }, { dropTenantSchemas: ["tdrop1", "tdrop2"] });
  expect(res.droppedSchemas.sort()).toEqual(["tdrop1", "tdrop2"]);
  const left = await getSql().unsafe(
    `SELECT nspname FROM pg_namespace WHERE nspname IN ('tdrop1','tdrop2')`,
  );
  expect(left.length).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test lib/__tests__/cascade.int.test.ts`
Expected: FAIL — `dropTenantSchemas` not accepted / `res.droppedSchemas` undefined (and a TS error).

- [ ] **Step 3: Update the engine**

In `lib/cascade.ts`, change `deleteRadius`'s signature (line ~106-108) from:

```ts
async function deleteRadius(
  actor: string, radius: BlastRadius, opts: { dropTenantSchema?: string | null },
): Promise<{ deleted: number; droppedSchema: string | null }> {
```

to:

```ts
async function deleteRadius(
  actor: string, radius: BlastRadius, opts: { dropTenantSchemas?: string[] },
): Promise<{ deleted: number; droppedSchemas: string[] }> {
```

Replace the drop block (lines ~148-155) from:

```ts
    let droppedSchema: string | null = null;
    if (opts.dropTenantSchema) {
      await tx.unsafe(`DROP SCHEMA ${ident(opts.dropTenantSchema)} CASCADE`);
      droppedSchema = opts.dropTenantSchema;
      await writeAudit(tx, { actor, schemaName: opts.dropTenantSchema, tableName: null, operation: "DROP_SCHEMA",
        pk: null, oldValues: null, newValues: null, statement: `DROP SCHEMA ${ident(opts.dropTenantSchema)} CASCADE` });
    }
    return { deleted, droppedSchema };
```

to:

```ts
    const droppedSchemas: string[] = [];
    for (const s of opts.dropTenantSchemas ?? []) {
      await tx.unsafe(`DROP SCHEMA ${ident(s)} CASCADE`);
      droppedSchemas.push(s);
      await writeAudit(tx, { actor, schemaName: s, tableName: null, operation: "DROP_SCHEMA",
        pk: null, oldValues: null, newValues: null, statement: `DROP SCHEMA ${ident(s)} CASCADE` });
    }
    return { deleted, droppedSchemas };
```

Change `executeCascade` (lines ~159-165) from:

```ts
export async function executeCascade(
  schema: string, table: string, pk: Record<string, unknown>, opts: { dropTenantSchema?: string | null },
): Promise<{ deleted: number; droppedSchema: string | null }> {
  const actor = await currentActor();
  const radius = await computeBlastRadius(schema, table, pk);
  return deleteRadius(actor, radius, opts);
}
```

to:

```ts
export async function executeCascade(
  schema: string, table: string, pk: Record<string, unknown>, opts: { dropTenantSchemas?: string[] },
): Promise<{ deleted: number; droppedSchemas: string[] }> {
  const actor = await currentActor();
  const radius = await computeBlastRadius(schema, table, pk);
  return deleteRadius(actor, radius, opts);
}
```

Change `executeCascadeMany`'s internal call (line ~172) from:

```ts
  const { deleted } = await deleteRadius(actor, radius, { dropTenantSchema: null });
```

to:

```ts
  const { deleted } = await deleteRadius(actor, radius, { dropTenantSchemas: [] });
```

- [ ] **Step 4: Update the call site in `server/delete.ts`**

In `server/delete.ts`, change line 22 from:

```ts
  await executeCascade(schema, table, pk, { dropTenantSchema: dropSchema });
```

to:

```ts
  await executeCascade(schema, table, pk, { dropTenantSchemas: dropSchema ? [dropSchema] : [] });
```

(Leave the surrounding BU logic and `dropSchema` resolution unchanged for now — Task 7 adds the cluster branch.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun run test lib/__tests__/cascade.int.test.ts`
Expected: PASS (all existing tests + the new multi-schema-drop test).

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/cascade.ts server/delete.ts lib/__tests__/cascade.int.test.ts
git commit -m "refactor: cascade engine drops a list of tenant schemas"
```

---

### Task 5: Cluster server actions

Soft delete / restore / insert / update actions for clusters. Soft delete and restore read selected PKs from a hidden form field; insert/update reuse the generic write machinery.

**Files:**
- Modify: `server/rows.ts` (export `valuesFromForm`)
- Create: `server/cluster-actions.ts`

**Interfaces:**
- Consumes: `softDeleteRows`, `restoreRows` from `@/lib/soft-delete`; `valuesFromForm` from `@/server/rows`; `applyInsert`, `applyUpdate` from `@/lib/write`; `requireAuth` from `@/lib/session`; `env` from `@/lib/env`.
- Produces (all `"use server"`):
  - `softDeleteClusters(formData: FormData): Promise<void>` — reads `pks` (JSON array of `{ id }`) from formData.
  - `restoreClusters(formData: FormData): Promise<void>` — same shape.
  - `submitClusterInsert(formData: FormData): Promise<void>`
  - `submitClusterUpdate(pkJson: string, formData: FormData): Promise<void>`

- [ ] **Step 1: Export `valuesFromForm` from `server/rows.ts`**

In `server/rows.ts`, change line 9 from:

```ts
async function valuesFromForm(schema: string, table: string, formData: FormData, includeAllColumns: boolean) {
```

to:

```ts
export async function valuesFromForm(schema: string, table: string, formData: FormData, includeAllColumns: boolean) {
```

- [ ] **Step 2: Create the cluster actions**

Create `server/cluster-actions.ts`:

```ts
"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { env } from "@/lib/env";
import { requireAuth } from "@/lib/session";
import { softDeleteRows, restoreRows } from "@/lib/soft-delete";
import { valuesFromForm } from "@/server/rows";
import { applyInsert, applyUpdate } from "@/lib/write";

const TABLE = "tb_cluster";

function parsePks(formData: FormData): Record<string, unknown>[] {
  const pks = JSON.parse(String(formData.get("pks") ?? "[]"));
  if (!Array.isArray(pks) || pks.length === 0) throw new Error("No rows selected");
  return pks as Record<string, unknown>[];
}

export async function softDeleteClusters(formData: FormData): Promise<void> {
  await requireAuth();
  await softDeleteRows(env().systemSchemaName, TABLE, parsePks(formData));
  revalidatePath("/clusters");
}

export async function restoreClusters(formData: FormData): Promise<void> {
  await requireAuth();
  await restoreRows(env().systemSchemaName, TABLE, parsePks(formData));
  revalidatePath("/clusters");
}

export async function submitClusterInsert(formData: FormData): Promise<void> {
  await requireAuth();
  const schema = env().systemSchemaName;
  const values = await valuesFromForm(schema, TABLE, formData, false);
  await applyInsert(schema, TABLE, values);
  revalidatePath("/clusters");
  redirect("/clusters");
}

export async function submitClusterUpdate(pkJson: string, formData: FormData): Promise<void> {
  await requireAuth();
  const schema = env().systemSchemaName;
  const pk = JSON.parse(pkJson) as Record<string, unknown>;
  // includeAllColumns=false: the cluster edit form hides deleted_at, so we must NOT
  // touch columns absent from the form (true would clobber deleted_at to "").
  const values = await valuesFromForm(schema, TABLE, formData, false);
  for (const k of Object.keys(pk)) delete values[k];
  await applyUpdate(schema, TABLE, pk, values);
  revalidatePath("/clusters");
  redirect("/clusters");
}
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

(No unit test here: these are thin wrappers that call `revalidatePath`/`redirect`, which require the Next request scope and aren't unit-testable outside it — matching the existing `server/delete.ts` and `server/rows.ts` pattern. The underlying `softDeleteRows`/`restoreRows`/`applyInsert`/`applyUpdate` are covered by their own integration tests; the wiring is covered by typecheck and the Task 6 component test.)

- [ ] **Step 4: Lint and commit**

Run: `bun run lint`
Expected: no errors.

```bash
git add server/rows.ts server/cluster-actions.ts
git commit -m "feat: cluster server actions (soft delete, restore, insert, update)"
```

---

### Task 6: `ClustersTable` client component

The tabbed UI. Hard-delete uses links to the existing confirm routes; soft delete / restore use forms whose `action` is a server-action prop (passed from the page), keeping the component unit-testable.

**Files:**
- Create: `components/clusters-table.tsx`
- Create: `components/__tests__/clusters-table.test.tsx`

**Interfaces:**
- Consumes: `Cluster` from `@/lib/registry`.
- Produces: `ClustersTable` component with props:
  ```ts
  {
    clusters: Cluster[];
    system: string;
    softDeleteAction: (formData: FormData) => void;
    restoreAction: (formData: FormData) => void;
  }
  ```

- [ ] **Step 1: Write the failing test**

Create `components/__tests__/clusters-table.test.tsx`:

```tsx
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);
import type { ReactNode } from "react";
import type { Cluster } from "@/lib/registry";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

const clusters: Cluster[] = [
  { id: "11", code: "CL-A", name: "Alpha", deletedAt: null, businessUnitCount: 2 },
  { id: "22", code: "CL-B", name: "Beta", deletedAt: "2026-06-26 00:00:00+00", businessUnitCount: 0 },
];

function renderTable(C: typeof import("@/components/clusters-table")["ClustersTable"]) {
  return render(<C clusters={clusters} system="CARMEN_SYSTEM" softDeleteAction={vi.fn()} restoreAction={vi.fn()} />);
}

test("active tab shows active clusters and hides deleted ones", async () => {
  const { ClustersTable } = await import("@/components/clusters-table");
  renderTable(ClustersTable);
  expect(screen.getByText("CL-A")).toBeInTheDocument();
  expect(screen.queryByText("CL-B")).not.toBeInTheDocument();
  expect(screen.getByText("+ Add cluster").closest("a")).toHaveAttribute("href", "/clusters/new");
});

test("editing link points at the dedicated cluster edit route", async () => {
  const { ClustersTable } = await import("@/components/clusters-table");
  renderTable(ClustersTable);
  expect(screen.getByText("Edit").closest("a")).toHaveAttribute("href", "/clusters/11/edit");
});

test("selecting an active row reveals a soft-delete form carrying the pks", async () => {
  const { ClustersTable } = await import("@/components/clusters-table");
  renderTable(ClustersTable);
  fireEvent.click(screen.getByLabelText("select row 0"));
  const form = screen.getByText("Soft delete 1 selected").closest("form")!;
  const hidden = form.querySelector('input[name="pks"]') as HTMLInputElement;
  expect(hidden.value).toBe(JSON.stringify([{ id: "11" }]));
});

test("deleted tab shows deleted clusters with restore and hard-delete controls", async () => {
  const { ClustersTable } = await import("@/components/clusters-table");
  renderTable(ClustersTable);
  fireEvent.click(screen.getByText(/^Deleted/));
  expect(screen.getByText("CL-B")).toBeInTheDocument();
  expect(screen.queryByText("CL-A")).not.toBeInTheDocument();
  expect(screen.getByText("Hard delete").closest("a")).toHaveAttribute(
    "href",
    `/CARMEN_SYSTEM/tb_cluster/delete?pk=${encodeURIComponent(JSON.stringify({ id: "22" }))}`,
  );
});

test("batch hard delete on the deleted tab targets delete-batch", async () => {
  const { ClustersTable } = await import("@/components/clusters-table");
  renderTable(ClustersTable);
  fireEvent.click(screen.getByText(/^Deleted/));
  fireEvent.click(screen.getByLabelText("select row 0"));
  expect(screen.getByText("Hard delete 1 selected").closest("a")).toHaveAttribute(
    "href",
    `/CARMEN_SYSTEM/tb_cluster/delete-batch?pks=${encodeURIComponent(JSON.stringify([{ id: "22" }]))}`,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test components/__tests__/clusters-table.test.tsx`
Expected: FAIL — cannot resolve `@/components/clusters-table`.

- [ ] **Step 3: Write the component**

Create `components/clusters-table.tsx`:

```tsx
"use client";
import { useState } from "react";
import Link from "next/link";
import type { Cluster } from "@/lib/registry";

type Tab = "active" | "deleted";

export function ClustersTable({
  clusters, system, softDeleteAction, restoreAction,
}: {
  clusters: Cluster[]; system: string;
  softDeleteAction: (formData: FormData) => void;
  restoreAction: (formData: FormData) => void;
}) {
  const [tab, setTab] = useState<Tab>("active");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const active = clusters.filter((c) => c.deletedAt === null);
  const deleted = clusters.filter((c) => c.deletedAt !== null);
  const rows = tab === "active" ? active : deleted;

  const key = (c: Cluster) => JSON.stringify({ id: c.id });
  function switchTab(next: Tab) { setTab(next); setSelected(new Set()); }
  function toggle(k: string) {
    setSelected((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  }
  function toggleAll() {
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map(key))));
  }

  const selectedPks = [...selected].map((k) => JSON.parse(k) as { id: string });
  const allSelected = rows.length > 0 && selected.size === rows.length;
  const batchDeleteHref = `/${encodeURIComponent(system)}/tb_cluster/delete-batch?pks=${encodeURIComponent(JSON.stringify(selectedPks))}`;

  return (
    <div className="overflow-x-auto">
      <div className="mb-3 flex gap-2">
        <button onClick={() => switchTab("active")}
          className={`rounded px-3 py-1 text-sm ${tab === "active" ? "bg-black text-white" : "border"}`}>
          Active ({active.length})
        </button>
        <button onClick={() => switchTab("deleted")}
          className={`rounded px-3 py-1 text-sm ${tab === "deleted" ? "bg-black text-white" : "border"}`}>
          Deleted ({deleted.length})
        </button>
      </div>

      {tab === "active" && (
        <div className="mb-2 flex items-center gap-3">
          <Link href="/clusters/new" className="rounded bg-black px-3 py-1 text-sm font-semibold text-white">+ Add cluster</Link>
          {selected.size > 0 && (
            <form action={softDeleteAction}>
              <input type="hidden" name="pks" value={JSON.stringify(selectedPks)} />
              <button className="rounded bg-amber-600 px-3 py-1 text-sm font-semibold text-white">Soft delete {selected.size} selected</button>
            </form>
          )}
        </div>
      )}

      {tab === "deleted" && selected.size > 0 && (
        <div className="mb-2 flex items-center gap-3">
          <form action={restoreAction}>
            <input type="hidden" name="pks" value={JSON.stringify(selectedPks)} />
            <button className="rounded bg-green-700 px-3 py-1 text-sm font-semibold text-white">Restore {selected.size} selected</button>
          </form>
          <Link href={batchDeleteHref} className="rounded bg-red-600 px-3 py-1 text-sm font-semibold text-white">Hard delete {selected.size} selected</Link>
        </div>
      )}

      <table className="w-full text-sm">
        <thead><tr className="border-b text-left">
          <th className="px-2"><input type="checkbox" aria-label="select all" checked={allSelected} onChange={toggleAll} /></th>
          <th>Code</th><th>Name</th>
          {tab === "active" ? <th># Business Units</th> : <th>Deleted at</th>}
          <th></th>
        </tr></thead>
        <tbody>
          {rows.map((c, i) => {
            const k = key(c);
            return (
              <tr key={c.id} className={`border-b ${tab === "deleted" ? "text-gray-400 line-through" : ""}`}>
                <td className="px-2"><input type="checkbox" aria-label={`select row ${i}`} checked={selected.has(k)} onChange={() => toggle(k)} /></td>
                <td className="py-1 font-mono">{c.code}</td>
                <td>{c.name}</td>
                {tab === "active" ? <td>{c.businessUnitCount}</td> : <td>{c.deletedAt}</td>}
                <td className="space-x-3 text-right">
                  {tab === "active" ? (
                    <>
                      <Link href={`/clusters/${encodeURIComponent(c.id)}/edit`} className="text-blue-600">Edit</Link>
                      <form action={softDeleteAction} className="inline">
                        <input type="hidden" name="pks" value={JSON.stringify([{ id: c.id }])} />
                        <button className="text-amber-700">Soft delete</button>
                      </form>
                    </>
                  ) : (
                    <>
                      <form action={restoreAction} className="inline">
                        <input type="hidden" name="pks" value={JSON.stringify([{ id: c.id }])} />
                        <button className="text-green-700">Restore</button>
                      </form>
                      <Link href={`/${encodeURIComponent(system)}/tb_cluster/delete?pk=${encodeURIComponent(JSON.stringify({ id: c.id }))}`} className="text-red-600">Hard delete</Link>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test components/__tests__/clusters-table.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add components/clusters-table.tsx components/__tests__/clusters-table.test.tsx
git commit -m "feat: ClustersTable component with Active/Deleted tabs and batch actions"
```

---

### Task 7: Hard-delete cluster wiring (confirm UI + routes)

Make the single hard-delete confirm page offer dropping the cluster's orphaned tenant schemas, and make both single and batch hard delete of clusters redirect back to `/clusters`.

**Files:**
- Modify: `components/confirm-delete.tsx` (add `orphanSchemas` prop)
- Modify: `app/(god)/[schema]/[table]/delete/page.tsx` (cluster branch)
- Modify: `server/delete.ts` (`confirmDelete` cluster drop + redirect; `confirmBatchDelete` cluster redirect)
- Create: `components/__tests__/confirm-delete.test.tsx`

**Interfaces:**
- Consumes: `resolveTenantSchemasForCluster` from `@/lib/registry`; `executeCascade` (now `{ dropTenantSchemas }`).
- Produces: `ConfirmDelete` gains optional prop `orphanSchemas?: string[]`.

- [ ] **Step 1: Read the Next docs**

Per `AGENTS.md`, before editing the route/server-action files, read the relevant guide(s) under `node_modules/next/dist/docs/` (server actions, route handlers / pages). Note anything that affects `redirect`/`revalidatePath` usage.

- [ ] **Step 2: Write the failing test**

Create `components/__tests__/confirm-delete.test.tsx`:

```tsx
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { BlastRadius } from "@/lib/cascade";

afterEach(cleanup);

const radius: BlastRadius = {
  rows: [{ schema: "CARMEN_SYSTEM", table: "tb_cluster", pk: { id: "1" }, depth: 0 }],
  byTable: [{ schema: "CARMEN_SYSTEM", table: "tb_cluster", count: 1 }],
  maxDepth: 0, truncated: false,
};

test("renders an orphan-schemas drop checkbox listing each schema", async () => {
  const { ConfirmDelete } = await import("@/components/confirm-delete");
  render(<ConfirmDelete schema="CARMEN_SYSTEM" table="tb_cluster" pkJson={JSON.stringify({ id: "1" })}
    radius={radius} action={vi.fn()} isBusinessUnit={false} tenantSchema={null}
    orphanSchemas={["tenant_one", "tenant_two"]} requiredPhrase="DELETE" />);
  const box = screen.getByRole("checkbox");
  expect(box).toHaveAttribute("name", "drop_schema");
  expect(screen.getByText(/tenant_one/)).toBeInTheDocument();
  expect(screen.getByText(/tenant_two/)).toBeInTheDocument();
});

test("no orphan checkbox when orphanSchemas is empty/absent", async () => {
  const { ConfirmDelete } = await import("@/components/confirm-delete");
  render(<ConfirmDelete schema="CARMEN_SYSTEM" table="tb_cluster" pkJson={JSON.stringify({ id: "1" })}
    radius={radius} action={vi.fn()} isBusinessUnit={false} tenantSchema={null}
    requiredPhrase="DELETE" />);
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun run test components/__tests__/confirm-delete.test.tsx`
Expected: FAIL — `orphanSchemas` not a prop; no checkbox rendered.

- [ ] **Step 4: Add the `orphanSchemas` prop to `ConfirmDelete`**

In `components/confirm-delete.tsx`, update the props destructure/type to add `orphanSchemas`:

```tsx
export function ConfirmDelete({
  schema, table, pkJson, radius, action, isBusinessUnit, tenantSchema, orphanSchemas, requiredPhrase,
}: {
  schema: string; table: string; pkJson: string; radius: BlastRadius;
  action: (fd: FormData) => void; isBusinessUnit: boolean; tenantSchema: string | null;
  orphanSchemas?: string[]; requiredPhrase: string;
}) {
```

Then, immediately after the existing `{isBusinessUnit && tenantSchema && ( … )}` block, add:

```tsx
      {orphanSchemas && orphanSchemas.length > 0 && (
        <label className="flex items-start gap-2 rounded border border-amber-400 bg-amber-50 p-2 text-sm">
          <input type="checkbox" name="drop_schema" />
          <span>Also <strong>DROP {orphanSchemas.length} tenant schema(s) CASCADE</strong>: <code>{orphanSchemas.join(", ")}</code> (wipes each tenant database)</span>
        </label>
      )}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun run test components/__tests__/confirm-delete.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Wire the single delete route for clusters**

In `app/(god)/[schema]/[table]/delete/page.tsx`, add the cluster branch. Add the import:

```ts
import { resolveTenantSchema, resolveTenantSchemasForCluster } from "@/lib/registry";
```

(replace the existing `import { resolveTenantSchema } from "@/lib/registry";`). After the `tenantSchema` line, add:

```ts
  const isCluster = schema === env().systemSchemaName && table === "tb_cluster";
  const orphanSchemas = isCluster ? await resolveTenantSchemasForCluster(String(pk.id)) : undefined;
```

And pass `orphanSchemas` to `<ConfirmDelete …>` (add the prop to the existing element):

```tsx
      <ConfirmDelete schema={schema} table={table} pkJson={JSON.stringify(pk)} radius={radius}
        action={action} isBusinessUnit={isBusinessUnit} tenantSchema={tenantSchema}
        orphanSchemas={orphanSchemas}
        requiredPhrase={requiredPhrase({ isBusinessUnit, dropSchema: null })} />
```

- [ ] **Step 7: Wire `server/delete.ts` cluster drop + redirects**

In `server/delete.ts`:

Add the import for the cluster resolver — change:

```ts
import { resolveTenantSchema } from "@/lib/registry";
```

to:

```ts
import { resolveTenantSchema, resolveTenantSchemasForCluster } from "@/lib/registry";
```

Replace the body of `confirmDelete` (lines ~11-28) with:

```ts
export async function confirmDelete(schema: string, table: string, pkJson: string, formData: FormData): Promise<void> {
  await requireAuth();
  const pk = JSON.parse(pkJson) as Record<string, unknown>;
  const isBusinessUnit = schema === env().systemSchemaName && table === "tb_business_unit";
  const isCluster = schema === env().systemSchemaName && table === "tb_cluster";
  let dropSchemas: string[] = [];
  if (formData.get("drop_schema") === "on") {
    if (isBusinessUnit) {
      const s = await resolveTenantSchema(String(pk.id));
      if (s) dropSchemas = [s];
    } else if (isCluster) {
      dropSchemas = await resolveTenantSchemasForCluster(String(pk.id));
    }
  }
  // BU keeps the schema-name confirmation phrase when dropping its single schema;
  // cluster drops multiple schemas, so the phrase stays "DELETE".
  const phrase = requiredPhrase({ isBusinessUnit, dropSchema: isBusinessUnit ? (dropSchemas[0] ?? null) : null });
  if (!phraseMatches(String(formData.get("confirm") ?? ""), phrase)) {
    throw new Error(`Confirmation text must equal "${phrase}"`);
  }
  await executeCascade(schema, table, pk, { dropTenantSchemas: dropSchemas });
  if (isBusinessUnit) { revalidatePath("/schemas"); redirect("/schemas"); }
  if (isCluster) { revalidatePath("/clusters"); redirect("/clusters"); }
  revalidatePath(`/${schema}/${table}`);
  redirect(`/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`);
}
```

In `confirmBatchDelete`, after the existing `isBusinessUnit` redirect block, add the cluster redirect. Change:

```ts
  const isBusinessUnit = schema === env().systemSchemaName && table === "tb_business_unit";
  if (isBusinessUnit) {
    revalidatePath("/schemas");
    redirect("/schemas");
  }
  revalidatePath(`/${schema}/${table}`);
```

to:

```ts
  const isBusinessUnit = schema === env().systemSchemaName && table === "tb_business_unit";
  if (isBusinessUnit) {
    revalidatePath("/schemas");
    redirect("/schemas");
  }
  const isCluster = schema === env().systemSchemaName && table === "tb_cluster";
  if (isCluster) {
    revalidatePath("/clusters");
    redirect("/clusters");
  }
  revalidatePath(`/${schema}/${table}`);
```

- [ ] **Step 8: Typecheck, full test run, commit**

Run: `bun run typecheck`
Expected: no errors.

Run: `bun run test components/__tests__/confirm-delete.test.tsx`
Expected: PASS.

```bash
git add components/confirm-delete.tsx components/__tests__/confirm-delete.test.tsx app/\(god\)/\[schema\]/\[table\]/delete/page.tsx server/delete.ts
git commit -m "feat: cluster hard delete — multi-schema drop + redirect to /clusters"
```

---

### Task 8: `/clusters` routes + navigation

The page, the add/edit routes, and a nav link. Final wiring that makes the feature reachable.

**Files:**
- Create: `app/(god)/clusters/page.tsx`
- Create: `app/(god)/clusters/new/page.tsx`
- Create: `app/(god)/clusters/[id]/edit/page.tsx`
- Modify: `app/(god)/layout.tsx` (nav link)

**Interfaces:**
- Consumes: `listClusters` from `@/lib/registry`; `ClustersTable` from `@/components/clusters-table`; `softDeleteClusters`, `restoreClusters`, `submitClusterInsert`, `submitClusterUpdate` from `@/server/cluster-actions`; `describeTable` from `@/lib/introspect`; `RowForm` from `@/components/row-form`; `env` from `@/lib/env`.

- [ ] **Step 1: Read the Next docs**

Per `AGENTS.md`, before writing these route files, read the relevant guide(s) under `node_modules/next/dist/docs/` (defining pages, dynamic route segments, `params` shape, passing server actions to client components). Confirm the `params`/`searchParams` Promise convention used by the existing routes still applies.

- [ ] **Step 2: Create the clusters page**

Create `app/(god)/clusters/page.tsx`:

```tsx
import { env } from "@/lib/env";
import { listClusters } from "@/lib/registry";
import { ClustersTable } from "@/components/clusters-table";
import { softDeleteClusters, restoreClusters } from "@/server/cluster-actions";

export const dynamic = "force-dynamic";

export default async function ClustersPage() {
  const clusters = await listClusters();
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Clusters</h1>
      <ClustersTable
        clusters={clusters}
        system={env().systemSchemaName}
        softDeleteAction={softDeleteClusters}
        restoreAction={restoreClusters}
      />
    </div>
  );
}
```

- [ ] **Step 3: Create the add route**

Create `app/(god)/clusters/new/page.tsx`:

```tsx
import { env } from "@/lib/env";
import { describeTable } from "@/lib/introspect";
import { RowForm } from "@/components/row-form";
import { submitClusterInsert } from "@/server/cluster-actions";

export const dynamic = "force-dynamic";

export default async function NewClusterPage() {
  const schema = env().systemSchemaName;
  const shape = await describeTable(schema, "tb_cluster");
  // Hide soft-delete bookkeeping and auto-generated PKs from the form.
  const editable = shape.columns.filter((c) => c.name !== "deleted_at" && !(c.isPrimaryKey && c.default));
  return (
    <div>
      <h1 className="my-3 text-lg font-semibold">Add cluster</h1>
      <RowForm columns={editable} action={submitClusterInsert} submitLabel="Create cluster" />
    </div>
  );
}
```

- [ ] **Step 4: Create the edit route**

Create `app/(god)/clusters/[id]/edit/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { env } from "@/lib/env";
import { describeTable } from "@/lib/introspect";
import { getSql } from "@/lib/db";
import { qualified } from "@/lib/sql-guard";
import { whereFromPk } from "@/lib/write";
import { RowForm } from "@/components/row-form";
import { submitClusterUpdate } from "@/server/cluster-actions";

export const dynamic = "force-dynamic";

export default async function EditClusterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const schema = env().systemSchemaName;
  const pk = { id };
  const shape = await describeTable(schema, "tb_cluster");
  const editable = shape.columns.filter((c) => c.name !== "deleted_at" && !(c.isPrimaryKey && c.default));
  const { clause, args } = whereFromPk(pk, 1);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await getSql().unsafe(`SELECT * FROM ${qualified(schema, "tb_cluster")} WHERE ${clause} LIMIT 1`, args as any[]);
  if (!rows[0]) notFound();
  const action = submitClusterUpdate.bind(null, JSON.stringify(pk));
  return (
    <div>
      <h1 className="my-3 text-lg font-semibold">Edit cluster</h1>
      <RowForm columns={editable} initial={rows[0] as Record<string, unknown>} action={action} submitLabel="Save changes" />
    </div>
  );
}
```

- [ ] **Step 5: Add the nav link**

In `app/(god)/layout.tsx`, add a Clusters link after the Audit log link (line 9). Change:

```tsx
        <Link href="/audit" className="text-sm text-gray-600">Audit log</Link>
```

to:

```tsx
        <Link href="/clusters" className="text-sm text-gray-600">Clusters</Link>
        <Link href="/audit" className="text-sm text-gray-600">Audit log</Link>
```

- [ ] **Step 6: Typecheck, lint, full test suite**

Run: `bun run typecheck`
Expected: no errors.

Run: `bun run lint`
Expected: no errors.

Run: `bun run test`
Expected: the whole suite passes (including the new migration, soft-delete, registry-clusters, cascade, clusters-table, and confirm-delete tests).

- [ ] **Step 7: Manual smoke (with dev server + DB)**

Run the migration, start the dev server, and verify the flow:

```bash
bun run migrate           # adds tb_cluster.deleted_at if missing
bun run dev               # serves on http://localhost:3305
```

Logged in, at `http://localhost:3305/clusters`:
1. **Active tab** lists clusters with a `# Business Units` count; **+ Add cluster** opens the form, creating a cluster and redirecting back.
2. **Edit** opens `/clusters/<id>/edit`, saves, redirects back.
3. Tick rows → **Soft delete N selected** → rows move to the **Deleted** tab.
4. **Deleted tab**: **Restore** moves a row back to Active; **Hard delete** opens the confirm page showing the combined blast radius and (for a cluster with tenant-schema'd BUs) the **drop N tenant schemas** checkbox; typing `DELETE` and confirming cascades and lands back on `/clusters`.
5. Batch **Hard delete N selected** opens the `delete-batch` confirm with the orphan-schema warning, no drop checkbox.

- [ ] **Step 8: Commit**

```bash
git add app/\(god\)/clusters app/\(god\)/layout.tsx
git commit -m "feat: /clusters page with add/edit routes and nav link"
```

---

## Self-Review

**Spec coverage:**
- Add → Task 5 (`submitClusterInsert`) + Task 8 (`/clusters/new`). ✓
- Edit → Task 5 (`submitClusterUpdate`) + Task 8 (`/clusters/[id]/edit`). ✓
- Soft delete (single + batch) → Task 2 (helper) + Task 5 (action) + Task 6 (UI). ✓
- Restore (single + batch) → Task 2 + Task 5 + Task 6. ✓
- Hard delete (single, with multi-schema drop) → Task 4 (engine) + Task 7 (confirm UI + route + redirect). ✓
- Hard delete (batch, no schema drop, orphan warning) → Task 6 (link to existing `delete-batch`) + Task 7 (`confirmBatchDelete` cluster redirect); orphan warning already rendered by the existing `delete-batch` page via `radiusTouchesBusinessUnits`. ✓
- Two tabs Active | Deleted, hard delete only from Deleted tab → Task 6. ✓
- `deleted_at` representation + verification/migration → Task 1. ✓
- `listClusters` with `businessUnitCount`, `resolveTenantSchemasForCluster` → Task 3. ✓
- Reusable `lib/soft-delete.ts` helper, no `RowGrid` changes → Task 2. ✓
- Nav reachability → Task 8 (layout link). ✓
- Audit logging for soft delete/restore → Task 2 (`SOFT_DELETE`/`RESTORE` ops). ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every test step shows the test. ✓

**Type consistency:**
- `softDeleteRows`/`restoreRows` signature consistent across Task 2 (def) and Task 5 (use). ✓
- `executeCascade`/`deleteRadius` `{ dropTenantSchemas: string[] }` + `{ droppedSchemas }` consistent across Task 4 (def) and Task 7 (use via `confirmDelete`). ✓
- `Cluster` type used identically in Task 3 (def), Task 6 (component), Task 8 (page). ✓
- `ConfirmDelete` `orphanSchemas?: string[]` prop consistent across Task 7 (def) and the delete route (use). ✓
- `softDeleteClusters`/`restoreClusters` are `(formData: FormData) => void` in Task 5 (def) and Task 6 (prop type) and Task 8 (passed as props). ✓

**Edge cases covered:** empty selection (helper throws + UI hides bar), idempotent migration, missing table (`42P01`) in migration and `listClusters`, `deleted_at` clobber avoided by `includeAllColumns=false` in `submitClusterUpdate`. ✓
