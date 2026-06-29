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
    CREATE SCHEMA "CARMEN_SYSTEM";
    CREATE SCHEMA app;
    CREATE TABLE app.item (id int primary key, name text);
    INSERT INTO app.item VALUES (1,'one');
  `);
  const { ensureAuditTable } = await import("@/lib/audit");
  await ensureAuditTable();
});
afterAll(async () => { await container.stop(); });

test("applyUpdate changes the row and writes audit", async () => {
  const { applyUpdate } = await import("@/lib/write");
  const { listAudit } = await import("@/lib/audit");
  const res = await applyUpdate("app", "item", { id: 1 }, { name: "ONE" });
  expect(res.after.name).toBe("ONE");
  expect(res.before.name).toBe("one");
  const audit = await listAudit({ operation: "UPDATE", limit: 1 });
  expect((audit[0].newValues as { name: string }).name).toBe("ONE");
});

test("applySingleDelete removes the row and audits", async () => {
  const { applyInsert, applySingleDelete } = await import("@/lib/write");
  await applyInsert("app", "item", { id: 2, name: "two" });
  const removed = await applySingleDelete("app", "item", { id: 2 });
  expect(removed.id).toBe(2);
});
