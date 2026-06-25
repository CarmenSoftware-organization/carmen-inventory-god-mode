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
  vi.mock("@/lib/session", () => ({ getSession: async () => ({ actor: "tester", authed: true }) }));
  const { getSql } = await import("@/lib/db");
  await getSql().unsafe(`
    CREATE SCHEMA "CARMEN_SYSTEM"; CREATE SCHEMA app;
    CREATE TABLE app.item (id int primary key, name text);
    INSERT INTO app.item VALUES (1,'a'),(2,'b'),(3,'c');
  `);
  const { ensureAuditTable } = await import("@/lib/audit");
  await ensureAuditTable();
});
afterAll(async () => { await container.stop(); });

test("runRead returns rows", async () => {
  const { runRead } = await import("@/lib/sql-runner");
  const r = await runRead("app", "SELECT * FROM item ORDER BY id");
  expect(r.kind).toBe("read");
  if (r.kind === "read") expect(r.rowCount).toBe(3);
});

test("previewWrite does not persist", async () => {
  const { previewWrite } = await import("@/lib/sql-runner");
  const { getSql } = await import("@/lib/db");
  const r = await previewWrite("app", "DELETE FROM item WHERE id <= 2");
  expect(r.kind).toBe("write-preview");
  if (r.kind === "write-preview") expect(r.affected).toBe(2);
  const left = await getSql().unsafe(`SELECT count(*)::int n FROM app.item`);
  expect(left[0].n).toBe(3); // unchanged
});

test("applyWrite persists and audits", async () => {
  const { applyWrite } = await import("@/lib/sql-runner");
  const { getSql } = await import("@/lib/db");
  const r = await applyWrite("app", "DELETE FROM item WHERE id = 3");
  if (r.kind === "write-applied") expect(r.affected).toBe(1);
  const left = await getSql().unsafe(`SELECT count(*)::int n FROM app.item`);
  expect(left[0].n).toBe(2);
  const { listAudit } = await import("@/lib/audit");
  const audit = await listAudit({ operation: "RAW_SQL", limit: 1 });
  expect(audit[0].statement).toContain("DELETE FROM item WHERE id = 3");
});
