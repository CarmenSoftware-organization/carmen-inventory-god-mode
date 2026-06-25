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
