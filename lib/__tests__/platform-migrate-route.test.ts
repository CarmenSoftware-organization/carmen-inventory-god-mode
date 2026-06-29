import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";

beforeAll(() => {
  process.env.SYSTEM_DATABASE_URL = "postgresql://u:p@h:6432/carmen_platform";
  process.env.DATABASE_URL = "postgresql://u:p@h:6432/carmen_platform";
  process.env.SYSTEM_SCHEMA_NAME = "CARMEN_SYSTEM";
  process.env.GOD_MODE_PASSWORD = "x";
  process.env.SESSION_SECRET = "x".repeat(32);
});

vi.mock("@/lib/session", () => ({ requireAuth: vi.fn(async () => ({ authed: true })) }));
vi.mock("@/lib/audit", () => ({ ensureAuditTable: vi.fn(async () => {}), writeAudit: vi.fn(async () => {}) }));
vi.mock("@/lib/db", () => ({ withTransaction: vi.fn(async (_s: unknown, fn: (tx: unknown) => unknown) => fn({})) }));
vi.mock("@/lib/registry", () => ({ listBusinessUnits: vi.fn(async () => [{ code: "T03", isActive: true }]) }));
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

beforeEach(() => { runProcess.mockClear(); });
afterEach(() => { vi.restoreAllMocks(); });

test("401 when unauthorized", async () => {
  const { requireAuth } = await import("@/lib/session");
  (requireAuth as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("no"));
  const { POST } = await import("@/app/api/ops/platform-migrate/route");
  const res = await POST(req({ opId: "prisma-status" }));
  expect(res.status).toBe(401);
});

test("404 for an unknown op", async () => {
  const { POST } = await import("@/app/api/ops/platform-migrate/route");
  const res = await POST(req({ opId: "nope" }));
  expect(res.status).toBe(404);
});

test("read-only op streams logs then done without a confirm phrase", async () => {
  const { POST } = await import("@/app/api/ops/platform-migrate/route");
  const res = await POST(req({ opId: "prisma-status" }));
  expect(res.status).toBe(200);
  const events = await collect(res);
  expect(events.some((e) => e.type === "log")).toBe(true);
  expect(events.at(-1)).toMatchObject({ type: "done" });
  expect(runProcess).toHaveBeenCalledWith(expect.objectContaining({
    command: "bun", args: ["x", "prisma", "migrate", "status"], cwd: "/pkg",
  }));
});

test("write op rejects a wrong confirm phrase", async () => {
  const { POST } = await import("@/app/api/ops/platform-migrate/route");
  const res = await POST(req({ opId: "prisma-deploy", confirm: "wrong" }));
  expect(res.status).toBe(400);
  expect(runProcess).not.toHaveBeenCalled();
});

test("write op runs when confirm equals the DB name", async () => {
  const { POST } = await import("@/app/api/ops/platform-migrate/route");
  const res = await POST(req({ opId: "prisma-deploy", confirm: "carmen_platform" }));
  expect(res.status).toBe(200);
  await collect(res);
  expect(runProcess).toHaveBeenCalledWith(expect.objectContaining({ args: ["run", "db:deploy"] }));
});

test("destructive op requires confirmDestroy in addition to the phrase", async () => {
  const { POST } = await import("@/app/api/ops/platform-migrate/route");
  const noFlag = await POST(req({ opId: "migrate-reset", confirm: "carmen_platform" }));
  expect(noFlag.status).toBe(400);
  const ok = await POST(req({ opId: "migrate-reset", confirm: "carmen_platform", confirmDestroy: true }));
  expect(ok.status).toBe(200);
  await collect(ok);
});

test("tenant op rejects an unknown --bu and accepts a valid one", async () => {
  const { POST } = await import("@/app/api/ops/platform-migrate/route");
  const bad = await POST(req({ opId: "tenant-apply", confirm: "carmen_platform", bu: "ZZZ" }));
  expect(bad.status).toBe(400);
  expect(runProcess).not.toHaveBeenCalled();
  const ok = await POST(req({ opId: "tenant-apply", confirm: "carmen_platform", bu: "T03" }));
  expect(ok.status).toBe(200);
  await collect(ok);
  expect(runProcess).toHaveBeenCalledWith(expect.objectContaining({
    args: ["run", "db:tenant-views:apply", "--", "--bu", "T03"],
  }));
});

test("non-zero exit yields an error event", async () => {
  runProcess.mockResolvedValueOnce({ code: 1 } as never);
  const { POST } = await import("@/app/api/ops/platform-migrate/route");
  const res = await POST(req({ opId: "prisma-deploy", confirm: "carmen_platform" }));
  const events = await collect(res);
  expect(events.at(-1)).toMatchObject({ type: "error" });
  const { writeAudit } = await import("@/lib/audit");
  expect(writeAudit).toHaveBeenCalled();
});

test("rejects --only on an op that does not accept it", async () => {
  const { POST } = await import("@/app/api/ops/platform-migrate/route");
  const res = await POST(req({ opId: "prisma-deploy", confirm: "carmen_platform", only: "001_v" }));
  expect(res.status).toBe(400);
  expect(runProcess).not.toHaveBeenCalled();
});

test("rejects an --only prefix that matches no tenant file", async () => {
  const { POST } = await import("@/app/api/ops/platform-migrate/route");
  const res = await POST(req({ opId: "tenant-apply", confirm: "carmen_platform", only: "999_nope" }));
  expect(res.status).toBe(400);
  expect(runProcess).not.toHaveBeenCalled();
});

test("accepts a valid --only prefix and passes it through to argv", async () => {
  const { POST } = await import("@/app/api/ops/platform-migrate/route");
  const res = await POST(req({ opId: "tenant-apply", confirm: "carmen_platform", only: "001_v_operational" }));
  expect(res.status).toBe(200);
  await collect(res);
  expect(runProcess).toHaveBeenCalledWith(expect.objectContaining({
    args: ["run", "db:tenant-views:apply", "--", "--only", "001_v_operational"],
  }));
});
