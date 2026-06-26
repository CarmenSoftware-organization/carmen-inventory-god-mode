# Gateway Login (Super-Admin Gate) — Design

**Date:** 2026-06-26
**Status:** Approved (design)
**Approach:** Add backend-gateway login alongside the existing shared-secret login. A user may enter god mode by either (a) authenticating against the Carmen backend gateway and being a platform `is_super_admin`, or (b) the existing `GOD_MODE_PASSWORD` shared secret (fallback / offline).

## Goal

Let real Carmen platform super-admins log in to the god-mode tool with their own credentials, while keeping the shared-secret login as a second method. The iron-session cookie stays the single authorization gate; we only add a second way to populate it.

## Non-goals

- No change to `middleware.ts` or `requireAuth()` — they keep checking only `session.authed`.
- No per-request re-validation of super-admin status (revocation takes effect on next login / cookie expiry). A TTL re-check is a possible later upgrade, explicitly out of scope here.
- No storing of the gateway bearer token in the session (used during login, then discarded).
- No integration test against the live backend (external service; all `fetch` mocked).

## Backend API contract (from sibling repo `carmen-platform`)

- **Base URL:** `https://dev.blueledgers.com:4001` → env `BACKEND_API_BASE_URL`.
- **App id header:** `x-app-id: 42ab2083-5dbd-47fc-bb32-3de97dc0cd89` → env `BACKEND_API_APP_ID` (default this value). Note: this is the god-mode tool's own app registration; `carmen-platform` uses a different id (`bc1ade0a-…`).
- **Common headers:** `Content-Type: application/json`, `x-app-id: <id>`, and after login `Authorization: Bearer <access_token>`.
- **Login:** `POST {base}/api/auth/login`, body `{ "username": "<email or username>", "password": "..." }`. Response is wrapped — read `data.data ?? data` → `{ access_token, refresh_token?, expires_in?, token_type? }`. Token = `access_token`.
- **Permission:** `GET {base}/api/user/permission/platform` with bearer + x-app-id. Response wrapped — `data.data ?? data` → `{ platform: string[], clusters: Record<string,string[]>, is_super_admin: boolean }`.
- **Gate:** allow iff `is_super_admin === true` (strict boolean). The god-mode tool is stricter than carmen-platform, which also grants on platform/cluster perms and a first-admin bootstrap.

## Architecture

The iron-session cookie (`godmode_session`) remains the only gate. Gateway login is a second server action that, on success, sets the same `{ authed: true, actor, method }` session that the shared-secret login sets. `middleware.ts` and `lib/session.ts#requireAuth` are unchanged.

```
/login (tabs: Gateway | Shared secret)
   │
   ├─ Gateway form ──> server action gatewayLogin(formData)
   │                      └─> lib/backend-api.verifySuperAdmin(username, password)
   │                             ├─ POST /api/auth/login            -> access_token
   │                             └─ GET  /api/user/permission/platform (Bearer + x-app-id) -> is_super_admin
   │                      ok && is_super_admin === true
   │                          ├─ yes -> session { authed:true, actor:username, method:"gateway" } -> redirect /schemas
   │                          └─ no  -> return { error } (rendered inline)
   │
   └─ Shared-secret form ──> server action login(formData)  (existing; now sets method:"secret", returns { error })
```

## Components / files

| File | Change | Responsibility |
|---|---|---|
| `lib/backend-api.ts` | new | Pure client (no Next imports). `gatewayLogin()`, `fetchPlatformPermission()`, `verifySuperAdmin()`. Uses `fetch` + AbortController (10s timeout), tolerant parse `data.data ?? data`, zod-validated response shapes. |
| `lib/env.ts` | edit | Add `BACKEND_API_BASE_URL` (optional url), `BACKEND_API_APP_ID` (default `42ab2083-5dbd-47fc-bb32-3de97dc0cd89`), `BACKEND_API_INSECURE_TLS` (optional bool, dev only). Derived `gatewayEnabled = !!backendApiBaseUrl`. |
| `lib/session.ts` | edit (small) | `SessionData` gains `method?: "secret" \| "gateway"`. `verifyPassword`/`assertAuthed`/`requireAuth` unchanged. |
| `server/auth.ts` | edit | Add `gatewayLogin` action. Convert `login` and `gatewayLogin` to **return `{ error }`** instead of throwing (so errors render inline via `useActionState`); `redirect()` still thrown internally on success. `login` sets `method:"secret"`. `logout` unchanged (works for both). |
| `app/login/page.tsx` | edit | Tabbed UI (default **Gateway**, switch to **Shared secret**). Client component using `useActionState` to show inline errors. Gateway tab hidden when `gatewayEnabled` is false. |
| `.env.example` | edit | Add the three new vars (with the app-id default and an inline note that `BACKEND_API_INSECURE_TLS` is dev-only). |

