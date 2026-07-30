# Danger Zone Env Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide the platform-migrations "Danger zone" (`migrate-reset`) by default and gate it behind `ALLOW_DANGER_OPS=true`, enforced in both the page and the API route.

**Architecture:** `CATALOG` in `lib/platform-migrations.ts` stays a full, pure data module. A new pure `visibleCatalog(allowDanger)` filters the `danger` group out; the server page calls it with `env().allowDangerOps`, and the API route rejects `danger`-group ops with 403 when the flag is off. The UI component needs no change — it already skips empty groups.

**Tech Stack:** Next.js (App Router, RSC), zod env parsing, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-30-danger-zone-env-gate-design.md`

## Global Constraints

- Per the operator's standing instructions: no failing-test-first ceremony. Each task = implement + write the spec-mandated tests together, then run the suite, typecheck, commit. Do NOT add tests beyond the ones written out below.
- Test runner is `bun run test` (Vitest) — never `bun test`.
- `bun run lint` must stay clean repo-wide.
- Flag semantics: `allowDangerOps` is `true` only for the literal string `"true"` (same pattern as `backendApiInsecureTls`).
- Route rejection for a gated op is **403** with message exactly: `Danger operations are disabled; set ALLOW_DANGER_OPS=true to enable`.
- Do not edit `components/platform-migrations.tsx`, any `.env.local`/`.env.prod`/`.env.uat`, or historical specs/plans.
- Work on branch `feature/danger-zone-env-gate` (already created; spec committed there).

---

### Task 1: `ALLOW_DANGER_OPS` env flag

**Files:**
- Modify: `lib/env.ts` (schema ~line 16, `Env` type ~line 33, `loadEnv` return ~line 52)
- Test: `lib/__tests__/env.test.ts` (append)

**Interfaces:**
- Consumes: nothing new.
- Produces: `env().allowDangerOps: boolean` on the `Env` type from `@/lib/env` — Tasks 3 and 4 rely on this exact property name.

- [ ] **Step 1: Add the flag to `lib/env.ts`**

Three edits. In the zod schema, after `PLATFORM_PACKAGE_DIR: z.string().min(1).optional(),`:

```ts
  ALLOW_DANGER_OPS: z.string().optional(),
```

In the `Env` type, after `platformPackageDir?: string;`:

```ts
  allowDangerOps: boolean;
```

In the `loadEnv` return object, after `platformPackageDir: p.PLATFORM_PACKAGE_DIR,`:

```ts
    allowDangerOps: p.ALLOW_DANGER_OPS === "true",
```

- [ ] **Step 2: Add the test to `lib/__tests__/env.test.ts`**

Append at the end of the file (mirrors the existing `insecure tls` test):

```ts
test("allowDangerOps only true for the literal string 'true'", () => {
  expect(loadEnv(base).allowDangerOps).toBe(false);
  expect(loadEnv({ ...base, ALLOW_DANGER_OPS: "true" }).allowDangerOps).toBe(true);
  expect(loadEnv({ ...base, ALLOW_DANGER_OPS: "1" }).allowDangerOps).toBe(false);
});
```

- [ ] **Step 3: Verify**

Run: `bun run test lib/__tests__/env.test.ts` → all pass. Run: `bun run typecheck` → clean.

- [ ] **Step 4: Commit**

```bash
git add lib/env.ts lib/__tests__/env.test.ts
git commit -m "feat: add ALLOW_DANGER_OPS env flag"
```

---

### Task 2: `visibleCatalog` filter

**Files:**
- Modify: `lib/platform-migrations.ts` (after `findOp`, ~line 65)
- Test: `lib/__tests__/platform-migrations.test.ts` (append; extend the import list)

**Interfaces:**
- Consumes: `CATALOG`, `CatalogOp` (already in the file).
- Produces: `visibleCatalog(allowDanger: boolean): CatalogOp[]` exported from `@/lib/platform-migrations` — Task 3's page import depends on this exact signature.

- [ ] **Step 1: Add the function to `lib/platform-migrations.ts`**

Directly below `findOp`:

```ts
export function visibleCatalog(allowDanger: boolean): CatalogOp[] {
  return allowDanger ? CATALOG : CATALOG.filter((o) => o.group !== "danger");
}
```

- [ ] **Step 2: Add the test to `lib/__tests__/platform-migrations.test.ts`**

Add `visibleCatalog` to the existing `@/lib/platform-migrations` import, then append:

```ts
test("visibleCatalog hides the danger group unless allowed", () => {
  expect(visibleCatalog(false).some((o) => o.group === "danger")).toBe(false);
  expect(visibleCatalog(false).map((o) => o.id)).not.toContain("migrate-reset");
  expect(visibleCatalog(true).map((o) => o.id)).toContain("migrate-reset");
  expect(visibleCatalog(true)).toHaveLength(CATALOG.length);
});
```

- [ ] **Step 3: Verify**

Run: `bun run test lib/__tests__/platform-migrations.test.ts` → all pass (existing tests untouched — `CATALOG` still contains `migrate-reset`).

- [ ] **Step 4: Commit**

```bash
git add lib/platform-migrations.ts lib/__tests__/platform-migrations.test.ts
git commit -m "feat: add visibleCatalog filter for the danger group"
```

---

### Task 3: Wire the page and guard the route

**Files:**
- Modify: `app/(god)/platform-migrations/page.tsx` (imports ~line 2, `scriptInfo` ~lines 15-17, prop ~line 29)
- Modify: `app/api/ops/platform-migrate/route.ts` (imports ~line 1, guard after `findOp` ~line 79)
- Modify: `lib/__tests__/platform-migrate-route.test.ts` (`beforeAll` ~line 3, destructive test ~lines 103-110, one new test)
- Create: `lib/__tests__/platform-migrate-route-danger.test.ts`

**Interfaces:**
- Consumes: `env().allowDangerOps` (Task 1), `visibleCatalog` (Task 2).
- Produces: HTTP contract — `danger`-group ops return 403 when the flag is off; page prop `catalog` no longer includes them.

- [ ] **Step 1: Filter the catalog in `app/(god)/platform-migrations/page.tsx`**

Change the lib import (line 2) and add the env import:

```tsx
import { visibleCatalog, resolveScriptInfo, type ScriptInfo } from "@/lib/platform-migrations";
import { env } from "@/lib/env";
```

Inside `PlatformMigrationsPage`, replace both `CATALOG` usages with a filtered
local (before the `scriptInfo` construction):

```tsx
  const catalog = visibleCatalog(env().allowDangerOps);
  const scriptInfo: Record<string, ScriptInfo> = Object.fromEntries(
    catalog.map((op) => [op.id, resolveScriptInfo(op, scripts)]),
  );
