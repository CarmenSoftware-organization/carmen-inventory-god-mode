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
