import { afterAll, beforeAll, expect, test, vi } from "vitest";
import type { Pg } from "@/test/pg";
import { startPg } from "@/test/pg";

const { requireAuthMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(async () => ({ authed: true, actor: "tester" })),
}));

let container: Pg;
beforeAll(async () => {
  const pg = await startPg();
  container = pg.container;
  process.env.DATABASE_URL = pg.url;
  process.env.SYSTEM_DATABASE_URL = pg.url;
  process.env.SYSTEM_SCHEMA_NAME = "CARMEN_SYSTEM";
  process.env.GOD_MODE_PASSWORD = "x";
  process.env.SESSION_SECRET = "x".repeat(32);
  process.env.CASCADE_MAX_ROWS = "5000";
  process.env.CASCADE_MAX_DEPTH = "20";
  vi.mock("@/lib/session", () => ({ requireAuth: requireAuthMock }));
  vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
  const { getSql } = await import("@/lib/db");
  await getSql().unsafe(`
    CREATE SCHEMA "CARMEN_SYSTEM";
    CREATE SCHEMA app;
    CREATE TABLE app.p (id int primary key);
    INSERT INTO app.p VALUES (1),(2);
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
async function collect(res: Response): Promise<any[]> {
  const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = "";
  for (;;) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); }
  return buf.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
}

test("returns 401 JSON and deletes nothing when unauthorized", async () => {
  const { POST } = await import("@/app/api/ops/cascade-delete/route");
  requireAuthMock.mockRejectedValueOnce(new Error("Unauthorized"));
  const res = await POST(req({ schema: "app", table: "p", pks: [{ id: 1 }], confirm: "DELETE" }));
  expect(res.status).toBe(401);
  expect(res.headers.get("content-type")).toContain("application/json");
  expect(await res.json()).toEqual({ error: "Unauthorized" });
  const { getSql } = await import("@/lib/db");
  const n = await getSql().unsafe(`SELECT count(*)::int n FROM app.p`);
  expect(n[0].n).toBe(2);
});

test("rejects a wrong confirm phrase with 400 and does not delete", async () => {
  const { POST } = await import("@/app/api/ops/cascade-delete/route");
  const res = await POST(req({ schema: "app", table: "p", pks: [{ id: 1 }], confirm: "nope" }));
  expect(res.status).toBe(400);
  const { getSql } = await import("@/lib/db");
  const n = await getSql().unsafe(`SELECT count(*)::int n FROM app.p`);
  expect(n[0].n).toBe(2);
});

test("streams progress and deletes the selected rows", async () => {
  const { POST } = await import("@/app/api/ops/cascade-delete/route");
  const res = await POST(req({ schema: "app", table: "p", pks: [{ id: 1 }, { id: 2 }], confirm: "DELETE" }));
  expect(res.status).toBe(200);
  const events = await collect(res);
  expect(events.some((e) => e.type === "total")).toBe(true);
  expect(events.at(-1)).toMatchObject({ type: "done" });
  const { getSql } = await import("@/lib/db");
  const n = await getSql().unsafe(`SELECT count(*)::int n FROM app.p`);
  expect(n[0].n).toBe(0);
});
