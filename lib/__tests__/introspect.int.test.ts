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
    CREATE TABLE app.parent (id int primary key, name text not null);
    CREATE TABLE app.child (id int primary key, parent_id int references app.parent(id), note text);
    CREATE TABLE app.composite (a int, b int, note text, PRIMARY KEY (b, a));
  `);
});
afterAll(async () => { await container.stop(); });

test("listTables returns tables in schema", async () => {
  const { listTables } = await import("@/lib/introspect");
  const names = (await listTables("app")).map((t) => t.name).sort();
  expect(names).toEqual(["child", "composite", "parent"]);
});

test("describeTable returns columns + pk", async () => {
  const { describeTable } = await import("@/lib/introspect");
  const shape = await describeTable("app", "parent");
  expect(shape.primaryKey).toEqual(["id"]);
  const name = shape.columns.find((c) => c.name === "name")!;
  expect(name.isNullable).toBe(false);
});

test("listForeignKeys finds the child->parent fk", async () => {
  const { listForeignKeys } = await import("@/lib/introspect");
  const fks = await listForeignKeys("app");
  expect(fks).toHaveLength(1);
  expect(fks[0].childTable).toBe("child");
  expect(fks[0].parentTable).toBe("parent");
  expect(fks[0].childColumns).toEqual(["parent_id"]);
  expect(fks[0].onDelete).toBe("NO ACTION");
});

test("describeTable returns composite PK in index-definition order (b, a), not attnum order", async () => {
  const { describeTable } = await import("@/lib/introspect");
  const shape = await describeTable("app", "composite");
  // Table columns are declared (a, b, note) but PK is PRIMARY KEY (b, a)
  // primaryKey must reflect the index definition order, not column attnum order
  expect(shape.primaryKey).toEqual(["b", "a"]);
});
