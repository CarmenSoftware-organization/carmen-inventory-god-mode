// lib/__tests__/cascade-progress.int.test.ts
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import type { Pg } from "@/test/pg";
import { startPg } from "@/test/pg";
import type { ProgressEvent } from "@/lib/progress";

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
    INSERT INTO app.bu VALUES (1,'BU1');
    INSERT INTO app.role VALUES (10,1),(11,1);
    CREATE TABLE app.drv (id int primary key);
    INSERT INTO app.drv VALUES (1);
    CREATE SCHEMA "tdropA";
  `);
  const { ensureAuditTable } = await import("@/lib/audit");
  await ensureAuditTable();
});
afterAll(async () => { await container.stop(); });

test("executeCascade emits computing → total → per-table steps with cumulative done", async () => {
  const { executeCascade } = await import("@/lib/cascade");
  const events: ProgressEvent[] = [];
  const res = await executeCascade("app", "bu", { id: 1 }, { onProgress: (e) => events.push(e) });
  expect(res.deleted).toBe(3); // bu + 2 roles

  expect(events[0]).toEqual({ type: "step", label: "Computing blast radius…" });
  const total = events.find((e) => e.type === "total");
  expect(total).toEqual({ type: "total", total: 3 });

  const deletes = events.filter((e): e is Extract<ProgressEvent, { type: "step" }> =>
    e.type === "step" && e.label.startsWith("Deleting"));
  expect(deletes.length).toBeGreaterThan(0);
  // cumulative done is monotonic non-decreasing and never exceeds total
  const dones = deletes.map((e) => e.done ?? 0);
  expect(dones).toEqual([...dones].sort((a, b) => a - b));
  expect(Math.max(...dones)).toBeLessThanOrEqual(3);
});

test("executeCascade emits a Dropping schema step per dropped tenant schema", async () => {
  const { executeCascade } = await import("@/lib/cascade");
  const events: ProgressEvent[] = [];
  await executeCascade("app", "drv", { id: 1 }, { dropTenantSchemas: ["tdropA"], onProgress: (e) => events.push(e) });
  expect(events.some((e) => e.type === "step" && e.label === "Dropping schema tdropA…")).toBe(true);
  const total = events.find((e) => e.type === "total");
  expect(total).toEqual({ type: "total", total: 2 }); // 1 drv row + 1 schema
});
