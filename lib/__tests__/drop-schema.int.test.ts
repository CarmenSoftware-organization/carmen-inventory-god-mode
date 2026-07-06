import { afterAll, beforeAll, expect, test } from "vitest";
import type { Pg } from "@/test/pg";
import { startPg } from "@/test/pg";

let container: Pg;
beforeAll(async () => {
  const pg = await startPg();
  container = pg.container;
  process.env.DATABASE_URL = pg.url;
  process.env.SYSTEM_DATABASE_URL = pg.url;
  process.env.SYSTEM_DIRECT_URL = pg.url;
  process.env.SYSTEM_SCHEMA_NAME = "CARMEN_SYSTEM";
  process.env.GOD_MODE_PASSWORD = "x";
  process.env.SESSION_SECRET = "x".repeat(32);
  // The audit table lives in the system schema; it must exist first.
  const { getSql } = await import("@/lib/db");
  await getSql().unsafe(`CREATE SCHEMA IF NOT EXISTS "CARMEN_SYSTEM"`);
});
afterAll(async () => {
  await container.stop();
});

const schemaExists = async (name: string): Promise<boolean> => {
  const { getSql } = await import("@/lib/db");
  const rows = await getSql().unsafe(
    `SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`,
    [name],
  );
  return rows.length === 1;
};

test("executeDropSchema drops the schema (CASCADE) and writes a DROP_SCHEMA audit row", async () => {
  const { executeDropSchema } = await import("@/lib/drop-schema");
  const { getSql } = await import("@/lib/db");
  const sql = getSql();

  await sql.unsafe(`CREATE SCHEMA "zz_drop_me"`);
  await sql.unsafe(`CREATE TABLE "zz_drop_me"."t" (id int)`); // proves CASCADE
  expect(await schemaExists("zz_drop_me")).toBe(true);

  const res = await executeDropSchema("zz_drop_me");
  expect(res.droppedSchema).toBe("zz_drop_me");
  expect(await schemaExists("zz_drop_me")).toBe(false);

  const audit = (await sql.unsafe(
    `SELECT operation FROM "CARMEN_SYSTEM".tb_god_mode_audit WHERE schema_name = 'zz_drop_me'`,
  )) as unknown as { operation: string }[];
  expect(audit.some((a) => a.operation === "DROP_SCHEMA")).toBe(true);
});

test("executeDropSchema refuses the system schema and leaves it intact", async () => {
  const { executeDropSchema } = await import("@/lib/drop-schema");
  expect(await schemaExists("CARMEN_SYSTEM")).toBe(true);
  await expect(executeDropSchema("CARMEN_SYSTEM")).rejects.toThrow(/system schema/i);
  expect(await schemaExists("CARMEN_SYSTEM")).toBe(true);
});
