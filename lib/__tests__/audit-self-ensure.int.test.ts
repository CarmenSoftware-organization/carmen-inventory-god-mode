import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { Pg } from "@/test/pg";
import { startPg } from "@/test/pg";

// Verifies every audit-write path self-ensures CARMEN_SYSTEM.tb_god_mode_audit,
// so a fresh DB (no bootstrap step) records audit on the first write instead of
// failing with 42P01. Each test drops the audit table first to simulate "fresh".

let container: Pg;
beforeAll(async () => {
  const pg = await startPg();
  container = pg.container;
  process.env.DATABASE_URL = pg.url;
  process.env.SYSTEM_DATABASE_URL = pg.url;
  process.env.SYSTEM_SCHEMA_NAME = "CARMEN_SYSTEM";
  process.env.GOD_MODE_PASSWORD = "x";
  process.env.SESSION_SECRET = "x".repeat(32);
  vi.mock("@/lib/session", () => ({ getSession: async () => ({ actor: "tester", authed: true }) }));
  const { getSql } = await import("@/lib/db");
  await getSql().unsafe(`
    CREATE SCHEMA "CARMEN_SYSTEM";
    CREATE SCHEMA app;
    CREATE TABLE app.item (id int primary key, name text, deleted_at timestamptz);
  `);
});
afterAll(async () => { await container.stop(); });

const auditTableExists = async (): Promise<boolean> => {
  const { getSql } = await import("@/lib/db");
  const rows = await getSql().unsafe(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='CARMEN_SYSTEM' AND table_name='tb_god_mode_audit'`,
  );
  return rows.length > 0;
};

beforeEach(async () => {
  const { getSql } = await import("@/lib/db");
  await getSql().unsafe(`DROP TABLE IF EXISTS "CARMEN_SYSTEM".tb_god_mode_audit`);
});

test("applyInsert self-ensures the audit table on a fresh DB", async () => {
  const { applyInsert } = await import("@/lib/write");
  const { listAudit } = await import("@/lib/audit");
  expect(await auditTableExists()).toBe(false);
  await applyInsert("app", "item", { id: 10, name: "ten" });
  expect(await auditTableExists()).toBe(true);
  const audit = await listAudit({ operation: "INSERT", limit: 1 });
  expect(audit.length).toBe(1);
});

test("applyWrite (raw SQL) self-ensures the audit table on a fresh DB", async () => {
  const { getSql } = await import("@/lib/db");
  await getSql().unsafe(`INSERT INTO app.item (id, name) VALUES (20, 'twenty')`);
  const { applyWrite } = await import("@/lib/sql-runner");
  const { listAudit } = await import("@/lib/audit");
  expect(await auditTableExists()).toBe(false);
  await applyWrite("app", "UPDATE app.item SET name='x20' WHERE id=20");
  expect(await auditTableExists()).toBe(true);
  const audit = await listAudit({ operation: "RAW_SQL", limit: 1 });
  expect(audit.length).toBe(1);
});

test("softDeleteRows self-ensures the audit table on a fresh DB", async () => {
  const { getSql } = await import("@/lib/db");
  await getSql().unsafe(`INSERT INTO app.item (id, name) VALUES (30, 'thirty')`);
  const { softDeleteRows } = await import("@/lib/soft-delete");
  const { listAudit } = await import("@/lib/audit");
  expect(await auditTableExists()).toBe(false);
  const res = await softDeleteRows("app", "item", [{ id: 30 }]);
  expect(res.affected).toBe(1);
  expect(await auditTableExists()).toBe(true);
  const audit = await listAudit({ operation: "SOFT_DELETE", limit: 1 });
  expect(audit.length).toBe(1);
});

test("executeCascade self-ensures the audit table on a fresh DB", async () => {
  const { getSql } = await import("@/lib/db");
  await getSql().unsafe(`INSERT INTO app.item (id, name) VALUES (40, 'forty')`);
  const { executeCascade } = await import("@/lib/cascade");
  const { listAudit } = await import("@/lib/audit");
  expect(await auditTableExists()).toBe(false);
  const res = await executeCascade("app", "item", { id: 40 }, {});
  expect(res.deleted).toBe(1);
  expect(await auditTableExists()).toBe(true);
  const audit = await listAudit({ operation: "CASCADE_DELETE", limit: 1 });
  expect(audit.length).toBe(1);
});
