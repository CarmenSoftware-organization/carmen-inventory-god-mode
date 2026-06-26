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
  await getSql().unsafe(`
    CREATE SCHEMA "CARMEN_SYSTEM";
    CREATE TABLE "CARMEN_SYSTEM".tb_cluster (id uuid primary key default gen_random_uuid(), code text, name text);
  `);
});
afterAll(async () => { await container.stop(); });

test("ensureClusterDeletedAt adds the column and is idempotent", async () => {
  const { ensureClusterDeletedAt } = await import("@/lib/migrations");
  const { describeTable } = await import("@/lib/introspect");

  await ensureClusterDeletedAt();
  let cols = (await describeTable("CARMEN_SYSTEM", "tb_cluster")).columns.map((c) => c.name);
  expect(cols).toContain("deleted_at");

  // idempotent: a second run does not throw
  await ensureClusterDeletedAt();
  cols = (await describeTable("CARMEN_SYSTEM", "tb_cluster")).columns.map((c) => c.name);
  expect(cols.filter((c) => c === "deleted_at")).toHaveLength(1);
});

test("ensureClusterDeletedAt no-ops when the table is absent", async () => {
  const { getSql } = await import("@/lib/db");
  await getSql().unsafe(`DROP TABLE "CARMEN_SYSTEM".tb_cluster`);
  const { ensureClusterDeletedAt } = await import("@/lib/migrations");
  await expect(ensureClusterDeletedAt()).resolves.toBeUndefined();
});

test("runMigrations emits one step per task and reports the count", async () => {
  const { runMigrations } = await import("@/lib/migrations");
  const events: import("@/lib/progress").ProgressEvent[] = [];
  const res = await runMigrations((e) => events.push(e));
  expect(res.count).toBe(2);
  const total = events.find((e) => e.type === "total");
  expect(total).toEqual({ type: "total", total: 2 });
  const steps = events.filter((e) => e.type === "step");
  expect(steps.length).toBe(2);
  // idempotent: a second run still succeeds
  const again = await runMigrations();
  expect(again.count).toBe(2);
});