```

and pass `catalog={catalog}` in the JSX (was `catalog={CATALOG}`).

- [ ] **Step 2: Guard the route in `app/api/ops/platform-migrate/route.ts`**

Add the import:

```ts
import { env } from "@/lib/env";
```

Directly after `if (!op) return bad(`Unknown operation: ${opId}`, 404);` add:

```ts
  if (op.group === "danger" && !env().allowDangerOps) {
    return bad("Danger operations are disabled; set ALLOW_DANGER_OPS=true to enable", 403);
  }
```

- [ ] **Step 3: Update `lib/__tests__/platform-migrate-route.test.ts` (flag-off file)**

In `beforeAll`, after the existing `process.env` assignments add:

```ts
  delete process.env.ALLOW_DANGER_OPS;
```

Replace the whole `"destructive op requires confirmDestroy in addition to the phrase"` test (it used `migrate-reset`, now gated) with the same gate exercised via `tenant-revert`:

```ts
test("destructive op requires confirmDestroy in addition to the phrase", async () => {
  const { POST } = await import("@/app/api/ops/platform-migrate/route");
  const noFlag = await POST(req({ opId: "tenant-revert", schema: SCHEMA, confirm: SCHEMA }));
  expect(noFlag.status).toBe(400);
  const ok = await POST(req({ opId: "tenant-revert", schema: SCHEMA, confirm: SCHEMA, confirmDestroy: true }));
  expect(ok.status).toBe(200);
  await collect(ok);
});
```

Append the gate test:

```ts
test("danger op is rejected with 403 when ALLOW_DANGER_OPS is unset", async () => {
  const { POST } = await import("@/app/api/ops/platform-migrate/route");
  const res = await POST(req({ opId: "migrate-reset", schema: SCHEMA, confirm: SCHEMA, confirmDestroy: true }));
  expect(res.status).toBe(403);
  expect(runProcess).not.toHaveBeenCalled();
});
```

- [ ] **Step 4: Create `lib/__tests__/platform-migrate-route-danger.test.ts` (flag-on file)**

Vitest gives each file a fresh module registry, so setting the var in
`beforeAll` before the route is imported makes the cached `env()` singleton
see the flag on. Full file:

```ts
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";

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
```

- [ ] **Step 5: Verify**

Run: `bun run test` (full suite) → all pass. Run: `bun run typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add "app/(god)/platform-migrations/page.tsx" app/api/ops/platform-migrate/route.ts lib/__tests__/platform-migrate-route.test.ts lib/__tests__/platform-migrate-route-danger.test.ts
git commit -m "feat: gate danger-zone ops behind ALLOW_DANGER_OPS in page and API"
```

---

### Task 4: Documentation + final verification

**Files:**
- Modify: `README.md` (platform-migrations section, ~lines 27-41)
- Modify: `.env.example` (append)

**Interfaces:**
- Consumes: the flag name `ALLOW_DANGER_OPS` and its 403 behavior (Tasks 1, 3).
- Produces: operator-facing documentation only.

- [ ] **Step 1: README**

In the "Platform migrations page" section, add a bullet after the
`SYSTEM_DIRECT_URL` bullet:

```markdown
- `ALLOW_DANGER_OPS` — set to `true` to expose the danger zone
  (`db:migrate:reset`). Off by default: the group is hidden from the page and
  the API refuses the op with 403.
```

And update the closing paragraph's sentence

`Writes require typing the database name; resets need a second confirmation.`

to:

`Writes require typing the schema name; resets (hidden unless ALLOW_DANGER_OPS=true) need a second confirmation.`

- [ ] **Step 2: `.env.example`**

Append at the end of the file:

```bash
# Expose the platform-migrations danger zone (db:migrate:reset). Hidden and API-refused (403) unless true.
# ALLOW_DANGER_OPS=true
```

- [ ] **Step 3: Final verification**

Run: `bun run test` → all pass. Run: `bun run typecheck` → clean. Run: `bun run lint` → clean.

- [ ] **Step 4: Commit**

```bash
git add README.md .env.example
git commit -m "docs: document ALLOW_DANGER_OPS danger-zone gate"
```
