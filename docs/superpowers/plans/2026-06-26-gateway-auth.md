# Gateway Login (Super-Admin Gate) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Carmen platform super-admins log into the god-mode tool with their own backend credentials, keeping the existing shared-secret login as a second method.

**Architecture:** The iron-session cookie `godmode_session` stays the single authorization gate. A new server action `gatewayLogin` authenticates against the Carmen backend (`POST /api/auth/login`), checks platform permission (`GET /api/user/permission/platform` with `x-app-id`), and only sets the session when `is_super_admin === true`. `middleware.ts` and `lib/session.ts#requireAuth` are unchanged — they still check only `session.authed`.

**Tech Stack:** Next 16.2 (App Router, Server Actions), React 19.2 (`useActionState`), iron-session 8, zod 3, Vitest 2 (`@testing-library/react` for tsx), undici (bundled — TLS dispatcher).

## Global Constraints

- Run tests with `bun run test` (Vitest). **Never** `bun test`. Typecheck: `bun run typecheck`. Lint: `bun run lint`.
- New files must be **lint-clean** — no `@typescript-eslint/no-explicit-any`. Don't fix unrelated pre-existing lint.
- This is **Next 16**, not the Next you know (see `AGENTS.md`). Before writing the page/action code, skim `node_modules/next/dist/docs/` for current Server Actions + `useActionState` guidance.
- `x-app-id` for THIS tool is `42ab2083-5dbd-47fc-bb32-3de97dc0cd89` (NOT carmen-platform's id).
- Gate is strict: allow iff `is_super_admin === true` (boolean). Reject `"true"`, `1`, etc.
- Never log or render the bearer token, the password, or raw backend bodies. Map failures to fixed user messages only.
- Spec: `docs/superpowers/specs/2026-06-26-gateway-auth-design.md`.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/env.ts` (modify) | Add `BACKEND_API_BASE_URL` (optional), `BACKEND_API_APP_ID` (default app id), `BACKEND_API_INSECURE_TLS` (dev bool); derive `gatewayEnabled`. |
| `lib/backend-api.ts` (create) | Pure backend client: `verifySuperAdmin(username, password)` → login + permission check. No Next imports. |
| `lib/session.ts` (modify) | Add `method?: "secret" \| "gateway"` to `SessionData`. |
| `server/auth.ts` (modify) | Add `gatewayLogin` action; convert `login`/`gatewayLogin` to return `{ error? }` for `useActionState`; `login` stamps `method:"secret"`. |
| `app/login/page.tsx` (modify) | Server component; reads `env().gatewayEnabled`, renders `<LoginTabs>`. |
| `app/login/login-tabs.tsx` (create) | Client component: tabbed Gateway / Shared-secret forms with inline errors. |
| `.env.example` (modify) | Document the three new vars. |

Tests: `lib/__tests__/env.test.ts` (modify), `lib/__tests__/backend-api.test.ts` (create), `lib/__tests__/auth-gateway.test.ts` (create), `lib/__tests__/session.test.ts` (modify), `app/login/__tests__/login-tabs.test.tsx` (create).

---

## Task 1: Environment variables

**Files:**
- Modify: `lib/env.ts`
- Test: `lib/__tests__/env.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `Env` gains `backendApiBaseUrl?: string`, `backendApiAppId: string`, `backendApiInsecureTls: boolean`, `gatewayEnabled: boolean`. `loadEnv(raw)` and `env()` signatures unchanged.

- [ ] **Step 1: Write the failing tests**

Add to `lib/__tests__/env.test.ts`:

```ts
test("gateway disabled when no base url, app id defaults", () => {
  const env = loadEnv(base);
  expect(env.gatewayEnabled).toBe(false);
  expect(env.backendApiBaseUrl).toBeUndefined();
  expect(env.backendApiAppId).toBe("42ab2083-5dbd-47fc-bb32-3de97dc0cd89");
  expect(env.backendApiInsecureTls).toBe(false);
});

test("gateway enabled when base url present", () => {
  const env = loadEnv({ ...base, BACKEND_API_BASE_URL: "https://dev.blueledgers.com:4001" });
  expect(env.gatewayEnabled).toBe(true);
  expect(env.backendApiBaseUrl).toBe("https://dev.blueledgers.com:4001");
});

test("insecure tls only true for the literal string 'true'", () => {
  expect(loadEnv({ ...base, BACKEND_API_INSECURE_TLS: "true" }).backendApiInsecureTls).toBe(true);
  expect(loadEnv({ ...base, BACKEND_API_INSECURE_TLS: "false" }).backendApiInsecureTls).toBe(false);
});

test("rejects a non-url base url", () => {
  expect(() => loadEnv({ ...base, BACKEND_API_BASE_URL: "not-a-url" })).toThrow();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test lib/__tests__/env.test.ts`
Expected: FAIL — `gatewayEnabled` / `backendApiAppId` undefined on the returned object.

- [ ] **Step 3: Implement env.ts changes**

In `lib/env.ts`, add to the zod `schema` object (after `CASCADE_MAX_DEPTH`):

```ts
  BACKEND_API_BASE_URL: z.string().url().optional(),
  BACKEND_API_APP_ID: z.string().min(1).default("42ab2083-5dbd-47fc-bb32-3de97dc0cd89"),
  BACKEND_API_INSECURE_TLS: z.string().optional(),
```

Add to the `Env` type:

```ts
  backendApiBaseUrl?: string;
  backendApiAppId: string;
  backendApiInsecureTls: boolean;
  gatewayEnabled: boolean;
```

Add to the object returned by `loadEnv` (after `cascadeMaxDepth`):

```ts
    backendApiBaseUrl: p.BACKEND_API_BASE_URL,
    backendApiAppId: p.BACKEND_API_APP_ID,
    backendApiInsecureTls: p.BACKEND_API_INSECURE_TLS === "true",
    gatewayEnabled: !!p.BACKEND_API_BASE_URL,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test lib/__tests__/env.test.ts`
Expected: PASS (all env tests).

- [ ] **Step 5: Update `.env.example`**

Append to `.env.example`:

```
# Backend gateway login (optional). If BACKEND_API_BASE_URL is unset, only shared-secret login is shown.
BACKEND_API_BASE_URL=https://dev.blueledgers.com:4001
BACKEND_API_APP_ID=42ab2083-5dbd-47fc-bb32-3de97dc0cd89
# Dev only: skip TLS cert verification for the backend (self-signed cert on :4001). NEVER set true in production.
# BACKEND_API_INSECURE_TLS=true
```

- [ ] **Step 6: Commit**

```bash
git add lib/env.ts lib/__tests__/env.test.ts .env.example
git commit -m "feat(auth): backend gateway env vars + gatewayEnabled derive"
```

---

## Task 2: Backend gateway client

**Files:**
- Create: `lib/backend-api.ts`
- Test: `lib/__tests__/backend-api.test.ts`

**Interfaces:**
- Consumes: `env()` from `lib/env.ts` (`backendApiBaseUrl`, `backendApiAppId`, `backendApiInsecureTls`).
- Produces:
  - `type SuperAdminResult = { ok: true; actor: string } | { ok: false; reason: "invalid_credentials" | "not_super_admin" | "gateway_unavailable" }`
  - `async function verifySuperAdmin(username: string, password: string): Promise<SuperAdminResult>`

- [ ] **Step 1: Write the failing tests**

Create `lib/__tests__/backend-api.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test lib/__tests__/backend-api.test.ts`
Expected: FAIL — cannot resolve `@/lib/backend-api`.

- [ ] **Step 3: Implement the client**

Create `lib/backend-api.ts`:

```ts
import { z } from "zod";
import { env } from "@/lib/env";

const TIMEOUT_MS = 10_000;

export type GatewayReason = "invalid_credentials" | "not_super_admin" | "gateway_unavailable";
export type SuperAdminResult = { ok: true; actor: string } | { ok: false; reason: GatewayReason };

class GatewayError extends Error {
  constructor(public reason: GatewayReason) {
    super(reason);
  }
}

const loginSchema = z.object({ access_token: z.string().min(1) }).passthrough();
const permissionSchema = z
  .object({
    is_super_admin: z.boolean().optional(),
    platform: z.array(z.string()).optional(),
    clusters: z.record(z.array(z.string())).optional(),
  })
  .passthrough();

function unwrap(body: unknown): unknown {
  if (body && typeof body === "object" && "data" in body) {
    const inner = (body as { data: unknown }).data;
    if (inner && typeof inner === "object") return inner;
  }
  return body;
}

async function insecureDispatcher(): Promise<unknown | undefined> {
  if (!env().backendApiInsecureTls) return undefined;
  const { Agent } = await import("undici");
  return new Agent({ connect: { rejectUnauthorized: false } });
}

type FetchInit = RequestInit & { dispatcher?: unknown };

async function apiFetch(path: string, init: FetchInit): Promise<Response> {
  const base = env().backendApiBaseUrl;
  if (!base) throw new GatewayError("gateway_unavailable");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const dispatcher = await insecureDispatcher();
    return await fetch(`${base}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-app-id": env().backendApiAppId,
        ...(init.headers ?? {}),
      },
      ...(dispatcher ? { dispatcher } : {}),
    });
  } finally {
    clearTimeout(timer);
  }
}

