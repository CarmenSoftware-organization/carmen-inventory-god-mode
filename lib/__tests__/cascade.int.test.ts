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
    INSERT INTO app.bu VALUES (1,'BU1');
    INSERT INTO app.role VALUES (10,1),(11,1);
    INSERT INTO app.perm VALUES (100,10),(101,11);
  `);
  const { ensureAuditTable } = await import("@/lib/audit");
  await ensureAuditTable();
});
afterAll(async () => { await container.stop(); });

test("computeBlastRadius finds all descendants", async () => {
  const { computeBlastRadius } = await import("@/lib/cascade");
  const r = await computeBlastRadius("app", "bu", { id: 1 });
  const total = r.rows.length;
  expect(total).toBe(5); // bu + 2 roles + 2 perms
  expect(r.maxDepth).toBe(2);
});

test("executeCascade deletes children-first without FK error", async () => {
  const { executeCascade } = await import("@/lib/cascade");
  const { getSql } = await import("@/lib/db");
  const res = await executeCascade("app", "bu", { id: 1 }, {});
  expect(res.deleted).toBe(5);
  const left = await getSql().unsafe(`SELECT count(*)::int n FROM app.bu`);
  expect(left[0].n).toBe(0);
  const { listAudit } = await import("@/lib/audit");
  const audit = await listAudit({ operation: "CASCADE_DELETE", limit: 10 });
  expect(audit.length).toBe(5);
});
