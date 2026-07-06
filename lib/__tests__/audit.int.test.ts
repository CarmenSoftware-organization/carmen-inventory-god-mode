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
  await getSql().unsafe(`CREATE SCHEMA "CARMEN_SYSTEM"`);
});
afterAll(async () => { await container.stop(); });

test("writeAudit persists an entry inside a txn", async () => {
  const { ensureAuditTable, writeAudit, listAudit } = await import("@/lib/audit");
  const { withTransaction } = await import("@/lib/db");
  await ensureAuditTable();
  await withTransaction(null, async (tx) => {
    await writeAudit(tx, { actor: "tester", schemaName: "app", tableName: "item",
      operation: "DELETE", pk: { id: 1 }, oldValues: { id: 1, name: "x" }, newValues: null, statement: "DELETE ..." });
  });
  const entries = await listAudit({ limit: 10 });
  expect(entries[0].operation).toBe("DELETE");
  expect(entries[0].actor).toBe("tester");
  expect((entries[0].pk as { id: number }).id).toBe(1);
});

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
