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
});
afterAll(async () => { await container.stop(); });

test("ensureSchemaExists creates the schema and is idempotent", async () => {
  const { ensureSchemaExists } = await import("@/lib/schema-bootstrap");
  const { getSql } = await import("@/lib/db");
  const exists = async () =>
    (await getSql().unsafe(`SELECT 1 FROM information_schema.schemata WHERE schema_name = 'NEW_ENV'`)).length;

  expect(await exists()).toBe(0);
  await ensureSchemaExists("NEW_ENV");
  expect(await exists()).toBe(1);
  await ensureSchemaExists("NEW_ENV"); // idempotent — must not throw
  expect(await exists()).toBe(1);
});
