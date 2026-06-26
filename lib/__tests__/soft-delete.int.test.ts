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

test("softDeleteRows records deleted_by_id when configured; restore clears it", async () => {
  const { getSql } = await import("@/lib/db");
  await getSql().unsafe(`
    CREATE TABLE app_by (id int primary key, deleted_at timestamptz, deleted_by_id uuid);
    INSERT INTO app_by VALUES (1, NULL, NULL);
  `);
  const { softDeleteRows, restoreRows } = await import("@/lib/soft-delete");
  const who = "11111111-1111-1111-1111-111111111111";

  await softDeleteRows("public", "app_by", [{ id: 1 }], { deletedByColumn: "deleted_by_id", deletedById: who });
  let rows = await getSql().unsafe(`SELECT deleted_at, deleted_by_id::text AS by FROM app_by WHERE id = 1`);
  expect(rows[0].deleted_at).not.toBeNull();
  expect(rows[0].by).toBe(who);

  await restoreRows("public", "app_by", [{ id: 1 }], { deletedByColumn: "deleted_by_id" });
  rows = await getSql().unsafe(`SELECT deleted_at, deleted_by_id::text AS by FROM app_by WHERE id = 1`);
  expect(rows[0].deleted_at).toBeNull();
  expect(rows[0].by).toBeNull();
});

test("softDeleteRows leaves deleted_by_id NULL when no id is configured", async () => {
  const { getSql } = await import("@/lib/db");
  await getSql().unsafe(`INSERT INTO app_by VALUES (2, NULL, NULL)`);
  const { softDeleteRows } = await import("@/lib/soft-delete");
  await softDeleteRows("public", "app_by", [{ id: 2 }], { deletedByColumn: "deleted_by_id", deletedById: null });
  const rows = await getSql().unsafe(`SELECT deleted_at, deleted_by_id FROM app_by WHERE id = 2`);
  expect(rows[0].deleted_at).not.toBeNull();
  expect(rows[0].deleted_by_id).toBeNull();
});

test("transaction rolls back on mid-loop failure", async () => {
  const { getSql } = await import("@/lib/db");
  const { softDeleteRows } = await import("@/lib/soft-delete");

  // Insert a fresh dedicated row
  await getSql().unsafe(`INSERT INTO app_c VALUES (99, 'rollback', NULL)`);

  // Verify it starts active
  const beforeRows = await getSql().unsafe(`SELECT deleted_at FROM app_c WHERE id = 99`);
  expect(beforeRows[0].deleted_at).toBeNull();

  // Call with valid row and invalid row (non-existent column "nope")
  // The update for id=99 happens first, then nope=1 fails
  await expect(
    softDeleteRows("public", "app_c", [{ id: 99 }, { nope: 1 }])
  ).rejects.toThrow();

  // Verify row 99 was rolled back (still active)
  const afterRows = await getSql().unsafe(`SELECT deleted_at FROM app_c WHERE id = 99`);
  expect(afterRows[0].deleted_at).toBeNull();
});
