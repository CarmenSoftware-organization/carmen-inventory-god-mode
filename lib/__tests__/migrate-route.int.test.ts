import { afterAll, beforeAll, expect, test, vi } from "vitest";
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
  vi.mock("@/lib/session", () => ({ requireAuth: async () => ({ authed: true }) }));
  const { getSql } = await import("@/lib/db");
  await getSql().unsafe(`CREATE SCHEMA "CARMEN_SYSTEM"; CREATE TABLE "CARMEN_SYSTEM".tb_cluster (id int primary key);`);
});
afterAll(async () => { await container.stop(); });

async function collect(res: Response): Promise<Record<string, unknown>[]> {
  const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = "";
  for (;;) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); }
  return buf.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
}

test("POST streams migration progress and finishes with done", async () => {
  const { POST } = await import("@/app/api/ops/migrate/route");
  const res = await POST();
  expect(res.status).toBe(200);
  const events = await collect(res);
  expect(events.find((e) => e.type === "total")).toEqual({ type: "total", total: 2 });
  expect(events.at(-1)).toMatchObject({ type: "done" });
});
