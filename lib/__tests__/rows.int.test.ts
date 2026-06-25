import { afterAll, beforeAll, expect, test } from "vitest";
import type { Pg } from "@/test/pg";
import { startPg } from "@/test/pg";

let container: Pg;
beforeAll(async () => {
  const pg = await startPg();
  container = pg.container;
  process.env.DATABASE_URL = pg.url;
  process.env.SYSTEM_DATABASE_URL = pg.url;
  process.env.GOD_MODE_PASSWORD = "x";
  process.env.SESSION_SECRET = "x".repeat(32);
  const { getSql } = await import("@/lib/db");
  await getSql().unsafe(`
    CREATE SCHEMA app;
    CREATE TABLE app.item (id int primary key, name text);
    INSERT INTO app.item SELECT g, 'n'||g FROM generate_series(1,5) g;
  `);
});
afterAll(async () => { await container.stop(); });

test("readRows paginates by pk", async () => {
  const { readRows } = await import("@/lib/rows");
  const p1 = await readRows("app", "item", { limit: 2 });
  expect(p1.rows.map((r) => r.id)).toEqual([1, 2]);
  expect(p1.nextCursor).not.toBeNull();
  const p2 = await readRows("app", "item", { limit: 2, cursor: p1.nextCursor });
  expect(p2.rows.map((r) => r.id)).toEqual([3, 4]);
});
