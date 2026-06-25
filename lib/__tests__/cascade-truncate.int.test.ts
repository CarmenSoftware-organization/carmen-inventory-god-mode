import { afterAll, beforeAll, expect, test, vi } from "vitest";
import type { Pg } from "@/test/pg";
import { startPg } from "@/test/pg";

let container: Pg;
beforeAll(async () => {
  const pg = await startPg();
  container = pg.container;
  // Set CASCADE_MAX_ROWS to 2 BEFORE any dynamic import so env() cache picks it up.
  process.env.DATABASE_URL = pg.url;
  process.env.SYSTEM_DATABASE_URL = pg.url;
  process.env.SYSTEM_SCHEMA_NAME = "CARMEN_SYSTEM";
  process.env.GOD_MODE_PASSWORD = "x";
  process.env.SESSION_SECRET = "x".repeat(32);
  process.env.CASCADE_MAX_ROWS = "2";
  process.env.CASCADE_MAX_DEPTH = "20";
  vi.mock("@/lib/session", () => ({ getSession: async () => ({ actor: "tester", authed: true }) }));
  const { getSql } = await import("@/lib/db");
  await getSql().unsafe(`
    CREATE SCHEMA "CARMEN_SYSTEM";
    CREATE SCHEMA app;
    CREATE TABLE app.parent (id int primary key, name text);
    CREATE TABLE app.child (id int primary key, parent_id int references app.parent(id));
    INSERT INTO app.parent VALUES (1, 'P1');
    INSERT INTO app.child VALUES (1, 1), (2, 1), (3, 1);
  `);
  const { ensureAuditTable } = await import("@/lib/audit");
  await ensureAuditTable();
});
afterAll(async () => { await container.stop(); });

// I1: Truncation refusal — blast radius exceeds cap, executeCascade must refuse
test("computeBlastRadius returns truncated=true when rows exceed CASCADE_MAX_ROWS", async () => {
  const { computeBlastRadius } = await import("@/lib/cascade");
  // parent + 3 children = 4 rows, but cap is 2 → truncated
  const r = await computeBlastRadius("app", "parent", { id: 1 });
  expect(r.truncated).toBe(true);
});

test("executeCascade refuses and deletes nothing when blast radius is truncated", async () => {
  const { executeCascade } = await import("@/lib/cascade");
  const { getSql } = await import("@/lib/db");
  await expect(executeCascade("app", "parent", { id: 1 }, {})).rejects.toThrow(/cap|truncat/i);
  // Rows must still be intact
  const parents = await getSql().unsafe(`SELECT count(*)::int n FROM app.parent`);
  expect(parents[0].n).toBe(1);
  const children = await getSql().unsafe(`SELECT count(*)::int n FROM app.child`);
  expect(children[0].n).toBe(3);
});
