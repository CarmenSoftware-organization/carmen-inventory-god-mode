# Platform Migrate By Schema Name Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the operator pick the target Postgres **schema** for a platform-migration run (injected into the subprocess connection as `?schema=`), gate writes on the **schema name** instead of the database name, allow bootstrapping a new schema, and remove the redundant legacy `/migrations` page.

**Architecture:** god-mode spawns the `@repo/prisma-shared-schema-platform` package's own scripts. The package's Prisma datasource reads only the connection URL, so the chosen schema is injected by rewriting `SYSTEM_DATABASE_URL`/`SYSTEM_DIRECT_URL` to carry `?schema=<chosen>` in `buildSubprocessEnv`. Pure helpers (`withSchemaParam`, `validateSchemaName`, `canRun`) are unit-tested; a one-off direct connection pre-creates new schemas; the route re-validates everything server-side before streaming.

**Tech Stack:** Next.js 16 (app router), React client components, `postgres` lib, Vitest (`bun run test`), Playwright e2e, TypeScript.

## Global Constraints

- Dev/test server runs on port **3305** (`PORT` in env), not 3000.
- Tests run with **`bun run test`** (Vitest) — never `bun test`. `.test.ts` → node, `.int.test.ts` → embedded-postgres via `@/test/pg`.
- Route/unit tests mock `@/lib/session` (`requireAuth`) and `next/cache`. SQL via `lib/sql-guard` (`ident`/`qualified`); audit every write via `lib/audit`.
- The schema-name charset is `^[A-Za-z_][A-Za-z0-9_]*$` (first char a letter/underscore, no leading digit).
- Keep new files lint-clean; do **not** fix unrelated pre-existing repo lint.
- All work on branch `feat/platform-migrate-by-schema` (already created; spec committed at da33c94).
- Spec: `docs/superpowers/specs/2026-06-29-platform-migrate-by-schema-design.md`.

---

### Task 1: Inject the chosen schema into the subprocess connection

**Files:**
- Modify: `lib/platform-package.ts`
- Test: `lib/__tests__/platform-package.test.ts`

**Interfaces:**
- Consumes: `env()` from `@/lib/env` (`systemDatabaseUrl`, `systemDirectUrl`, `systemSchemaName`).
- Produces:
  - `withSchemaParam(url: string, schema: string): string` — returns `url` with its `schema` query param set to `schema`.
  - `buildSubprocessEnv(schema: string): NodeJS.ProcessEnv` — **signature change** (was no-arg); both URL vars now carry `?schema=<schema>`, `SYSTEM_SCHEMA_NAME = schema`.
  - `targetDbInfo(schema?: string): { host: string; database: string; schema: string; masked: string }` — **signature change**; `schema` defaults to `env().systemSchemaName`.

- [ ] **Step 1: Update the existing `buildSubprocessEnv` test and add a `withSchemaParam` test**

In `lib/__tests__/platform-package.test.ts`, **replace** the test named
`"buildSubprocessEnv injects DB vars; SYSTEM_DIRECT_URL defaults to SYSTEM_DATABASE_URL"`
with the two tests below (keep all other tests as-is):

```ts
test("withSchemaParam sets/replaces the schema query param and preserves others", async () => {
  vi.resetModules();
  const { withSchemaParam } = await import("@/lib/platform-package");
  expect(withSchemaParam("postgresql://u:p@h:6432/db", "CARMEN_SYSTEM"))
    .toBe("postgresql://u:p@h:6432/db?schema=CARMEN_SYSTEM");
  expect(withSchemaParam("postgresql://u:p@h:6432/db?schema=OLD", "NEW_ENV"))
    .toBe("postgresql://u:p@h:6432/db?schema=NEW_ENV");
  expect(withSchemaParam("postgresql://u:p@h:6432/db?sslmode=require", "S"))
    .toBe("postgresql://u:p@h:6432/db?sslmode=require&schema=S");
});

test("buildSubprocessEnv injects ?schema= into both URLs and sets SYSTEM_SCHEMA_NAME", async () => {
  vi.resetModules();
  const { buildSubprocessEnv } = await import("@/lib/platform-package");
  const e = buildSubprocessEnv("CARMEN_SYSTEM");
  expect(e.SYSTEM_DATABASE_URL).toBe(`${base.SYSTEM_DATABASE_URL}?schema=CARMEN_SYSTEM`);
  expect(e.SYSTEM_DIRECT_URL).toBe(`${base.SYSTEM_DATABASE_URL}?schema=CARMEN_SYSTEM`);
  expect(e.SYSTEM_SCHEMA_NAME).toBe("CARMEN_SYSTEM");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test platform-package`
