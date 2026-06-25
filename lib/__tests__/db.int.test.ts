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
});
afterAll(async () => { await container.stop(); });

test("withTransaction commits and rolls back", async () => {
  const { getSql, withTransaction } = await import("@/lib/db");
  const sql = getSql();
  await sql.unsafe(`CREATE SCHEMA s; CREATE TABLE s.t (id int primary key)`);

  await withTransaction("s", async (tx) => { await tx.unsafe(`INSERT INTO t (id) VALUES (1)`); });
  const ok = await sql.unsafe(`SELECT count(*)::int AS n FROM s.t`);
  expect(ok[0].n).toBe(1);

  await expect(withTransaction("s", async (tx) => {
    await tx.unsafe(`INSERT INTO t (id) VALUES (2)`);
    throw new Error("boom");
  })).rejects.toThrow("boom");
  const after = await sql.unsafe(`SELECT count(*)::int AS n FROM s.t`);
  expect(after[0].n).toBe(1);
});
