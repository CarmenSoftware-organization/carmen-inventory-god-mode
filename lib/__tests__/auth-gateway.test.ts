import { beforeEach, expect, test, vi } from "vitest";

const redirect = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (...a: unknown[]) => redirect(...a) }));

const save = vi.fn();
const session: { authed: boolean; actor?: string; method?: string; save: () => void; destroy: () => void } = {
  authed: false,
  save,
  destroy: vi.fn(),
};
vi.mock("@/lib/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/session")>();
  return { ...actual, getSession: async () => session };
});

const verifySuperAdmin = vi.fn();
vi.mock("@/lib/backend-api", () => ({ verifySuperAdmin: (...a: unknown[]) => verifySuperAdmin(...a) }));

beforeEach(() => {
  process.env.GOD_MODE_PASSWORD = "hunter2";
  process.env.SESSION_SECRET = "x".repeat(32);
  process.env.DATABASE_URL = "postgresql://u:p@h:6432/postgres";
  process.env.SYSTEM_DATABASE_URL = "postgresql://u:p@h:6432/postgres";
  session.authed = false;
  session.actor = undefined;
  session.method = undefined;
  redirect.mockClear();
  save.mockClear();
  verifySuperAdmin.mockReset();
});

function fd(o: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
}

test("gatewayLogin authorizes a super admin, stamps method, redirects", async () => {
  verifySuperAdmin.mockResolvedValueOnce({ ok: true, actor: "alice@carmen.io" });
  const { gatewayLogin } = await import("@/server/auth");
  await gatewayLogin({}, fd({ username: "alice@carmen.io", password: "pw" }));
  expect(session.authed).toBe(true);
  expect(session.actor).toBe("alice@carmen.io");
  expect(session.method).toBe("gateway");
  expect(save).toHaveBeenCalledOnce();
  expect(redirect).toHaveBeenCalledWith("/schemas");
});

test("gatewayLogin rejects a non super admin without touching the session", async () => {
  verifySuperAdmin.mockResolvedValueOnce({ ok: false, reason: "not_super_admin" });
  const { gatewayLogin } = await import("@/server/auth");
  const out = await gatewayLogin({}, fd({ username: "bob", password: "pw" }));
  expect(out).toEqual({ error: "บัญชีนี้ไม่มีสิทธิ์ super admin" });
  expect(session.authed).toBe(false);
  expect(save).not.toHaveBeenCalled();
  expect(redirect).not.toHaveBeenCalled();
});

test("gatewayLogin surfaces a connect error", async () => {
  verifySuperAdmin.mockResolvedValueOnce({ ok: false, reason: "gateway_unavailable" });
  const { gatewayLogin } = await import("@/server/auth");
  const out = await gatewayLogin({}, fd({ username: "x", password: "y" }));
  expect(out).toEqual({ error: "เชื่อมต่อ backend ไม่ได้ — ลองเข้าด้วย shared secret" });
});

test("gatewayLogin requires both fields and never calls the backend", async () => {
  const { gatewayLogin } = await import("@/server/auth");
  expect(await gatewayLogin({}, fd({ username: "", password: "" }))).toEqual({ error: "กรอกชื่อผู้ใช้และรหัสผ่าน" });
  expect(verifySuperAdmin).not.toHaveBeenCalled();
});

test("secret login still works and stamps method secret", async () => {
  const { login } = await import("@/server/auth");
  await login({}, fd({ actor: "god", secret: "hunter2" }));
  expect(session.authed).toBe(true);
  expect(session.method).toBe("secret");
  expect(redirect).toHaveBeenCalledWith("/schemas");
});

test("secret login rejects a bad secret", async () => {
  const { login } = await import("@/server/auth");
  const out = await login({}, fd({ actor: "god", secret: "nope" }));
  expect(out).toEqual({ error: "รหัสลับไม่ถูกต้อง" });
  expect(session.authed).toBe(false);
});

test("gatewayLogin maps invalid_credentials to the Thai message", async () => {
  verifySuperAdmin.mockResolvedValueOnce({ ok: false, reason: "invalid_credentials" });
  const { gatewayLogin } = await import("@/server/auth");
  const out = await gatewayLogin({}, fd({ username: "alice", password: "wrongpw" }));
  expect(out).toEqual({ error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" });
  expect(session.authed).toBe(false);
  expect(save).not.toHaveBeenCalled();
});