Expected: FAIL — `withSchemaParam` is not exported; `buildSubprocessEnv("CARMEN_SYSTEM")` URLs lack `?schema=`.

- [ ] **Step 3: Implement the URL injection in `lib/platform-package.ts`**

Add `withSchemaParam`, change `buildSubprocessEnv` to take `schema`, and give `targetDbInfo` an optional `schema` arg:

```ts
export function withSchemaParam(url: string, schema: string): string {
  const u = new URL(url);
  u.searchParams.set("schema", schema);
  return u.toString();
}

export function buildSubprocessEnv(schema: string): NodeJS.ProcessEnv {
  const e = env();
  return {
    ...process.env,
    SYSTEM_DATABASE_URL: withSchemaParam(e.systemDatabaseUrl, schema),
    SYSTEM_DIRECT_URL: withSchemaParam(e.systemDirectUrl, schema),
    SYSTEM_SCHEMA_NAME: schema,
  };
}
```

And update `targetDbInfo` (only the signature + the returned `schema`):

```ts
export function targetDbInfo(schema?: string): { host: string; database: string; schema: string; masked: string } {
  const u = new URL(env().systemDatabaseUrl);
  const host = u.port ? `${u.hostname}:${u.port}` : u.hostname;
  const database = decodeURIComponent(u.pathname.replace(/^\//, ""));
  const masked = `${u.protocol}//${u.username}@${host}/${database}`;
  return { host, database, schema: schema ?? env().systemSchemaName, masked };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test platform-package`
Expected: PASS (all tests in the file, including the unchanged ones).

- [ ] **Step 5: Commit**

```bash
git add lib/platform-package.ts lib/__tests__/platform-package.test.ts
git commit -m "feat: inject chosen schema into platform-migrate subprocess URLs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Schema-name validation + schema-based run gate

**Files:**
- Modify: `lib/platform-migrations.ts`
- Test: `lib/__tests__/platform-migrations.test.ts`

**Interfaces:**
- Consumes: `CatalogOp` (existing).
- Produces:
  - `validateSchemaName(name: string, existing: string[]): "known" | "new" | "invalid"`.
  - `canRun(op, opts: { confirm: string; schema: string; knownSchemas: string[]; destroyChecked: boolean; createChecked: boolean }): boolean` — **signature change** (was `{ confirm; dbName; destroyChecked }`).

- [ ] **Step 1: Replace the `canRun` test and add a `validateSchemaName` test**

In `lib/__tests__/platform-migrations.test.ts`, add `validateSchemaName` to the
import on line 3, then **replace** the final test
(`"canRun gates writes on the DB-name phrase and destructive on the checkbox"`)
with:

