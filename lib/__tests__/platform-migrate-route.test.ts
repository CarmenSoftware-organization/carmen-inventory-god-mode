import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";

beforeAll(() => {
  process.env.SYSTEM_DATABASE_URL = "postgresql://u:p@h:6432/carmen_platform";
  process.env.DATABASE_URL = "postgresql://u:p@h:6432/carmen_platform";
  process.env.SYSTEM_SCHEMA_NAME = "CARMEN_SYSTEM";
  process.env.GOD_MODE_PASSWORD = "x";
  process.env.SESSION_SECRET = "x".repeat(32);
});

vi.mock("@/lib/session", () => ({ requireAuth: vi.fn(async () => ({ authed: true, actor: "operator@example.com" })) }));
vi.mock("@/lib/audit", () => ({ ensureAuditTable: vi.fn(async () => {}), writeAudit: vi.fn(async () => {}) }));
vi.mock("@/lib/db", () => ({ withTransaction: vi.fn(async (_s: unknown, fn: (tx: unknown) => unknown) => fn({})) }));
vi.mock("@/lib/registry", () => ({ listBusinessUnits: vi.fn(async () => [{ code: "T03", isActive: true }]) }));
vi.mock("@/lib/introspect", () => ({ listSchemaNames: vi.fn(async () => ["CARMEN_SYSTEM", "public"]) }));
vi.mock("@/lib/schema-bootstrap", () => ({ ensureSchemaExists: vi.fn(async () => {}) }));
vi.mock("@/lib/platform-package", () => ({
  assertPackageDir: vi.fn(async () => {}),
  assertPsql: vi.fn(async () => {}),
  buildSubprocessEnv: vi.fn(() => ({})),
  packageDir: vi.fn(() => "/pkg"),
  targetDbInfo: vi.fn(() => ({ host: "h", database: "carmen_platform", schema: "CARMEN_SYSTEM", masked: "postgresql://u@h:6432/carmen_platform" })),
  listTenantFiles: vi.fn(async () => ["001_v_operational_product_list.up.sql"]),
}));
const runProcess = vi.fn(async (o: { onLine: (l: string, s: string) => void }) => {
  o.onLine("running migration", "out");
  return { code: 0 };
});
vi.mock("@/lib/run-process", () => ({ runProcess: (o: unknown) => runProcess(o as never) }));

const req = (body: unknown) => new Request("http://localhost/api/ops/platform-migrate", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

async function collect(res: Response): Promise<Record<string, unknown>[]> {
  const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = "";
  for (;;) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); }
  return buf.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
}

const SCHEMA = "CARMEN_SYSTEM";

beforeEach(() => { runProcess.mockClear(); });
afterEach(() => { vi.restoreAllMocks(); });

test("401 when unauthorized", async () => {
  const { requireAuth } = await import("@/lib/session");
  (requireAuth as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("no"));
  const { POST } = await import("@/app/api/ops/platform-migrate/route");
  const res = await POST(req({ opId: "prisma-status", schema: SCHEMA }));
  expect(res.status).toBe(401);
});

test("404 for an unknown op", async () => {
  const { POST } = await import("@/app/api/ops/platform-migrate/route");
  const res = await POST(req({ opId: "nope", schema: SCHEMA }));
  expect(res.status).toBe(404);
});

test("rejects an invalid schema name before doing anything", async () => {
  const { POST } = await import("@/app/api/ops/platform-migrate/route");
  const res = await POST(req({ opId: "prisma-status", schema: "bad;name" }));
  expect(res.status).toBe(400);
  expect(runProcess).not.toHaveBeenCalled();
});

test("read-only op streams logs then done without a confirm phrase", async () => {
  const { POST } = await import("@/app/api/ops/platform-migrate/route");
  const res = await POST(req({ opId: "prisma-status", schema: SCHEMA }));
  expect(res.status).toBe(200);
  const events = await collect(res);
  expect(events.some((e) => e.type === "log")).toBe(true);
  expect(events.at(-1)).toMatchObject({ type: "done" });
  expect(runProcess).toHaveBeenCalledWith(expect.objectContaining({
    command: "bun", args: ["x", "prisma", "migrate", "status"], cwd: "/pkg",
  }));
});

test("read-only op allows a non-existent schema and does NOT create it", async () => {
  const { POST } = await import("@/app/api/ops/platform-migrate/route");
  const res = await POST(req({ opId: "prisma-status", schema: "NEW_ENV" }));
  expect(res.status).toBe(200);
  await collect(res);
  const { ensureSchemaExists } = await import("@/lib/schema-bootstrap");
  expect(ensureSchemaExists).not.toHaveBeenCalled();
});

test("write op rejects a wrong confirm phrase", async () => {
  const { POST } = await import("@/app/api/ops/platform-migrate/route");
  const res = await POST(req({ opId: "prisma-deploy", schema: SCHEMA, confirm: "wrong" }));
  expect(res.status).toBe(400);
  expect(runProcess).not.toHaveBeenCalled();
});

