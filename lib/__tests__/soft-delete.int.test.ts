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