```ts
test("validateSchemaName classifies known / new / invalid names", () => {
  const existing = ["CARMEN_SYSTEM", "public"];
  expect(validateSchemaName("CARMEN_SYSTEM", existing)).toBe("known");
  expect(validateSchemaName("NEW_ENV", existing)).toBe("new");
  expect(validateSchemaName("bad;name", existing)).toBe("invalid");
  expect(validateSchemaName("1leading", existing)).toBe("invalid");
  expect(validateSchemaName("", existing)).toBe("invalid");
});

test("canRun gates writes on the schema phrase, destructive checkbox, and new-schema checkbox", () => {
  const status = findOp("prisma-status")!;
  const deploy = findOp("prisma-deploy")!;
  const reset = findOp("migrate-reset")!;
  const known = ["CARMEN_SYSTEM"];
  const base = { schema: "CARMEN_SYSTEM", knownSchemas: known, destroyChecked: false, createChecked: false };

  // read-only: runs as long as the schema is a valid name
  expect(canRun(status, { ...base, confirm: "" })).toBe(true);
  expect(canRun(status, { ...base, schema: "bad;name", confirm: "" })).toBe(false);

  // write: confirm must equal the schema
  expect(canRun(deploy, { ...base, confirm: "wrong" })).toBe(false);
  expect(canRun(deploy, { ...base, confirm: "CARMEN_SYSTEM" })).toBe(true);

  // destructive: also needs the destroy checkbox
  expect(canRun(reset, { ...base, confirm: "CARMEN_SYSTEM" })).toBe(false);
  expect(canRun(reset, { ...base, confirm: "CARMEN_SYSTEM", destroyChecked: true })).toBe(true);

  // new schema on a write: needs the create checkbox
  expect(canRun(deploy, { ...base, schema: "NEW_ENV", confirm: "NEW_ENV" })).toBe(false);
  expect(canRun(deploy, { ...base, schema: "NEW_ENV", confirm: "NEW_ENV", createChecked: true })).toBe(true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test platform-migrations.test`
Expected: FAIL — `validateSchemaName` not exported; `canRun` still expects `dbName`.

- [ ] **Step 3: Implement validation + new `canRun` in `lib/platform-migrations.ts`**

Add the validator and **replace** the existing `canRun`:

```ts
export function validateSchemaName(name: string, existing: string[]): "known" | "new" | "invalid" {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return "invalid";
  return existing.includes(name) ? "known" : "new";
}

export function canRun(
  op: CatalogOp,
  opts: { confirm: string; schema: string; knownSchemas: string[]; destroyChecked: boolean; createChecked: boolean },
): boolean {
  if (validateSchemaName(opts.schema, opts.knownSchemas) === "invalid") return false;
  if (op.readonly || !op.writes) return true;
  if (opts.confirm !== opts.schema) return false;
  if (op.destructive && !opts.destroyChecked) return false;
  if (validateSchemaName(opts.schema, opts.knownSchemas) === "new" && !opts.createChecked) return false;
  return true;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test platform-migrations.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/platform-migrations.ts lib/__tests__/platform-migrations.test.ts
git commit -m "feat: schema-name validation + schema-based run gate

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Bootstrap a new schema (CREATE SCHEMA over the direct URL)

**Files:**
- Create: `lib/schema-bootstrap.ts`
- Test: `lib/__tests__/schema-bootstrap.int.test.ts`

**Interfaces:**
- Consumes: `env().systemDirectUrl`, `ident` from `@/lib/sql-guard`, `postgres`.
- Produces: `ensureSchemaExists(schema: string): Promise<void>` — idempotent `CREATE SCHEMA IF NOT EXISTS` over a one-off non-pooled connection.

- [ ] **Step 1: Write the failing integration test**

Create `lib/__tests__/schema-bootstrap.int.test.ts`:

```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import type { Pg } from "@/test/pg";
import { startPg } from "@/test/pg";

let container: Pg;
beforeAll(async () => {
  const pg = await startPg();
  container = pg.container;
  process.env.DATABASE_URL = pg.url;
  process.env.SYSTEM_DATABASE_URL = pg.url;
  process.env.SYSTEM_DIRECT_URL = pg.url;
  process.env.SYSTEM_SCHEMA_NAME = "CARMEN_SYSTEM";
  process.env.GOD_MODE_PASSWORD = "x";
  process.env.SESSION_SECRET = "x".repeat(32);
});
afterAll(async () => { await container.stop(); });

