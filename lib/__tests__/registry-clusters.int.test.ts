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
    CREATE TABLE "CARMEN_SYSTEM".tb_cluster (
      id uuid primary key default gen_random_uuid(),
      code text not null, name text not null, deleted_at timestamptz
    );
    CREATE TABLE "CARMEN_SYSTEM".tb_business_unit (
      id uuid primary key default gen_random_uuid(),
      cluster_id uuid, code text not null, name text not null,
      is_active boolean default true, db_connection jsonb
    );
    INSERT INTO "CARMEN_SYSTEM".tb_cluster (id, code, name, deleted_at) VALUES
      ('11111111-1111-1111-1111-111111111111','CL-A','Alpha',NULL),
      ('22222222-2222-2222-2222-222222222222','CL-B','Beta', now());
    INSERT INTO "CARMEN_SYSTEM".tb_business_unit (cluster_id, code, name, db_connection) VALUES
      ('11111111-1111-1111-1111-111111111111','BU1','BU One', '{"schema":"tenant_one"}'::jsonb),
      ('11111111-1111-1111-1111-111111111111','BU2','BU Two', '{"schema":"tenant_two"}'::jsonb),
      ('11111111-1111-1111-1111-111111111111','BU3','BU Three', NULL);
  `);
});
afterAll(async () => { await container.stop(); });

test("listClusters returns code/name/deletedAt and businessUnitCount", async () => {
  const { listClusters } = await import("@/lib/registry");
  const clusters = await listClusters();
  const a = clusters.find((c) => c.code === "CL-A")!;
  const b = clusters.find((c) => c.code === "CL-B")!;
  expect(a.deletedAt).toBeNull();
  expect(a.businessUnitCount).toBe(3);
  expect(b.deletedAt).not.toBeNull();
  expect(b.businessUnitCount).toBe(0);
});

test("resolveTenantSchemasForCluster returns distinct non-null schemas", async () => {
  const { resolveTenantSchemasForCluster } = await import("@/lib/registry");
  const schemas = await resolveTenantSchemasForCluster("11111111-1111-1111-1111-111111111111");
  expect(schemas.sort()).toEqual(["tenant_one", "tenant_two"]);
});

test("listClusters returns [] when tb_cluster is absent (42P01)", async () => {
  const { getSql } = await import("@/lib/db");
  await getSql().unsafe(`DROP TABLE "CARMEN_SYSTEM".tb_cluster`);
  const { listClusters } = await import("@/lib/registry");
  expect(await listClusters()).toEqual([]);
});