### `lib/backend-api.ts` surface

```ts
type SuperAdminResult =
  | { ok: true; actor: string }
  | { ok: false; reason: "invalid_credentials" | "not_super_admin" | "gateway_unavailable" };

async function verifySuperAdmin(username: string, password: string): Promise<SuperAdminResult>;
```

- `gatewayLogin(username, password)` → POST login, parse, return `{ token }`; throws/maps to `invalid_credentials` on 400/401 or missing `access_token`.
- `fetchPlatformPermission(token)` → GET permission with bearer + x-app-id, zod-parse → `{ is_super_admin, platform, clusters }`.
- `verifySuperAdmin` orchestrates and maps every failure to one of the three `reason` codes. Never returns/throws raw backend bodies or the token.
- Reads base url / app id / insecure-tls from `env()`. When `BACKEND_API_INSECURE_TLS === true`, attach an undici dispatcher (or agent) that skips TLS verification — **dev only, default secure.**

## Data flow

**Gateway login:** form → `gatewayLogin` action → `verifySuperAdmin` (login → permission) → if `is_super_admin === true` set session `{ authed:true, actor:username, method:"gateway" }`, save, `redirect("/schemas")`. No token persisted; no subsequent re-check. Middleware sees `authed` cookie on later requests and allows.

**Shared-secret login:** unchanged except `method:"secret"` and returning `{ error }` on bad secret.

**Logout:** unchanged — `session.destroy()` + redirect `/login` for both methods.

**Audit:** `lib/audit` already stamps `session.actor`; gateway login provides the username as actor. `method` is available for audit metadata if useful (optional).

## Error handling

All login errors render inline at `/login`; no Next error overlay, no leaked internals.

| Situation | Mapped reason | User message (Thai) |
|---|---|---|
| login 400/401 | `invalid_credentials` | "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" |
| login ok but `is_super_admin !== true` / 403 | `not_super_admin` | "บัญชีนี้ไม่มีสิทธิ์ super admin" |
| timeout / network / 5xx / TLS error | `gateway_unavailable` | "เชื่อมต่อ backend ไม่ได้ — ลองเข้าด้วย shared secret" |
| response missing `access_token` / malformed | `invalid_credentials` | (same as above) |

Security:
- Never log or render the token or raw backend body — map to fixed messages only.
- Never persist the password; token lives only inside `verifySuperAdmin` scope.
- 10s AbortController timeout to avoid hanging on backend stalls.
- Strict `is_super_admin === true` (zod boolean) — reject `"true"` / `1`.
- Gateway vs secret errors do not reveal whether a username exists.
- TLS: `BACKEND_API_INSECURE_TLS` is the only way to skip cert checks, opt-in, dev only; committed default verifies certs.

## Testing

Project convention: `.test.ts` → node; mock `@/lib/session` and `next/*`; all `fetch` mocked (no live backend).

| Test file | Type | Cases |
|---|---|---|
| `lib/__tests__/backend-api.test.ts` | node, mock `fetch` | login+super-admin → `ok`; login 401 → `invalid_credentials`; `is_super_admin:false` → `not_super_admin`; parses both `data.data` and flat; network/timeout → `gateway_unavailable`; missing `access_token` → `invalid_credentials`; `is_super_admin:"true"` (string) → rejected (strict). |
| `lib/__tests__/auth-gateway.test.ts` | node, mock `verifySuperAdmin` + `getSession` + `next/navigation` | ok → session `{authed,actor,method:"gateway"}` + redirect; denied → returns `{error}`, session not set. |
| `lib/__tests__/session.test.ts` | edit | `method` optional doesn't break existing assertions. |
| `lib/__tests__/env.test.ts` | edit | `gatewayEnabled` true/false; app-id default. |
| `app/login` render (optional) | jsdom | tabs render; gateway tab hidden when `gatewayEnabled=false`. Included only if it doesn't balloon scope. |

New files must be lint-clean (no `explicit-any`).

## Open risks

- The dev backend uses a self-signed cert on `:4001`; first real test may require `BACKEND_API_INSECURE_TLS=true` locally. Documented in `.env.example`.
- Revocation latency: a demoted super-admin keeps access until their session cookie expires or they log out. Accepted for v1; TTL re-validation is the noted upgrade path.
