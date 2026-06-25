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
    CREATE TABLE "CARMEN_SYSTEM".tb_business_unit (
      id uuid primary key default gen_random_uuid(),
      cluster_id uuid, code text not null, name text not null,
      is_active boolean default true, db_connection jsonb
    );
    INSERT INTO "CARMEN_SYSTEM".tb_business_unit (code, name, db_connection) VALUES
      ('BLFIFO','Blueledgers (FIFO)', '{"schema":"BL_FIFO"}'::jsonb),
      ('NOSCHEMA','No Schema BU', NULL);
  `);
});
afterAll(async () => { await container.stop(); });

test("listBusinessUnits resolves tenant schema from jsonb", async () => {
  const { listBusinessUnits } = await import("@/lib/registry");
  const bus = await listBusinessUnits();
  const fifo = bus.find((b) => b.code === "BLFIFO")!;
  const none = bus.find((b) => b.code === "NOSCHEMA")!;
  expect(fifo.tenantSchema).toBe("BL_FIFO");
  expect(none.tenantSchema).toBeNull();
});
