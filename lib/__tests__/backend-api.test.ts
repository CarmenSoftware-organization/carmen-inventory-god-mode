import { beforeAll, beforeEach, expect, test, vi } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

beforeAll(() => {
  process.env.DATABASE_URL = "postgresql://u:p@h:6432/postgres";
  process.env.SYSTEM_DATABASE_URL = "postgresql://u:p@h:6432/postgres";
  process.env.GOD_MODE_PASSWORD = "x";
  process.env.SESSION_SECRET = "x".repeat(32);
  process.env.BACKEND_API_BASE_URL = "https://backend.test";
  process.env.BACKEND_API_APP_ID = "42ab2083-5dbd-47fc-bb32-3de97dc0cd89";
});
beforeEach(() => fetchMock.mockReset());

const res = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("authorizes a super admin (wrapped data envelope)", async () => {
  fetchMock
    .mockResolvedValueOnce(res({ data: { access_token: "tok" } }))
    .mockResolvedValueOnce(res({ data: { is_super_admin: true, platform: [], clusters: {} } }));
  const { verifySuperAdmin } = await import("@/lib/backend-api");
  expect(await verifySuperAdmin("alice", "pw")).toEqual({ ok: true, actor: "alice" });
  // login call carries x-app-id + json body
  const [, loginInit] = fetchMock.mock.calls[0];
  expect((loginInit.headers as Record<string, string>)["x-app-id"]).toBe("42ab2083-5dbd-47fc-bb32-3de97dc0cd89");
  // permission call carries the bearer token
  const [, permInit] = fetchMock.mock.calls[1];
  expect((permInit.headers as Record<string, string>).Authorization).toBe("Bearer tok");
});

test("parses a flat (unwrapped) envelope too", async () => {
  fetchMock
    .mockResolvedValueOnce(res({ access_token: "tok" }))
    .mockResolvedValueOnce(res({ is_super_admin: true }));
  const { verifySuperAdmin } = await import("@/lib/backend-api");
  expect(await verifySuperAdmin("alice", "pw")).toEqual({ ok: true, actor: "alice" });
});

test("login 401 -> invalid_credentials", async () => {
  fetchMock.mockResolvedValueOnce(res({ message: "bad" }, 401));
  const { verifySuperAdmin } = await import("@/lib/backend-api");
  expect(await verifySuperAdmin("alice", "pw")).toEqual({ ok: false, reason: "invalid_credentials" });
});

test("login ok but missing access_token -> invalid_credentials", async () => {
  fetchMock.mockResolvedValueOnce(res({ data: {} }));
  const { verifySuperAdmin } = await import("@/lib/backend-api");
  expect(await verifySuperAdmin("alice", "pw")).toEqual({ ok: false, reason: "invalid_credentials" });
});

test("is_super_admin false -> not_super_admin", async () => {
  fetchMock
    .mockResolvedValueOnce(res({ data: { access_token: "tok" } }))
    .mockResolvedValueOnce(res({ data: { is_super_admin: false } }));
  const { verifySuperAdmin } = await import("@/lib/backend-api");
  expect(await verifySuperAdmin("alice", "pw")).toEqual({ ok: false, reason: "not_super_admin" });
});

test("is_super_admin as string 'true' is rejected (strict boolean)", async () => {
  fetchMock
    .mockResolvedValueOnce(res({ data: { access_token: "tok" } }))
    .mockResolvedValueOnce(res({ data: { is_super_admin: "true" } }));
  const { verifySuperAdmin } = await import("@/lib/backend-api");
  expect(await verifySuperAdmin("alice", "pw")).toEqual({ ok: false, reason: "not_super_admin" });
});

test("network failure -> gateway_unavailable", async () => {
  fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
  const { verifySuperAdmin } = await import("@/lib/backend-api");
  expect(await verifySuperAdmin("alice", "pw")).toEqual({ ok: false, reason: "gateway_unavailable" });
});

test("permission endpoint non-2xx -> not_super_admin", async () => {
  fetchMock
    .mockResolvedValueOnce(res({ data: { access_token: "tok" } }))
    .mockResolvedValueOnce(res({ message: "forbidden" }, 403));
  const { verifySuperAdmin } = await import("@/lib/backend-api");
  expect(await verifySuperAdmin("alice", "pw")).toEqual({ ok: false, reason: "not_super_admin" });
});

test("non-JSON login body -> invalid_credentials", async () => {
  fetchMock.mockResolvedValueOnce(
    new Response("<html>oops</html>", { status: 200, headers: { "content-type": "text/html" } }),
  );
  const { verifySuperAdmin } = await import("@/lib/backend-api");
  expect(await verifySuperAdmin("alice", "pw")).toEqual({ ok: false, reason: "invalid_credentials" });
});