async function gatewayLogin(username: string, password: string): Promise<string> {
  const res = await apiFetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new GatewayError("invalid_credentials");
  const parsed = loginSchema.safeParse(unwrap(await res.json()));
  if (!parsed.success) throw new GatewayError("invalid_credentials");
  return parsed.data.access_token;
}

async function fetchPlatformPermission(token: string): Promise<boolean> {
  const res = await apiFetch("/api/user/permission/platform", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new GatewayError("not_super_admin");
  const parsed = permissionSchema.safeParse(unwrap(await res.json()));
  if (!parsed.success) throw new GatewayError("not_super_admin");
  return parsed.data.is_super_admin === true;
}

export async function verifySuperAdmin(username: string, password: string): Promise<SuperAdminResult> {
  try {
    const token = await gatewayLogin(username, password);
    const isSuperAdmin = await fetchPlatformPermission(token);
    return isSuperAdmin ? { ok: true, actor: username } : { ok: false, reason: "not_super_admin" };
  } catch (e) {
    if (e instanceof GatewayError) return { ok: false, reason: e.reason };
    return { ok: false, reason: "gateway_unavailable" };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test lib/__tests__/backend-api.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/backend-api.ts lib/__tests__/backend-api.test.ts
git commit -m "feat(auth): backend gateway client with super-admin verification"
```

---

## Task 3: Session field + server actions

**Files:**
- Modify: `lib/session.ts`
- Modify: `server/auth.ts`
- Test: `lib/__tests__/auth-gateway.test.ts` (create), `lib/__tests__/session.test.ts` (modify)

**Interfaces:**
- Consumes: `verifySuperAdmin` from `lib/backend-api.ts`; `getSession`, `verifyPassword` from `lib/session.ts`.
- Produces:
  - `lib/session.ts`: `SessionData = { authed: boolean; actor?: string; method?: "secret" | "gateway" }`.
  - `server/auth.ts`: `login(prev: { error?: string }, formData: FormData): Promise<{ error?: string }>`, `gatewayLogin(prev: { error?: string }, formData: FormData): Promise<{ error?: string }>`, `logout(): Promise<void>` (unchanged signature). On success both login actions call `redirect("/schemas")`.

- [ ] **Step 1: Write the failing tests**

Create `lib/__tests__/auth-gateway.test.ts`:

```ts
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
```

Add to `lib/__tests__/session.test.ts`:

```ts
test("assertAuthed accepts a session carrying a method", async () => {
  const { assertAuthed } = await import("@/lib/session");
  expect(() => assertAuthed({ authed: true, actor: "alice", method: "gateway" })).not.toThrow();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test lib/__tests__/auth-gateway.test.ts lib/__tests__/session.test.ts`
Expected: FAIL — `gatewayLogin` not exported; `login` signature mismatch; `method` not on `SessionData`.

- [ ] **Step 3: Implement the session field**

In `lib/session.ts`, change the `SessionData` type:

```ts
export type SessionData = { authed: boolean; actor?: string; method?: "secret" | "gateway" };
```

(Leave `verifyPassword`, `assertAuthed`, `requireAuth`, `getSession` unchanged.)

- [ ] **Step 4: Implement the server actions**

Replace the body of `server/auth.ts` with:

```ts
"use server";
import { redirect } from "next/navigation";
import { getSession, verifyPassword } from "@/lib/session";
import { verifySuperAdmin, type GatewayReason } from "@/lib/backend-api";

function messageFor(reason: GatewayReason): string {
  switch (reason) {
    case "invalid_credentials":
      return "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง";
    case "not_super_admin":
      return "บัญชีนี้ไม่มีสิทธิ์ super admin";
    case "gateway_unavailable":
      return "เชื่อมต่อ backend ไม่ได้ — ลองเข้าด้วย shared secret";
  }
}

export async function login(_prev: { error?: string }, formData: FormData): Promise<{ error?: string }> {
  const secret = String(formData.get("secret") ?? "");
  const actor = String(formData.get("actor") ?? "god").slice(0, 64) || "god";
  if (!verifyPassword(secret)) return { error: "รหัสลับไม่ถูกต้อง" };
  const session = await getSession();
  session.authed = true;
  session.actor = actor;
  session.method = "secret";
  await session.save();
  redirect("/schemas");
}

export async function gatewayLogin(_prev: { error?: string }, formData: FormData): Promise<{ error?: string }> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!username || !password) return { error: "กรอกชื่อผู้ใช้และรหัสผ่าน" };
  const result = await verifySuperAdmin(username, password);
  if (!result.ok) return { error: messageFor(result.reason) };
  const session = await getSession();
  session.authed = true;
  session.actor = result.actor.slice(0, 64);
  session.method = "gateway";
  await session.save();
  redirect("/schemas");
}

export async function logout(): Promise<void> {
  const session = await getSession();
  session.destroy();
  redirect("/login");
}
```

> Note: `redirect()` is typed `never`, so no trailing `return` is needed after it. `messageFor` is module-local (not exported) — a `"use server"` file may only export async functions, and `messageFor` is not exported.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun run test lib/__tests__/auth-gateway.test.ts lib/__tests__/session.test.ts`
Expected: PASS (6 gateway tests + existing session tests + new method test).

- [ ] **Step 6: Commit**

```bash
git add lib/session.ts server/auth.ts lib/__tests__/auth-gateway.test.ts lib/__tests__/session.test.ts
git commit -m "feat(auth): gatewayLogin action + session method field"
```

---

## Task 4: Login page tabs UI

**Files:**
- Modify: `app/login/page.tsx`
- Create: `app/login/login-tabs.tsx`
- Test: `app/login/__tests__/login-tabs.test.tsx`

**Interfaces:**
- Consumes: `login`, `gatewayLogin` from `server/auth.ts` (each `(prev: { error?: string }, formData) => Promise<{ error?: string }>`); `env().gatewayEnabled` from `lib/env.ts`.
- Produces: `export function LoginTabs({ gatewayEnabled }: { gatewayEnabled: boolean })`.

- [ ] **Step 1: Write the failing tests**

Create `app/login/__tests__/login-tabs.test.tsx`:

```tsx
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("@/server/auth", () => ({
  login: async () => ({}),
  gatewayLogin: async () => ({}),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("shows both tabs and the gateway form by default when gateway is enabled", async () => {
  const { LoginTabs } = await import("@/app/login/login-tabs");
  render(<LoginTabs gatewayEnabled={true} />);
  expect(screen.getByRole("button", { name: /gateway login/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /shared secret/i })).toBeInTheDocument();
  expect(screen.getByPlaceholderText(/email or username/i)).toBeInTheDocument();
});

test("switches to the shared-secret form when its tab is clicked", async () => {
  const { LoginTabs } = await import("@/app/login/login-tabs");
  render(<LoginTabs gatewayEnabled={true} />);
  fireEvent.click(screen.getByRole("button", { name: /shared secret/i }));
  expect(screen.getByPlaceholderText(/shared secret/i)).toBeInTheDocument();
  expect(screen.queryByPlaceholderText(/email or username/i)).not.toBeInTheDocument();
});

test("hides the gateway tab and shows only the secret form when gateway is disabled", async () => {
  const { LoginTabs } = await import("@/app/login/login-tabs");
  render(<LoginTabs gatewayEnabled={false} />);
  expect(screen.queryByRole("button", { name: /gateway login/i })).not.toBeInTheDocument();
  expect(screen.getByPlaceholderText(/shared secret/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test app/login/__tests__/login-tabs.test.tsx`
Expected: FAIL — cannot resolve `@/app/login/login-tabs`.

- [ ] **Step 3: Implement the client component**

Create `app/login/login-tabs.tsx`:

```tsx
"use client";
import { useActionState, useState } from "react";
import { login, gatewayLogin } from "@/server/auth";

type Tab = "gateway" | "secret";

export function LoginTabs({ gatewayEnabled }: { gatewayEnabled: boolean }) {
  const [tab, setTab] = useState<Tab>(gatewayEnabled ? "gateway" : "secret");
  const [gwState, gwAction, gwPending] = useActionState(gatewayLogin, {});
  const [secState, secAction, secPending] = useActionState(login, {});

  return (
    <div className="space-y-4">
      {gatewayEnabled && (
        <div className="flex gap-4 border-b text-sm">
          <button
            type="button"
            onClick={() => setTab("gateway")}
            className={tab === "gateway" ? "border-b-2 border-black pb-1 font-medium" : "pb-1 text-gray-500"}
          >
            Gateway login
          </button>
          <button
            type="button"
            onClick={() => setTab("secret")}
            className={tab === "secret" ? "border-b-2 border-black pb-1 font-medium" : "pb-1 text-gray-500"}
          >
            Shared secret
          </button>
        </div>
      )}

      {gatewayEnabled && tab === "gateway" && (
        <form action={gwAction} className="space-y-3">
          <input name="username" placeholder="Email or username" required className="w-full rounded border p-2" />
          <input name="password" type="password" placeholder="Password" required className="w-full rounded border p-2" />
          {gwState.error && <p role="alert" className="text-sm text-red-600">{gwState.error}</p>}
          <button type="submit" disabled={gwPending} className="w-full rounded bg-black p-2 text-white disabled:opacity-50">
            {gwPending ? "Signing in…" : "Enter"}
          </button>
        </form>
      )}

      {tab === "secret" && (
        <form action={secAction} className="space-y-3">
          <input name="actor" placeholder="Your name (for audit)" className="w-full rounded border p-2" />
          <input name="secret" type="password" placeholder="Shared secret" required className="w-full rounded border p-2" />
          {secState.error && <p role="alert" className="text-sm text-red-600">{secState.error}</p>}
          <button type="submit" disabled={secPending} className="w-full rounded bg-black p-2 text-white disabled:opacity-50">
            {secPending ? "Entering…" : "Enter"}
          </button>
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Rewrite the page to use it**

Replace `app/login/page.tsx` with:

```tsx
import { env } from "@/lib/env";
import { LoginTabs } from "@/app/login/login-tabs";

export default function LoginPage() {
  return (
    <main className="mx-auto mt-24 max-w-sm space-y-4 p-6">
      <h1 className="text-xl font-semibold">God Mode</h1>
      <LoginTabs gatewayEnabled={env().gatewayEnabled} />
    </main>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun run test app/login/__tests__/login-tabs.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add app/login/page.tsx app/login/login-tabs.tsx app/login/__tests__/login-tabs.test.tsx
git commit -m "feat(auth): tabbed login page (gateway | shared secret)"
```

---

## Final Verification (after all tasks)

- [ ] **Full suite + types + lint**

```bash
bun run test
bun run typecheck
bun run lint
```
Expected: all tests pass; typecheck clean; **no new** lint errors in the files this plan created/modified (repo-wide lint is not clean per CLAUDE.md — ignore pre-existing `no-explicit-any` in older `lib/*` and `components/sql-console.tsx`).

- [ ] **Manual smoke (requires real backend + a super-admin account — cannot be automated)**

1. In `.env.local`, set `BACKEND_API_BASE_URL=https://dev.blueledgers.com:4001` and `BACKEND_API_APP_ID=42ab2083-5dbd-47fc-bb32-3de97dc0cd89`. If the dev cert is self-signed, also set `BACKEND_API_INSECURE_TLS=true` (dev only).
2. `bun run dev` (port **3305**) → open `/login`.
3. Gateway tab: log in with a **super-admin** account → lands on `/schemas`.
4. Gateway tab: log in with a **non-super-admin** account → inline "บัญชีนี้ไม่มีสิทธิ์ super admin", stays on `/login`.
5. Gateway tab: wrong password → "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง".
6. Shared-secret tab: existing `GOD_MODE_PASSWORD` → lands on `/schemas`; audit `actor` is the typed name.
7. Unset `BACKEND_API_BASE_URL`, restart → `/login` shows only the shared-secret form (no tabs).

---

## Self-Review Notes (author)

- **Spec coverage:** dual login (Tasks 3–4), `is_super_admin` strict gate (Task 2), no token persisted (Task 3 sets only `authed/actor/method`), middleware/requireAuth untouched (not modified by any task), error mapping 4 cases (Task 2 reasons + Task 3 messages), tabbed UI (Task 4), env optional + insecure-tls dev flag (Task 1), tests all `fetch`-mocked (Tasks 2–4). ✓
- **Type consistency:** `verifySuperAdmin`/`SuperAdminResult`/`GatewayReason` defined in Task 2 and consumed verbatim in Task 3; `{ error?: string }` action shape consistent across Tasks 3–4. ✓
- **No placeholders:** every code step shows complete code. ✓
