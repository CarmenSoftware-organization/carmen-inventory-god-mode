import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";

beforeAll(() => {
  process.env.SYSTEM_DATABASE_URL = "postgresql://u:p@h:6432/carmen_platform";
  process.env.DATABASE_URL = "postgresql://u:p@h:6432/carmen_platform";
  process.env.SYSTEM_SCHEMA_NAME = "CARMEN_SYSTEM";
  process.env.GOD_MODE_PASSWORD = "x";
  process.env.SESSION_SECRET = "x".repeat(32);
  process.env.ALLOW_DANGER_OPS = "true";
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
afterAll(() => { delete process.env.ALLOW_DANGER_OPS; });

test("migrate-reset still requires confirmDestroy when the flag is on", async () => {
  const { POST } = await import("@/app/api/ops/platform-migrate/route");
  const res = await POST(req({ opId: "migrate-reset", schema: SCHEMA, confirm: SCHEMA }));
  expect(res.status).toBe(400);
  expect(runProcess).not.toHaveBeenCalled();
});

test("migrate-reset runs with the full confirm set when ALLOW_DANGER_OPS=true", async () => {
  const { POST } = await import("@/app/api/ops/platform-migrate/route");
  const res = await POST(req({ opId: "migrate-reset", schema: SCHEMA, confirm: SCHEMA, confirmDestroy: true }));
  expect(res.status).toBe(200);
  const events = await collect(res);
  expect(events.at(-1)).toMatchObject({ type: "done" });
  expect(runProcess).toHaveBeenCalledWith(expect.objectContaining({ args: ["run", "db:migrate:reset"] }));
});