test("write op runs when confirm equals the schema name", async () => {
  const { POST } = await import("@/app/api/ops/platform-migrate/route");
  const res = await POST(req({ opId: "prisma-deploy", schema: SCHEMA, confirm: SCHEMA }));
  expect(res.status).toBe(200);
  await collect(res);
  expect(runProcess).toHaveBeenCalledWith(expect.objectContaining({ args: ["run", "db:deploy"] }));
});

test("destructive op requires confirmDestroy in addition to the phrase", async () => {
  const { POST } = await import("@/app/api/ops/platform-migrate/route");
  const noFlag = await POST(req({ opId: "migrate-reset", schema: SCHEMA, confirm: SCHEMA }));
  expect(noFlag.status).toBe(400);
  const ok = await POST(req({ opId: "migrate-reset", schema: SCHEMA, confirm: SCHEMA, confirmDestroy: true }));
  expect(ok.status).toBe(200);
  await collect(ok);
});

test("new schema on a write op requires confirmCreateSchema, then bootstraps it", async () => {
  const { POST } = await import("@/app/api/ops/platform-migrate/route");
  const { ensureSchemaExists } = await import("@/lib/schema-bootstrap");

  const noFlag = await POST(req({ opId: "prisma-deploy", schema: "NEW_ENV", confirm: "NEW_ENV" }));
  expect(noFlag.status).toBe(400);
  expect(ensureSchemaExists).not.toHaveBeenCalled();

  const ok = await POST(req({ opId: "prisma-deploy", schema: "NEW_ENV", confirm: "NEW_ENV", confirmCreateSchema: true }));
  expect(ok.status).toBe(200);
  await collect(ok);
  expect(ensureSchemaExists).toHaveBeenCalledWith("NEW_ENV");
});

test("tenant op rejects an unknown --bu and accepts a valid one", async () => {
  const { POST } = await import("@/app/api/ops/platform-migrate/route");
  const bad = await POST(req({ opId: "tenant-apply", schema: SCHEMA, confirm: SCHEMA, bu: "ZZZ" }));
  expect(bad.status).toBe(400);
  expect(runProcess).not.toHaveBeenCalled();
  const ok = await POST(req({ opId: "tenant-apply", schema: SCHEMA, confirm: SCHEMA, bu: "T03" }));
  expect(ok.status).toBe(200);
  await collect(ok);
  expect(runProcess).toHaveBeenCalledWith(expect.objectContaining({
    args: ["run", "db:tenant-views:apply", "--", "--bu", "T03"],
  }));
});

test("non-zero exit yields an error event and still audits", async () => {
  runProcess.mockResolvedValueOnce({ code: 1 } as never);
  const { POST } = await import("@/app/api/ops/platform-migrate/route");
  const res = await POST(req({ opId: "prisma-deploy", schema: SCHEMA, confirm: SCHEMA }));
  const events = await collect(res);
  expect(events.at(-1)).toMatchObject({ type: "error" });
  const { writeAudit } = await import("@/lib/audit");
  expect(writeAudit).toHaveBeenCalled();
});

test("rejects --only on an op that does not accept it", async () => {
  const { POST } = await import("@/app/api/ops/platform-migrate/route");
  const res = await POST(req({ opId: "prisma-deploy", schema: SCHEMA, confirm: SCHEMA, only: "001_v" }));
  expect(res.status).toBe(400);
  expect(runProcess).not.toHaveBeenCalled();
});

test("rejects an --only prefix that matches no tenant file", async () => {
  const { POST } = await import("@/app/api/ops/platform-migrate/route");
  const res = await POST(req({ opId: "tenant-apply", schema: SCHEMA, confirm: SCHEMA, only: "999_nope" }));
  expect(res.status).toBe(400);
  expect(runProcess).not.toHaveBeenCalled();
});

test("accepts a valid --only prefix and passes it through to argv", async () => {
  const { POST } = await import("@/app/api/ops/platform-migrate/route");
  const res = await POST(req({ opId: "tenant-apply", schema: SCHEMA, confirm: SCHEMA, only: "001_v_operational" }));
  expect(res.status).toBe(200);
  await collect(res);
  expect(runProcess).toHaveBeenCalledWith(expect.objectContaining({
    args: ["run", "db:tenant-views:apply", "--", "--only", "001_v_operational"],
  }));
});

test("audits the run with the chosen schema and operator", async () => {
  const { POST } = await import("@/app/api/ops/platform-migrate/route");
  const res = await POST(req({ opId: "prisma-status", schema: SCHEMA }));
  expect(res.status).toBe(200);
  await collect(res);
  const { writeAudit } = await import("@/lib/audit");
  expect(writeAudit).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ actor: "operator@example.com", operation: "MIGRATION", schemaName: SCHEMA }),
  );
});

test("rejects a concurrent run with 409 while one is in flight", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  runProcess.mockImplementationOnce(async (o: { onLine: (l: string, s: string) => void }) => { await gate; return { code: 0 }; });
  const { POST } = await import("@/app/api/ops/platform-migrate/route");
  const first = await POST(req({ opId: "prisma-status", schema: SCHEMA }));
  expect(first.status).toBe(200);
  const second = await POST(req({ opId: "prisma-status", schema: SCHEMA }));
  expect(second.status).toBe(409);
  release();
  await collect(first); // drain so the lock resets for later tests
});
