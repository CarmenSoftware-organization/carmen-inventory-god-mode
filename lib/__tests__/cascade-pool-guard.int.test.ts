import { afterAll, beforeAll, expect, test, vi } from "vitest";
import type { Pg } from "@/test/pg";
import { startPg } from "@/test/pg";

// A registry that HAS the pool split, unlike cascade-route.int.test.ts, which stands in
// for a pre-migration database and proves the guard stays out of the way there.
const { requireAuthMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(async () => ({ authed: true, actor: "tester" })),
}));

let container: Pg;
let connected: { host: string; port: number; database: string };

beforeAll(async () => {
  const pg = await startPg();
  container = pg.container;
  process.env.DATABASE_URL = pg.url;
  process.env.SYSTEM_DATABASE_URL = pg.url;
  process.env.SYSTEM_SCHEMA_NAME = "CARMEN_SYSTEM";
  process.env.GOD_MODE_PASSWORD = "x";
  process.env.SESSION_SECRET = "x".repeat(32);
  vi.mock("@/lib/session", () => ({ requireAuth: requireAuthMock }));
  vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

  const url = new URL(pg.url);
  connected = {
    host: url.hostname,
    port: url.port ? Number(url.port) : 5432,
    database: url.pathname.replace(/^\//, ""),
  };

  const { getSql } = await import("@/lib/db");
  await getSql().unsafe(`
    CREATE SCHEMA "CARMEN_SYSTEM";
    CREATE TABLE "CARMEN_SYSTEM".tb_database_pool (
      id uuid primary key default gen_random_uuid(),
      host text, port int, database text
    );
    CREATE TABLE "CARMEN_SYSTEM".tb_business_unit (
      id uuid primary key default gen_random_uuid(),
      cluster_id uuid, code text not null,
      db_schema varchar, database_pool_id uuid
    );
  `);
  const { ensureAuditTable } = await import("@/lib/audit");
  await ensureAuditTable();
});
afterAll(async () => { await container.stop(); });

function req(body: unknown): Request {
  return new Request("http://x/api/ops/cascade-delete", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

async function seedBu(code: string, schema: string, pool: { host: string; port: number; database: string }): Promise<string> {
  const { getSql } = await import("@/lib/db");
  const sql = getSql();
  const [{ id: poolId }] = await sql.unsafe<{ id: string }[]>(
    `INSERT INTO "CARMEN_SYSTEM".tb_database_pool (host, port, database)
     VALUES ($1, $2, $3) RETURNING id::text`,
    [pool.host, pool.port, pool.database],
  );
  const [{ id }] = await sql.unsafe<{ id: string }[]>(
    `INSERT INTO "CARMEN_SYSTEM".tb_business_unit (code, db_schema, database_pool_id)
     VALUES ($1, $2, $3::uuid) RETURNING id::text`,
    [code, schema, poolId],
  );
  await sql.unsafe(`CREATE SCHEMA ${JSON.stringify(schema)}`);
  return id;
}

test("refuses the drop when the business unit's pool points at another host", async () => {
  const id = await seedBu("OTHERPOOL", "guard_other_tenant", {
    host: "prod.example.com", port: 5432, database: "carmen",
  });

  const { POST } = await import("@/app/api/ops/cascade-delete/route");
  const res = await POST(req({
    schema: "CARMEN_SYSTEM", table: "tb_business_unit",
    pks: [{ id }], dropSchema: true, confirm: "guard_other_tenant",
  }));

  expect(res.status).toBe(409);
  const body = await res.json() as { error: string };
  expect(body.error).toContain("OTHERPOOL");
  expect(body.error).toContain("prod.example.com:5432/carmen");

  // Nothing may have been touched: schema and registry row both survive.
  const { getSql } = await import("@/lib/db");
  const sql = getSql();
  expect(await sql.unsafe(`SELECT nspname FROM pg_namespace WHERE nspname = 'guard_other_tenant'`)).toHaveLength(1);
  expect(await sql.unsafe(`SELECT id FROM "CARMEN_SYSTEM".tb_business_unit WHERE id = $1::uuid`, [id])).toHaveLength(1);
});

test("refuses the drop when the business unit has a schema but no pool assigned", async () => {
  const { getSql } = await import("@/lib/db");
  const sql = getSql();
  const [{ id }] = await sql.unsafe<{ id: string }[]>(
    `INSERT INTO "CARMEN_SYSTEM".tb_business_unit (code, db_schema, database_pool_id)
     VALUES ('NOPOOL', 'guard_nopool_tenant', NULL) RETURNING id::text`,
  );
  await sql.unsafe(`CREATE SCHEMA "guard_nopool_tenant"`);

  const { POST } = await import("@/app/api/ops/cascade-delete/route");
  const res = await POST(req({
    schema: "CARMEN_SYSTEM", table: "tb_business_unit",
    pks: [{ id }], dropSchema: true, confirm: "guard_nopool_tenant",
  }));

  expect(res.status).toBe(409);
  expect((await res.json() as { error: string }).error).toContain("NOPOOL");
  expect(await sql.unsafe(`SELECT nspname FROM pg_namespace WHERE nspname = 'guard_nopool_tenant'`)).toHaveLength(1);
});

test("allows the drop when the pool is the connection god-mode holds", async () => {
  const id = await seedBu("SAMEPOOL", "guard_same_tenant", connected);

  const { POST } = await import("@/app/api/ops/cascade-delete/route");
  const res = await POST(req({
    schema: "CARMEN_SYSTEM", table: "tb_business_unit",
    pks: [{ id }], dropSchema: true, confirm: "guard_same_tenant",
  }));

  expect(res.status).toBe(200);
  const { getSql } = await import("@/lib/db");
  const sql = getSql();
  // Drain the stream so the operation runs to completion before asserting.
  await res.text();
  expect(await sql.unsafe(`SELECT nspname FROM pg_namespace WHERE nspname = 'guard_same_tenant'`)).toHaveLength(0);
});