test("ensureSchemaExists creates the schema and is idempotent", async () => {
  const { ensureSchemaExists } = await import("@/lib/schema-bootstrap");
  const { getSql } = await import("@/lib/db");
  const exists = async () =>
    (await getSql().unsafe(`SELECT 1 FROM information_schema.schemata WHERE schema_name = 'NEW_ENV'`)).length;

  expect(await exists()).toBe(0);
  await ensureSchemaExists("NEW_ENV");
  expect(await exists()).toBe(1);
  await ensureSchemaExists("NEW_ENV"); // idempotent — must not throw
  expect(await exists()).toBe(1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test schema-bootstrap`
Expected: FAIL — `Cannot find module '@/lib/schema-bootstrap'`.

- [ ] **Step 3: Implement `lib/schema-bootstrap.ts`**

```ts
import postgres from "postgres";
import { env } from "@/lib/env";
import { ident } from "@/lib/sql-guard";

/** Create `schema` if it does not exist, over a one-off non-pooled connection
 *  (DDL through the pooled URL is unreliable). Idempotent. */
export async function ensureSchemaExists(schema: string): Promise<void> {
  const sql = postgres(env().systemDirectUrl, { prepare: false, max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS ${ident(schema)}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test schema-bootstrap`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/schema-bootstrap.ts lib/__tests__/schema-bootstrap.int.test.ts
git commit -m "feat: ensureSchemaExists bootstrap helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Wire the route to the chosen schema

**Files:**
- Modify: `app/api/ops/platform-migrate/route.ts`
- Test: `lib/__tests__/platform-migrate-route.test.ts` (full rewrite — confirm phrase + new mocks + new cases)

**Interfaces:**
- Consumes: `validateSchemaName` (Task 2), `buildSubprocessEnv(schema)` + `targetDbInfo(schema)` (Task 1), `ensureSchemaExists` (Task 3), `listSchemaNames` from `@/lib/introspect`.
- Produces: `POST(request)` accepting body `{ opId, schema, bu?, only?, confirm?, confirmDestroy?, confirmCreateSchema? }`.

- [ ] **Step 1: Rewrite the route test**

Replace the entire contents of `lib/__tests__/platform-migrate-route.test.ts` with:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test platform-migrate-route`
Expected: FAIL — route does not read `schema`, still confirms on the DB name, does not call `ensureSchemaExists`, audit `schemaName` is the env value.

- [ ] **Step 3: Rewrite `app/api/ops/platform-migrate/route.ts`**

```ts
import { requireAuth } from "@/lib/session";
import { streamOperation } from "@/lib/progress";
import { withTransaction } from "@/lib/db";
import { ensureAuditTable, writeAudit } from "@/lib/audit";
import { listBusinessUnits } from "@/lib/registry";
import { listSchemaNames } from "@/lib/introspect";
import { runProcess } from "@/lib/run-process";
import { ensureSchemaExists } from "@/lib/schema-bootstrap";
import {
  findOp, validateBuCode, validateOnlyPrefix, validateSchemaName, buildArgv, type CatalogOp,
} from "@/lib/platform-migrations";
import {
  assertPackageDir, assertPsql, buildSubprocessEnv, targetDbInfo, packageDir,
  listTenantFiles,
} from "@/lib/platform-package";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let running = false;

type Body = {
  opId: string; schema?: string; bu?: string; only?: string;
  confirm?: string; confirmDestroy?: boolean; confirmCreateSchema?: boolean;
};

const bad = (error: string, status: number) => Response.json({ error }, { status });

async function auditRun(
  op: CatalogOp,
  args: { bu?: string; only?: string },
  schema: string,
  code: number,
  actor: string,
): Promise<void> {
  await ensureAuditTable();
  await withTransaction(null, (tx) =>
    writeAudit(tx, {
      actor,
      schemaName: schema,
      tableName: null,
      operation: "MIGRATION",
      pk: null,
      oldValues: null,
      newValues: { opId: op.id, schema, bu: args.bu ?? null, only: args.only ?? null, exitCode: code },
      statement: `bun ${buildArgv(op, args).join(" ")}`,
    }),
  );
}

export async function POST(request: Request): Promise<Response> {
  let session: Awaited<ReturnType<typeof requireAuth>>;
  try {
    session = await requireAuth();
  } catch {
    return bad("Unauthorized", 401);
  }

  const { opId, schema, bu, only, confirm, confirmDestroy, confirmCreateSchema } =
    (await request.json()) as Body;
  const op = findOp(opId);
  if (!op) return bad(`Unknown operation: ${opId}`, 404);

  // Validate the target schema (charset always; new-schema gate only for writes).
  const schemaName = (schema ?? "").trim();
  const schemaStatus = validateSchemaName(schemaName, await listSchemaNames());
  if (schemaStatus === "invalid") return bad(`Invalid schema name: ${schemaName}`, 400);

  // Validate optional args against allow-lists.
  if (bu) {
    if (!op.acceptsBu) return bad("This operation does not accept --bu", 400);
    const active = (await listBusinessUnits()).filter((b) => b.isActive).map((b) => b.code);
    if (!validateBuCode(bu, active)) return bad(`Unknown or invalid business unit: ${bu}`, 400);
  }
  if (only) {
    if (!op.acceptsOnly) return bad("This operation does not accept --only", 400);
    if (!validateOnlyPrefix(only, await listTenantFiles())) return bad(`No tenant migration matches: ${only}`, 400);
  }

  // Confirmation gates for write operations.
  if (op.writes && !op.readonly) {
    if ((confirm ?? "") !== schemaName) return bad(`Confirmation text must equal "${schemaName}"`, 400);
    if (op.destructive && confirmDestroy !== true) {
      return bad("Destructive operations require confirmDestroy: true", 400);
    }
    if (schemaStatus === "new" && confirmCreateSchema !== true) {
      return bad("Creating a new schema requires confirmCreateSchema: true", 400);
    }
  }

  // Preflight (clear errors before streaming begins).
  try {
    await assertPackageDir();
    if (op.requiresPsql) await assertPsql();
  } catch (e) {
    return bad(e instanceof Error ? e.message : String(e), 400);
  }

  const args = buildArgv(op, { bu, only });
  const cwd = packageDir();
  const spawnEnv = buildSubprocessEnv(schemaName);
  const masked = targetDbInfo(schemaName).masked;
  const actor = session.actor ?? "god";
  const bootstrap = op.writes && !op.readonly && schemaStatus === "new";

  if (running) return bad("A platform migration is already running", 409);
  running = true;

  return streamOperation(async (onProgress) => {
    try {
      if (bootstrap) {
        onProgress({ type: "log", line: `$ CREATE SCHEMA IF NOT EXISTS "${schemaName}"  (bootstrap)`, stream: "out" });
        await ensureSchemaExists(schemaName);
      }
      onProgress({ type: "log", line: `$ bun ${args.join(" ")}  (cwd=${cwd}, target=${masked}, schema=${schemaName})`, stream: "out" });
      const { code } = await runProcess({
        command: "bun",
        args,
        cwd,
        env: spawnEnv,
        onLine: (line, stream) => onProgress({ type: "log", line, stream }),
      });
      await auditRun(op, { bu, only }, schemaName, code, actor);
      if (code !== 0) throw new Error(`${op.label} failed (exit code ${code})`);
      return { summary: `${op.label} completed (exit 0) on schema ${schemaName}` };
    } finally {
      running = false;
    }
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test platform-migrate-route`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add app/api/ops/platform-migrate/route.ts lib/__tests__/platform-migrate-route.test.ts
git commit -m "feat: platform-migrate route targets the chosen schema + bootstrap gate

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Schema selector UI + page wiring

**Files:**
- Modify: `components/platform-migrations.tsx`
- Modify: `app/(god)/platform-migrations/page.tsx`
- Modify: `e2e/platform-migrations.spec.ts`

**Interfaces:**
- Consumes: `canRun`, `validateSchemaName`, `CatalogOp`, `OpGroup` from `@/lib/platform-migrations`; `targetDbInfo`/`listSchemaNames` (server side).
- Produces: `PlatformMigrations` props gain `schemas: string[]` and `defaultSchema: string`; request body to `/api/ops/platform-migrate` gains `schema` and (when creating) `confirmCreateSchema`.

- [ ] **Step 1: Rewrite `components/platform-migrations.tsx`**

```tsx
"use client";
import { useMemo, useState } from "react";
import { useOperationStream } from "@/components/use-operation-stream";
import { OperationProgress } from "@/components/operation-progress";
import { OperationLog } from "@/components/operation-log";
import { canRun, validateSchemaName, type CatalogOp, type OpGroup } from "@/lib/platform-migrations";

export type TargetDb = { masked: string; database: string; schema: string };

const GROUPS: { key: OpGroup; title: string }[] = [
  { key: "prisma", title: "Prisma schema migrations" },
  { key: "tenant", title: "Tenant view migrations (all active BU schemas)" },
  { key: "seed", title: "Seed scripts" },
  { key: "danger", title: "Danger zone — destructive resets" },
];

export function PlatformMigrations({ target, catalog, buCodes, tenantFiles, schemas, defaultSchema }: {
  target: TargetDb; catalog: CatalogOp[]; buCodes: string[]; tenantFiles: string[];
  schemas: string[]; defaultSchema: string;
}) {
  const { state, start } = useOperationStream();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [schema, setSchema] = useState(defaultSchema);
  const [bu, setBu] = useState("");
  const [only, setOnly] = useState("");
  const [confirm, setConfirm] = useState("");
  const [destroyChecked, setDestroyChecked] = useState(false);
  const [createChecked, setCreateChecked] = useState(false);

  const op = useMemo(() => catalog.find((o) => o.id === selectedId) ?? null, [catalog, selectedId]);
  const schemaStatus = validateSchemaName(schema, schemas);
  const isNewSchema = schemaStatus === "new";
  const running = state.phase === "running";
  const enabled = !!op && !running &&
    canRun(op, { confirm, schema, knownSchemas: schemas, destroyChecked, createChecked });

  const run = () => {
    if (!op) return;
    start("/api/ops/platform-migrate", {
      opId: op.id,
      schema,
      bu: op.acceptsBu && bu ? bu : undefined,
      only: op.acceptsOnly && only ? only : undefined,
      confirm,
      confirmDestroy: op.destructive ? destroyChecked : undefined,
      confirmCreateSchema: isNewSchema ? createChecked : undefined,
    });
  };

  const select = (id: string) => {
    setSelectedId(id); setBu(""); setOnly(""); setConfirm(""); setDestroyChecked(false);
  };

  const writeOp = !!op && op.writes && !op.readonly;

  return (
    <div className="space-y-4">
      <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
        <span className="font-semibold">Target:</span> <code>{target.masked}</code>{" "}
        <span className="text-gray-600">(schema <code>{schema || "—"}</code>{isNewSchema ? ", NEW" : ""})</span>
      </div>

      <label className="block text-sm">
        Target schema
        <input
          list="schemas" aria-label="schema" className="ml-2 rounded border px-2 py-1"
          value={schema} placeholder="e.g. CARMEN_SYSTEM"
          onChange={(e) => { setSchema(e.target.value); setCreateChecked(false); }}
        />
        <datalist id="schemas">
          {schemas.map((s) => <option key={s} value={s} />)}
        </datalist>
        {schemaStatus === "invalid" && schema.length > 0 && (
          <span className="ml-2 text-red-700">invalid schema name</span>
        )}
      </label>

      {GROUPS.map((g) => {
        const ops = catalog.filter((o) => o.group === g.key);
        if (!ops.length) return null;
        const danger = g.key === "danger";
        return (
          <fieldset key={g.key} className={`rounded border p-3 ${danger ? "border-red-400 bg-red-50" : ""}`}>
            <legend className={`px-1 text-sm font-semibold ${danger ? "text-red-700" : ""}`}>{g.title}</legend>
            <div className="space-y-1">
              {ops.map((o) => (
                <label key={o.id} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="op" checked={selectedId === o.id} onChange={() => select(o.id)} />
                  <span>{o.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        );
      })}

      {op?.acceptsBu && (
        <label className="block text-sm">
          Business unit (optional)
          <select className="ml-2 rounded border px-2 py-1" value={bu} onChange={(e) => setBu(e.target.value)}>
            <option value="">all active</option>
            {buCodes.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      )}

      {op?.acceptsOnly && (
        <label className="block text-sm">
          Only file prefix (optional)
          <input
            list="tenant-files" className="ml-2 rounded border px-2 py-1"
            value={only} onChange={(e) => setOnly(e.target.value)} placeholder="e.g. 001_v_operational"
          />
          <datalist id="tenant-files">
            {tenantFiles.map((f) => <option key={f} value={f.replace(/\.up\.sql$/, "")} />)}
          </datalist>
        </label>
      )}

      {writeOp && (
        <label className="block text-sm">
          Type the schema name <code>{schema}</code> to confirm
          <input
            aria-label="confirm" className="ml-2 rounded border px-2 py-1"
            value={confirm} onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
      )}

      {writeOp && isNewSchema && (
        <label className="flex items-center gap-2 text-sm text-amber-800">
          <input type="checkbox" checked={createChecked} onChange={(e) => setCreateChecked(e.target.checked)} />
          Create new schema <code>{schema}</code>
        </label>
      )}

      {op?.destructive && (
        <label className="flex items-center gap-2 text-sm text-red-700">
          <input type="checkbox" checked={destroyChecked} onChange={(e) => setDestroyChecked(e.target.checked)} />
          I understand this destroys data
        </label>
      )}

      <button
        onClick={run} disabled={!enabled}
        className="rounded bg-black px-4 py-2 font-semibold text-white disabled:opacity-50"
      >
        {running ? "Running…" : "Run"}
      </button>

      <OperationProgress state={state} />
      <OperationLog state={state} />
    </div>
  );
}
```

- [ ] **Step 2: Wire the page to load schemas**

Replace the contents of `app/(god)/platform-migrations/page.tsx` with:

```tsx
import { PlatformMigrations } from "@/components/platform-migrations";
import { CATALOG } from "@/lib/platform-migrations";
import { listBusinessUnits } from "@/lib/registry";
import { listSchemaNames } from "@/lib/introspect";
import { listTenantFiles, targetDbInfo } from "@/lib/platform-package";

export const dynamic = "force-dynamic";

export default async function PlatformMigrationsPage() {
  const [bus, tenantFiles, schemas] = await Promise.all([
    listBusinessUnits(), listTenantFiles(), listSchemaNames(),
  ]);
  const buCodes = bus.filter((b) => b.isActive).map((b) => b.code);
  const target = targetDbInfo();
  return (
    <div>
      <h1 className="my-3 text-lg font-semibold">Platform migrations</h1>
      <p className="mb-3 text-sm text-gray-600">
        Runs migration scripts of <code>@repo/prisma-shared-schema-platform</code> against the database
        this instance manages, by spawning the package&apos;s own commands. Pick the target schema below.
        Output streams live.
      </p>
      <PlatformMigrations
        target={target} catalog={CATALOG} buCodes={buCodes} tenantFiles={tenantFiles}
        schemas={schemas} defaultSchema={target.schema}
      />
    </div>
  );
}
```

- [ ] **Step 3: Extend the e2e to assert the schema banner**

In `e2e/platform-migrations.spec.ts`, inside the existing test, **after**
`await page.goto("/platform-migrations");` add:

```ts
  // The target banner reflects the selected schema (defaults to the system schema).
  await expect(page.getByText(/schema/i).first()).toBeVisible();
```

(The read-only `prisma-status` path needs no confirm and the schema input is
pre-filled with the default, so the rest of the test is unchanged.)

- [ ] **Step 4: Typecheck and run the full unit suite**

Run: `bun run typecheck && bun run test`
Expected: typecheck clean; all unit/int tests PASS. (E2E is gated on the sibling package + live DB and is run separately/manually.)

- [ ] **Step 5: Commit**

```bash
git add components/platform-migrations.tsx app/\(god\)/platform-migrations/page.tsx e2e/platform-migrations.spec.ts
git commit -m "feat: schema selector UI + page wiring for platform migrations

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Remove the legacy `/migrations` page

**Files:**
- Delete: `app/(god)/migrations/page.tsx`
- Delete: `components/run-migrations.tsx`
- Delete: `app/api/ops/migrate/route.ts`
- Delete: `lib/migrations.ts`
- Delete: `lib/__tests__/migrations.int.test.ts`
- Delete: `lib/__tests__/migrate-route.int.test.ts`
- Modify: `app/(god)/layout.tsx` (remove the `/migrations` nav link)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing. Note `ensureAuditTable` stays in `lib/audit.ts` (used by the platform-migrate route and many int tests); only `lib/migrations.ts` (which merely re-exported it via a task) is removed.

- [ ] **Step 1: Delete the legacy files and remove the nav link**

```bash
git rm "app/(god)/migrations/page.tsx" \
       components/run-migrations.tsx \
       app/api/ops/migrate/route.ts \
       lib/migrations.ts \
       lib/__tests__/migrations.int.test.ts \
       lib/__tests__/migrate-route.int.test.ts
```

Then edit `app/(god)/layout.tsx` — delete this line:

```tsx
        <Link href="/migrations" className="text-sm text-gray-600">Migrations</Link>
```

- [ ] **Step 2: Verify no dangling references remain**

Run: `grep -rnE "lib/migrations|ops/migrate|/migrations\"|RunMigrations|runMigrations|ensureClusterDeletedAt" app lib components e2e | grep -v node_modules | grep -v platform`
Expected: **no output** (every match should be gone; `platform-migrations` is excluded and must remain).

- [ ] **Step 3: Typecheck and run the full suite**

Run: `bun run typecheck && bun run test`
Expected: typecheck clean; all tests PASS (the two deleted test files no longer run; nothing imports the removed modules).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: remove legacy in-app /migrations page

Superseded by /platform-migrations. ensureAuditTable retained in lib/audit.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Verification (after all tasks)

- [ ] `bun run typecheck` — clean.
- [ ] `bun run test` — all unit + int suites pass.
- [ ] `bun run lint` — new/changed files clean (repo-wide lint is not clean per CLAUDE.md; do not fix unrelated findings).
- [ ] Manual smoke (`bun run dev`, port 3305): open `/platform-migrations`, confirm the schema selector defaults to the system schema, the banner shows it, a read-only `prisma-status` streams; typing a non-existent schema on `prisma-deploy` reveals the "Create new schema" checkbox and the confirm field requires the schema name. `/migrations` is gone from the nav and returns 404.
- [ ] E2E (manual, needs sibling package + live DB): `node_modules/.bin/playwright test e2e/platform-migrations.spec.ts`.

## Notes for the implementer

- **TDD order matters:** Tasks 1→2→3 produce the helpers that Task 4 imports; do them in order. Task 6 is independent and can be done any time, but is listed last to keep diffs clean.
- **`URL` parses `postgresql://` URLs** — `targetDbInfo` already relies on this; `searchParams.set` URL-encodes the value (plain `CARMEN_SYSTEM` is unchanged).
- **Why a separate connection in `ensureSchemaExists`:** `getSql()` uses the pooled `DATABASE_URL`; DDL must go over the non-pooled `SYSTEM_DIRECT_URL`, hence a one-off `postgres()` client that is closed in `finally`.
- **Read-only never creates:** only write ops (`op.writes && !op.readonly`) with a `"new"` schema trigger `ensureSchemaExists`; `prisma-status` against a non-existent schema just injects `?schema=` and reports.
```
