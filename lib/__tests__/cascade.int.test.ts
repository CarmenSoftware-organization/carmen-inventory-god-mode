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

    -- C1: non-PK referenced FK tables
    CREATE TABLE app.org (id int primary key, code text UNIQUE);
    CREATE TABLE app.member (id int primary key, org_code text references app.org(code));
    INSERT INTO app.org VALUES (1, 'ORG1');
    INSERT INTO app.member VALUES (10, 'ORG1');

    -- C2: 2-table FK cycle with nullable back-references
    CREATE TABLE app.aa (id int primary key, bb_id int);
    CREATE TABLE app.bb (id int primary key, aa_id int references app.aa(id));
    ALTER TABLE app.aa ADD CONSTRAINT aa_bb_fk FOREIGN KEY (bb_id) REFERENCES app.bb(id);
    INSERT INTO app.aa VALUES (1, NULL);
    INSERT INTO app.bb VALUES (1, 1);
    UPDATE app.aa SET bb_id = 1 WHERE id = 1;
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

// C1: non-PK referenced FK — member FK references org.code (UNIQUE, not PK)
test("computeBlastRadius follows FK referencing a non-PK unique column (C1)", async () => {
  const { computeBlastRadius } = await import("@/lib/cascade");
  const r = await computeBlastRadius("app", "org", { id: 1 });
  // Should include the org row itself + the member row that references via org.code
  expect(r.rows.length).toBe(2);
  const tableNames = r.rows.map((row) => row.table).sort();
  expect(tableNames).toContain("org");
  expect(tableNames).toContain("member");
});

// C2: FK cycle between aa and bb — executeCascade must refuse with a cycle error
test("executeCascade refuses to cascade when tables form an FK cycle (C2)", async () => {
  const { executeCascade } = await import("@/lib/cascade");
  await expect(executeCascade("app", "aa", { id: 1 }, {})).rejects.toThrow(/cycle/i);
});
