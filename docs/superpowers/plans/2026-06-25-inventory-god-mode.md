# Carmen Inventory God Mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Next.js admin tool that lets an operator directly browse, edit, insert, and hard-delete (with runtime FK-graph cascade) any row in the multi-schema Carmen inventory PostgreSQL database, gated by a shared secret and protected by an audit log + preview/confirm safety layer.

**Architecture:** Next.js App Router. Server Components read; Server Actions perform every mutation (no client-side DB access). Data access is raw SQL via `postgres` (postgres.js) with `prepare:false` for PgBouncer; all dynamic schema/table/column identifiers pass through a validated `ident()` guard, all values bind as parameters. The catalog is introspected at runtime — the app knows no table shapes ahead of time. Destructive operations compute a blast radius, preview it, require type-to-confirm, then execute children-first inside one transaction while writing before/after audit rows atomically.

**Tech Stack:** Next.js 15 (App Router) · React 19 · TypeScript 5 · postgres ^3.4 · zod ^3 · iron-session ^8 · @tanstack/react-table ^8 · Tailwind ^3 + shadcn/ui · @uiw/react-codemirror + @codemirror/lang-sql · Vitest ^2 + @testcontainers/postgresql ^10 · Playwright (light E2E).

## Global Constraints

- **One database, many schemas.** Connect to the `postgres` database; never assume separate databases. Schema-qualify every identifier (`"schema"."table"`).
- **PgBouncer-safe:** postgres.js client MUST be created with `{ prepare: false }`.
- **Identifier safety:** every dynamic schema/table/column name MUST pass through `ident()` (from `lib/sql-guard.ts`), which validates and double-quotes. Never string-concatenate a raw identifier into SQL. Every value MUST bind as a `$n` parameter.
- **System schema name comes from `env.SYSTEM_SCHEMA_NAME`** (default `CARMEN_SYSTEM`), never hardcoded inline.
- **Registry:** tenant schema for a business unit lives in `CARMEN_SYSTEM.tb_business_unit.db_connection->>'schema'` (jsonb, nullable).
- **All mutations are transactional** and write an audit row in the same transaction. A mutation that cannot be audited must not commit.
- **No destructive tests against `dev.blueledgers.com`.** Integration tests run against a disposable Testcontainers Postgres.
- **Node 20+.** Package manager: npm.
- Confirm-phrase: plain row delete requires typing `DELETE`; a business-unit delete with the schema-drop option requires typing the exact schema name.

---

## Phase 0 — Foundation

### Task 1: Scaffold project + test runner

**Files:**
- Create: whole Next.js app via scaffolder (package.json, tsconfig.json, next.config.ts, app/, tailwind config)
- Create: `vitest.config.ts`
- Create: `app/page.tsx` (temporary redirect to `/schemas`)
- Test: `lib/__tests__/smoke.test.ts`

**Interfaces:**
- Produces: an installable, type-checking Next.js app with `npm test`, `npm run dev`, `npm run typecheck` scripts.

- [ ] **Step 1: Scaffold Next.js**

```bash
npx create-next-app@latest . --typescript --tailwind --app --eslint --src-dir=false --import-alias "@/*" --no-turbopack --use-npm --yes
```

- [ ] **Step 2: Add deps**

```bash
npm i postgres@^3.4 zod@^3 iron-session@^8 @tanstack/react-table@^8 @uiw/react-codemirror @codemirror/lang-sql
npm i -D vitest@^2 @testcontainers/postgresql@^10 @vitejs/plugin-react
```

- [ ] **Step 3: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: { environment: "node", include: ["**/*.test.ts"], testTimeout: 60_000 },
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
});
```

- [ ] **Step 4: Add scripts to `package.json`**

Ensure `scripts` contains:
```json
{ "test": "vitest run", "test:watch": "vitest", "typecheck": "tsc --noEmit", "dev": "next dev", "build": "next build" }
```

- [ ] **Step 5: Write the smoke test** — `lib/__tests__/smoke.test.ts`

```ts
import { expect, test } from "vitest";
test("test runner works", () => { expect(1 + 1).toBe(2); });
```

- [ ] **Step 6: Run it**

Run: `npm test`
Expected: 1 passed.

- [ ] **Step 7: Replace `app/page.tsx`**

```tsx
import { redirect } from "next/navigation";
export default function Home() { redirect("/schemas"); }
```

- [ ] **Step 8: Typecheck + commit**

Run: `npm run typecheck` (expect no errors)
```bash
git add -A
git commit -m "chore: scaffold Next.js app with vitest"
```

---

### Task 2: Environment config

**Files:**
- Create: `lib/env.ts`
- Create: `.env.example`
- Test: `lib/__tests__/env.test.ts`

**Interfaces:**
- Produces: `loadEnv(raw: Record<string,string|undefined>): Env` and a lazily-validated singleton `env`. `Env = { systemDatabaseUrl: string; databaseUrl: string; systemSchemaName: string; godModePassword: string; sessionSecret: string; cascadeMaxRows: number; cascadeMaxDepth: number }`.

- [ ] **Step 1: Write the failing test** — `lib/__tests__/env.test.ts`

```ts
import { expect, test } from "vitest";
import { loadEnv } from "@/lib/env";

const base = {
  SYSTEM_DATABASE_URL: "postgresql://u:p@h:6432/postgres",
  DATABASE_URL: "postgresql://u:p@h:6432/postgres",
  GOD_MODE_PASSWORD: "secret",
  SESSION_SECRET: "x".repeat(32),
};

test("parses with defaults", () => {
  const env = loadEnv(base);
  expect(env.systemSchemaName).toBe("CARMEN_SYSTEM");
  expect(env.cascadeMaxRows).toBe(5000);
  expect(env.cascadeMaxDepth).toBe(20);
});

test("throws when a required var is missing", () => {
  expect(() => loadEnv({ ...base, GOD_MODE_PASSWORD: undefined })).toThrow();
});

test("rejects a short session secret", () => {
  expect(() => loadEnv({ ...base, SESSION_SECRET: "short" })).toThrow();
});
```

- [ ] **Step 2: Run it — expect FAIL** (`Cannot find module '@/lib/env'`).

Run: `npm test -- env`

- [ ] **Step 3: Implement `lib/env.ts`**

```ts
import { z } from "zod";

const schema = z.object({
  SYSTEM_DATABASE_URL: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  SYSTEM_SCHEMA_NAME: z.string().min(1).default("CARMEN_SYSTEM"),
  GOD_MODE_PASSWORD: z.string().min(1),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be >= 32 chars"),
  CASCADE_MAX_ROWS: z.coerce.number().int().positive().default(5000),
  CASCADE_MAX_DEPTH: z.coerce.number().int().positive().default(20),
});

export type Env = {
  systemDatabaseUrl: string;
  databaseUrl: string;
  systemSchemaName: string;
  godModePassword: string;
  sessionSecret: string;
  cascadeMaxRows: number;
  cascadeMaxDepth: number;
};

export function loadEnv(raw: Record<string, string | undefined>): Env {
  const p = schema.parse(raw);
  return {
    systemDatabaseUrl: p.SYSTEM_DATABASE_URL,
    databaseUrl: p.DATABASE_URL,
    systemSchemaName: p.SYSTEM_SCHEMA_NAME,
    godModePassword: p.GOD_MODE_PASSWORD,
    sessionSecret: p.SESSION_SECRET,
    cascadeMaxRows: p.CASCADE_MAX_ROWS,
    cascadeMaxDepth: p.CASCADE_MAX_DEPTH,
  };
}

let cached: Env | null = null;
export function env(): Env {
  if (!cached) cached = loadEnv(process.env);
  return cached;
}
```

- [ ] **Step 4: Run it — expect PASS.** Run: `npm test -- env`

- [ ] **Step 5: Write `.env.example`**

```
SYSTEM_DATABASE_URL="postgresql://developer:123456@dev.blueledgers.com:6432/postgres?pgbouncer=true"
DATABASE_URL="postgresql://developer:123456@dev.blueledgers.com:6432/postgres"
SYSTEM_SCHEMA_NAME=CARMEN_SYSTEM
GOD_MODE_PASSWORD=change-me
SESSION_SECRET=change-me-to-a-long-random-string-min-32-chars
CASCADE_MAX_ROWS=5000
CASCADE_MAX_DEPTH=20
```

- [ ] **Step 6: Commit**

```bash
git add lib/env.ts lib/__tests__/env.test.ts .env.example
git commit -m "feat: typed env config with zod"
```

---

### Task 3: SQL guard (identifier quoting + statement classification)

**Files:**
- Create: `lib/sql-guard.ts`
- Test: `lib/__tests__/sql-guard.test.ts`

**Interfaces:**
- Produces:
  - `ident(name: string): string` — returns the name wrapped in double quotes with internal `"` doubled; throws `Error` if `name` is empty, > 63 bytes, or contains a NUL byte.
  - `qualified(schema: string, table: string): string` — `ident(schema) + "." + ident(table)`.
  - `classifyStatement(sqlText: string): "read" | "write"` — `read` if the first keyword (ignoring leading comments/whitespace) is `SELECT`, `WITH ... SELECT`, `EXPLAIN` (without `ANALYZE`), `SHOW`, `TABLE`; otherwise `write`.

- [ ] **Step 1: Write the failing test** — `lib/__tests__/sql-guard.test.ts`

```ts
import { expect, test } from "vitest";
import { ident, qualified, classifyStatement } from "@/lib/sql-guard";

test("ident quotes a normal name", () => {
  expect(ident("tb_user")).toBe('"tb_user"');
});

test("ident preserves case and escapes embedded quotes", () => {
  expect(ident("CARMEN_SYSTEM")).toBe('"CARMEN_SYSTEM"');
  expect(ident('we"ird')).toBe('"we""ird"');
});

test("ident rejects dangerous names", () => {
  expect(() => ident("")).toThrow();
  expect(() => ident("a".repeat(64))).toThrow();
  expect(() => ident("a\0b")).toThrow();
});

test("qualified joins schema and table", () => {
  expect(qualified("CARMEN_SYSTEM", "tb_business_unit")).toBe('"CARMEN_SYSTEM"."tb_business_unit"');
});

test("classifyStatement detects reads", () => {
  expect(classifyStatement("SELECT * FROM t")).toBe("read");
  expect(classifyStatement("  -- c\n  select 1")).toBe("read");
  expect(classifyStatement("WITH x AS (SELECT 1) SELECT * FROM x")).toBe("read");
  expect(classifyStatement("EXPLAIN SELECT 1")).toBe("read");
});

test("classifyStatement detects writes", () => {
  expect(classifyStatement("UPDATE t SET a=1")).toBe("write");
  expect(classifyStatement("DELETE FROM t")).toBe("write");
  expect(classifyStatement("DROP TABLE t")).toBe("write");
  expect(classifyStatement("EXPLAIN ANALYZE DELETE FROM t")).toBe("write");
  expect(classifyStatement("WITH x AS (DELETE FROM t RETURNING *) SELECT * FROM x")).toBe("write");
});
```

- [ ] **Step 2: Run it — expect FAIL.** Run: `npm test -- sql-guard`

- [ ] **Step 3: Implement `lib/sql-guard.ts`**

```ts
export function ident(name: string): string {
  if (typeof name !== "string" || name.length === 0) throw new Error("Invalid identifier: empty");
  if (Buffer.byteLength(name, "utf8") > 63) throw new Error(`Invalid identifier: too long (${name})`);
  if (name.includes("\0")) throw new Error("Invalid identifier: NUL byte");
  return '"' + name.replace(/"/g, '""') + '"';
}

export function qualified(schema: string, table: string): string {
  return `${ident(schema)}.${ident(table)}`;
}

function stripLeading(sqlText: string): string {
  let s = sqlText.trim();
  // strip leading line and block comments repeatedly
  while (true) {
    if (s.startsWith("--")) { const nl = s.indexOf("\n"); s = nl === -1 ? "" : s.slice(nl + 1).trimStart(); continue; }
    if (s.startsWith("/*")) { const end = s.indexOf("*/"); s = end === -1 ? "" : s.slice(end + 2).trimStart(); continue; }
    break;
  }
  return s;
}

export function classifyStatement(sqlText: string): "read" | "write" {
  const s = stripLeading(sqlText).toUpperCase();
  if (/^EXPLAIN\s+ANALYZE/.test(s)) return "write";
  if (/^(SELECT|EXPLAIN|SHOW|TABLE|VALUES)\b/.test(s)) return "read";
  if (/^WITH\b/.test(s)) {
    // A CTE chain is a write iff it contains a data-modifying statement.
    return /\b(INSERT|UPDATE|DELETE|MERGE)\b/.test(s) ? "write" : "read";
  }
  return "write";
}
```

- [ ] **Step 4: Run it — expect PASS.** Run: `npm test -- sql-guard`

- [ ] **Step 5: Commit**

```bash
git add lib/sql-guard.ts lib/__tests__/sql-guard.test.ts
git commit -m "feat: identifier guard and statement classifier"
```

---

### Task 4: Database client + transaction helper

**Files:**
- Create: `lib/db.ts`
- Test: `lib/__tests__/db.int.test.ts` (integration — Testcontainers)
- Create: `test/pg.ts` (shared Testcontainers helper)

**Interfaces:**
- Consumes: `ident`, `qualified` (Task 3); `env` (Task 2).
- Produces:
  - `getSql(): Sql` — singleton postgres.js client (`prepare:false`), connecting to `env().databaseUrl`.
  - `withTransaction<T>(schema: string | null, fn: (tx: TransactionSql) => Promise<T>): Promise<T>` — runs `fn` inside `sql.begin`; if `schema` is non-null, first runs `SET LOCAL search_path TO <ident(schema)>`. Rolls back on throw.
  - Re-exports `ident`, `qualified` for convenience.
- `Sql` / `TransactionSql` are the postgres.js types (`import postgres from "postgres"`).

- [ ] **Step 1: Write the Testcontainers helper** — `test/pg.ts`

```ts
import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres from "postgres";

export async function startPg(): Promise<{ container: StartedPostgreSqlContainer; url: string }> {
  const container = await new PostgreSqlContainer("postgres:16-alpine").start();
  return { container, url: container.getConnectionUri() };
}

export function client(url: string) {
  return postgres(url, { prepare: false, onnotice: () => {} });
}
```

- [ ] **Step 2: Write the failing integration test** — `lib/__tests__/db.int.test.ts`

```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { startPg } from "@/test/pg";

let container: StartedPostgreSqlContainer;

beforeAll(async () => {
  const pg = await startPg();
  container = pg.container;
  process.env.DATABASE_URL = pg.url;
  process.env.SYSTEM_DATABASE_URL = pg.url;
  process.env.GOD_MODE_PASSWORD = "x";
  process.env.SESSION_SECRET = "x".repeat(32);
});
afterAll(async () => { await container.stop(); });

test("withTransaction commits and rolls back", async () => {
  const { getSql, withTransaction } = await import("@/lib/db");
  const sql = getSql();
  await sql.unsafe(`CREATE SCHEMA s; CREATE TABLE s.t (id int primary key)`);

  await withTransaction("s", async (tx) => { await tx.unsafe(`INSERT INTO t (id) VALUES (1)`); });
  const ok = await sql.unsafe(`SELECT count(*)::int AS n FROM s.t`);
  expect(ok[0].n).toBe(1);

  await expect(withTransaction("s", async (tx) => {
    await tx.unsafe(`INSERT INTO t (id) VALUES (2)`);
    throw new Error("boom");
  })).rejects.toThrow("boom");
  const after = await sql.unsafe(`SELECT count(*)::int AS n FROM s.t`);
  expect(after[0].n).toBe(1);
});
```

- [ ] **Step 3: Run it — expect FAIL** (`Cannot find module '@/lib/db'`).

Run: `npm test -- db.int`

- [ ] **Step 4: Implement `lib/db.ts`**

```ts
import postgres, { type Sql, type TransactionSql } from "postgres";
import { env } from "@/lib/env";
import { ident, qualified } from "@/lib/sql-guard";

let sql: Sql | null = null;
export function getSql(): Sql {
  if (!sql) sql = postgres(env().databaseUrl, { prepare: false, max: 10, onnotice: () => {} });
  return sql;
}

export async function withTransaction<T>(
  schema: string | null,
  fn: (tx: TransactionSql) => Promise<T>,
): Promise<T> {
  return getSql().begin(async (tx) => {
    if (schema) await tx.unsafe(`SET LOCAL search_path TO ${ident(schema)}`);
    return fn(tx as TransactionSql);
  }) as Promise<T>;
}

export { ident, qualified };
```

- [ ] **Step 5: Run it — expect PASS.** Run: `npm test -- db.int`

- [ ] **Step 6: Commit**

```bash
git add lib/db.ts lib/__tests__/db.int.test.ts test/pg.ts
git commit -m "feat: postgres.js client and transaction helper"
```

---

### Task 5: Auth — session, login, middleware

**Files:**
- Create: `lib/session.ts`, `server/auth.ts`, `app/login/page.tsx`, `middleware.ts`
- Test: `lib/__tests__/session.test.ts`

**Interfaces:**
- Consumes: `env` (Task 2).
- Produces:
  - `lib/session.ts`: `sessionOptions` (iron-session config), `SessionData = { authed: boolean; actor?: string }`, `getSession(): Promise<IronSession<SessionData>>` (uses `cookies()`), and `verifyPassword(input: string): boolean` (constant-time compare to `env().godModePassword`).
  - `server/auth.ts`: `login(formData: FormData): Promise<void>` (server action; sets `authed`, redirects to `/schemas`; throws on wrong secret), `logout(): Promise<void>`.

- [ ] **Step 1: Write the failing test** — `lib/__tests__/session.test.ts`

```ts
import { expect, test, beforeAll } from "vitest";
beforeAll(() => {
  process.env.GOD_MODE_PASSWORD = "hunter2";
  process.env.SESSION_SECRET = "x".repeat(32);
  process.env.DATABASE_URL = "postgresql://u:p@h:6432/postgres";
  process.env.SYSTEM_DATABASE_URL = "postgresql://u:p@h:6432/postgres";
});

test("verifyPassword is correct and length-safe", async () => {
  const { verifyPassword } = await import("@/lib/session");
  expect(verifyPassword("hunter2")).toBe(true);
  expect(verifyPassword("wrong")).toBe(false);
  expect(verifyPassword("")).toBe(false);
});
```

- [ ] **Step 2: Run it — expect FAIL.** Run: `npm test -- session`

- [ ] **Step 3: Implement `lib/session.ts`**

```ts
import { cookies } from "next/headers";
import { getIronSession, type IronSession, type SessionOptions } from "iron-session";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

export type SessionData = { authed: boolean; actor?: string };

export const sessionOptions: SessionOptions = {
  password: env().sessionSecret,
  cookieName: "godmode_session",
  cookieOptions: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" },
};

export async function getSession(): Promise<IronSession<SessionData>> {
  return getIronSession<SessionData>(await cookies(), sessionOptions);
}

export function verifyPassword(input: string): boolean {
  const a = Buffer.from(input ?? "", "utf8");
  const b = Buffer.from(env().godModePassword, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Run it — expect PASS.** Run: `npm test -- session`

- [ ] **Step 5: Implement `server/auth.ts`**

```ts
"use server";
import { redirect } from "next/navigation";
import { getSession, verifyPassword } from "@/lib/session";

export async function login(formData: FormData): Promise<void> {
  const secret = String(formData.get("secret") ?? "");
  const actor = String(formData.get("actor") ?? "god").slice(0, 64) || "god";
  if (!verifyPassword(secret)) throw new Error("Invalid secret");
  const session = await getSession();
  session.authed = true;
  session.actor = actor;
  await session.save();
  redirect("/schemas");
}

export async function logout(): Promise<void> {
  const session = await getSession();
  session.destroy();
  redirect("/login");
}
```

- [ ] **Step 6: Implement `app/login/page.tsx`**

```tsx
import { login } from "@/server/auth";

export default function LoginPage() {
  return (
    <main className="mx-auto mt-24 max-w-sm space-y-4 p-6">
      <h1 className="text-xl font-semibold">God Mode</h1>
      <form action={login} className="space-y-3">
        <input name="actor" placeholder="Your name (for audit)" className="w-full rounded border p-2" />
        <input name="secret" type="password" placeholder="Shared secret" required className="w-full rounded border p-2" />
        <button type="submit" className="w-full rounded bg-black p-2 text-white">Enter</button>
      </form>
    </main>
  );
}
```

- [ ] **Step 7: Implement `middleware.ts`** (guards everything except `/login` and Next internals)

```ts
import { NextResponse, type NextRequest } from "next/server";
import { getIronSession } from "iron-session";
import { sessionOptions, type SessionData } from "@/lib/session";

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const session = await getIronSession<SessionData>(req, res, sessionOptions);
  if (!session.authed) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return res;
}

export const config = { matcher: ["/((?!login|_next/static|_next/image|favicon.ico).*)"] };
```

- [ ] **Step 8: Typecheck + commit**

Run: `npm run typecheck`
```bash
git add lib/session.ts server/auth.ts app/login/page.tsx middleware.ts lib/__tests__/session.test.ts
git commit -m "feat: shared-secret auth with iron-session and route guard"
```

---

## Phase 1 — Introspection

### Task 6: Catalog introspection

**Files:**
- Create: `lib/introspect.ts`
- Test: `lib/__tests__/introspect.int.test.ts`

**Interfaces:**
- Consumes: `getSql` (Task 4), `ident`/`qualified` (Task 3).
- Produces (all read-only):
  - Types:
    ```ts
    export type ColumnInfo = { name: string; dataType: string; udtName: string; isNullable: boolean; default: string | null; isPrimaryKey: boolean };
    export type TableInfo = { schema: string; name: string; estimatedRows: number };
    export type OnDelete = "NO ACTION" | "RESTRICT" | "CASCADE" | "SET NULL" | "SET DEFAULT";
    export type ForeignKey = { childSchema: string; childTable: string; childColumns: string[]; parentSchema: string; parentTable: string; parentColumns: string[]; onDelete: OnDelete };
    export type TableShape = { columns: ColumnInfo[]; primaryKey: string[] };
    ```
  - `listSchemaNames(): Promise<string[]>` — all non-system schemas straight from `pg_namespace` (excludes `pg_*`, `information_schema`), sorted.
  - `listTables(schema: string): Promise<TableInfo[]>`
  - `describeTable(schema: string, table: string): Promise<TableShape>`
  - `listForeignKeys(schema: string): Promise<ForeignKey[]>` — FKs where child **or** parent is in `schema`.

- [ ] **Step 1: Write the failing integration test** — `lib/__tests__/introspect.int.test.ts`

```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { startPg } from "@/test/pg";

let container: StartedPostgreSqlContainer;
beforeAll(async () => {
  const pg = await startPg();
  container = pg.container;
  process.env.DATABASE_URL = pg.url;
  process.env.SYSTEM_DATABASE_URL = pg.url;
  process.env.GOD_MODE_PASSWORD = "x";
  process.env.SESSION_SECRET = "x".repeat(32);
  const { getSql } = await import("@/lib/db");
  await getSql().unsafe(`
    CREATE SCHEMA app;
    CREATE TABLE app.parent (id int primary key, name text not null);
    CREATE TABLE app.child (id int primary key, parent_id int references app.parent(id), note text);
  `);
});
afterAll(async () => { await container.stop(); });

test("listTables returns tables in schema", async () => {
  const { listTables } = await import("@/lib/introspect");
  const names = (await listTables("app")).map((t) => t.name).sort();
  expect(names).toEqual(["child", "parent"]);
});

test("describeTable returns columns + pk", async () => {
  const { describeTable } = await import("@/lib/introspect");
  const shape = await describeTable("app", "parent");
  expect(shape.primaryKey).toEqual(["id"]);
  const name = shape.columns.find((c) => c.name === "name")!;
  expect(name.isNullable).toBe(false);
});

test("listForeignKeys finds the child->parent fk", async () => {
  const { listForeignKeys } = await import("@/lib/introspect");
  const fks = await listForeignKeys("app");
  expect(fks).toHaveLength(1);
  expect(fks[0].childTable).toBe("child");
  expect(fks[0].parentTable).toBe("parent");
  expect(fks[0].childColumns).toEqual(["parent_id"]);
  expect(fks[0].onDelete).toBe("NO ACTION");
});
```

- [ ] **Step 2: Run it — expect FAIL.** Run: `npm test -- introspect`

- [ ] **Step 3: Implement `lib/introspect.ts`**

```ts
import { getSql } from "@/lib/db";
import { qualified } from "@/lib/sql-guard";

export type ColumnInfo = { name: string; dataType: string; udtName: string; isNullable: boolean; default: string | null; isPrimaryKey: boolean };
export type TableInfo = { schema: string; name: string; estimatedRows: number };
export type OnDelete = "NO ACTION" | "RESTRICT" | "CASCADE" | "SET NULL" | "SET DEFAULT";
export type ForeignKey = { childSchema: string; childTable: string; childColumns: string[]; parentSchema: string; parentTable: string; parentColumns: string[]; onDelete: OnDelete };
export type TableShape = { columns: ColumnInfo[]; primaryKey: string[] };

const ON_DELETE: Record<string, OnDelete> = { a: "NO ACTION", r: "RESTRICT", c: "CASCADE", n: "SET NULL", d: "SET DEFAULT" };

export async function listSchemaNames(): Promise<string[]> {
  const rows = await getSql().unsafe(
    `SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema' ORDER BY nspname`,
  );
  return rows.map((r: any) => r.nspname as string);
}

export async function listTables(schema: string): Promise<TableInfo[]> {
  const rows = await getSql().unsafe(
    `SELECT c.relname AS name, GREATEST(c.reltuples, 0)::bigint AS estimated_rows
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = $1 AND c.relkind = 'r' ORDER BY c.relname`,
    [schema],
  );
  return rows.map((r: any) => ({ schema, name: r.name, estimatedRows: Number(r.estimated_rows) }));
}

export async function describeTable(schema: string, table: string): Promise<TableShape> {
  const reg = qualified(schema, table);
  const cols = await getSql().unsafe(
    `SELECT a.attname AS name,
            format_type(a.atttypid, a.atttypmod) AS data_type,
            t.typname AS udt_name,
            NOT a.attnotnull AS is_nullable,
            pg_get_expr(d.adbin, d.adrelid) AS "default",
            COALESCE(pk.is_pk, false) AS is_primary_key
     FROM pg_attribute a
     JOIN pg_type t ON t.oid = a.atttypid
     LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     LEFT JOIN (
       SELECT a2.attname, true AS is_pk
       FROM pg_index i JOIN pg_attribute a2 ON a2.attrelid = i.indrelid AND a2.attnum = ANY(i.indkey)
       WHERE i.indrelid = $1::regclass AND i.indisprimary
     ) pk ON pk.attname = a.attname
     WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY a.attnum`,
    [reg],
  );
  const columns: ColumnInfo[] = cols.map((c: any) => ({
    name: c.name, dataType: c.data_type, udtName: c.udt_name,
    isNullable: c.is_nullable, default: c.default ?? null, isPrimaryKey: c.is_primary_key,
  }));
  const pkRows = await getSql().unsafe(
    `SELECT a.attname FROM pg_index i
     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
     WHERE i.indrelid = $1::regclass AND i.indisprimary
     ORDER BY array_position(i.indkey, a.attnum)`,
    [reg],
  );
  return { columns, primaryKey: pkRows.map((r: any) => r.attname as string) };
}

export async function listForeignKeys(schema: string): Promise<ForeignKey[]> {
  const rows = await getSql().unsafe(
    `SELECT nc.nspname AS child_schema, child.relname AS child_table,
            array_agg(ac.attname ORDER BY k.ord) AS child_columns,
            np.nspname AS parent_schema, parent.relname AS parent_table,
            array_agg(ap.attname ORDER BY k.ord) AS parent_columns,
            con.confdeltype AS on_delete
     FROM pg_constraint con
     JOIN pg_class child ON child.oid = con.conrelid
     JOIN pg_namespace nc ON nc.oid = child.relnamespace
     JOIN pg_class parent ON parent.oid = con.confrelid
     JOIN pg_namespace np ON np.oid = parent.relnamespace
     JOIN LATERAL unnest(con.conkey, con.confkey) WITH ORDINALITY AS k(child_attnum, parent_attnum, ord) ON true
     JOIN pg_attribute ac ON ac.attrelid = con.conrelid AND ac.attnum = k.child_attnum
     JOIN pg_attribute ap ON ap.attrelid = con.confrelid AND ap.attnum = k.parent_attnum
     WHERE con.contype = 'f' AND ($1 IN (nc.nspname, np.nspname))
     GROUP BY nc.nspname, child.relname, np.nspname, parent.relname, con.oid, con.confdeltype`,
    [schema],
  );
  return rows.map((r: any) => ({
    childSchema: r.child_schema, childTable: r.child_table, childColumns: r.child_columns,
    parentSchema: r.parent_schema, parentTable: r.parent_table, parentColumns: r.parent_columns,
    onDelete: ON_DELETE[r.on_delete] ?? "NO ACTION",
  }));
}
```

- [ ] **Step 4: Run it — expect PASS.** Run: `npm test -- introspect`

- [ ] **Step 5: Commit**

```bash
git add lib/introspect.ts lib/__tests__/introspect.int.test.ts
git commit -m "feat: runtime catalog introspection (schemas, tables, columns, fks)"
```

---

### Task 7: Registry resolver

**Files:**
- Create: `lib/registry.ts`
- Test: `lib/__tests__/registry.int.test.ts`

**Interfaces:**
- Consumes: `getSql` (Task 4), `env` (Task 2), `qualified` (Task 3), `listSchemaNames` (Task 6).
- Produces:
  - `export type BusinessUnit = { id: string; code: string; name: string; clusterId: string | null; isActive: boolean; tenantSchema: string | null }`.
  - `listBusinessUnits(): Promise<BusinessUnit[]>` — reads `<SYSTEM_SCHEMA_NAME>.tb_business_unit`, extracting `db_connection->>'schema'` as `tenantSchema`. Returns `[]` (not throw) if the table is absent.
  - `resolveTenantSchema(businessUnitId: string): Promise<string | null>`.
  - `listSelectableSchemas(): Promise<{ system: string; tenantSchemas: string[]; allSchemas: string[] }>` — convenience for the home screen.

- [ ] **Step 1: Write the failing integration test** — `lib/__tests__/registry.int.test.ts`

```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { startPg } from "@/test/pg";

let container: StartedPostgreSqlContainer;
beforeAll(async () => {
  const pg = await startPg();
  container = pg.container;
  process.env.DATABASE_URL = pg.url;
  process.env.SYSTEM_DATABASE_URL = pg.url;
  process.env.SYSTEM_SCHEMA_NAME = "CARMEN_SYSTEM";
  process.env.GOD_MODE_PASSWORD = "x";
  process.env.SESSION_SECRET = "x".repeat(32);
  const { getSql } = await import("@/lib/db");
  await getSql().unsafe(`
    CREATE SCHEMA "CARMEN_SYSTEM";
    CREATE TABLE "CARMEN_SYSTEM".tb_business_unit (
      id uuid primary key default gen_random_uuid(),
      cluster_id uuid, code text not null, name text not null,
      is_active boolean default true, db_connection jsonb
    );
    INSERT INTO "CARMEN_SYSTEM".tb_business_unit (code, name, db_connection) VALUES
      ('BLFIFO','Blueledgers (FIFO)', '{"schema":"BL_FIFO"}'::jsonb),
      ('NOSCHEMA','No Schema BU', NULL);
  `);
});
afterAll(async () => { await container.stop(); });

test("listBusinessUnits resolves tenant schema from jsonb", async () => {
  const { listBusinessUnits } = await import("@/lib/registry");
  const bus = await listBusinessUnits();
  const fifo = bus.find((b) => b.code === "BLFIFO")!;
  const none = bus.find((b) => b.code === "NOSCHEMA")!;
  expect(fifo.tenantSchema).toBe("BL_FIFO");
  expect(none.tenantSchema).toBeNull();
});
```

- [ ] **Step 2: Run it — expect FAIL.** Run: `npm test -- registry`

- [ ] **Step 3: Implement `lib/registry.ts`**

```ts
import { getSql } from "@/lib/db";
import { env } from "@/lib/env";
import { qualified } from "@/lib/sql-guard";
import { listSchemaNames } from "@/lib/introspect";

export type BusinessUnit = { id: string; code: string; name: string; clusterId: string | null; isActive: boolean; tenantSchema: string | null };

export async function listBusinessUnits(): Promise<BusinessUnit[]> {
  const reg = qualified(env().systemSchemaName, "tb_business_unit");
  try {
    const rows = await getSql().unsafe(
      `SELECT id::text, cluster_id::text AS cluster_id, code, name,
              COALESCE(is_active, true) AS is_active,
              db_connection->>'schema' AS tenant_schema
       FROM ${reg} ORDER BY code`,
    );
    return rows.map((r: any) => ({
      id: r.id, code: r.code, name: r.name, clusterId: r.cluster_id ?? null,
      isActive: r.is_active, tenantSchema: r.tenant_schema ?? null,
    }));
  } catch {
    return [];
  }
}

export async function resolveTenantSchema(businessUnitId: string): Promise<string | null> {
  const reg = qualified(env().systemSchemaName, "tb_business_unit");
  const rows = await getSql().unsafe(
    `SELECT db_connection->>'schema' AS tenant_schema FROM ${reg} WHERE id = $1::uuid`,
    [businessUnitId],
  );
  return rows[0]?.tenant_schema ?? null;
}

export async function listSelectableSchemas() {
  const system = env().systemSchemaName;
  const bus = await listBusinessUnits();
  const tenantSchemas = [...new Set(bus.map((b) => b.tenantSchema).filter((s): s is string => !!s))].sort();
  const allSchemas = await listSchemaNames();
  return { system, tenantSchemas, allSchemas };
}
```

- [ ] **Step 4: Run it — expect PASS.** Run: `npm test -- registry`

- [ ] **Step 5: Commit**

```bash
git add lib/registry.ts lib/__tests__/registry.int.test.ts
git commit -m "feat: business-unit registry resolver"
```

---

## Phase 2 — Read UI (registry home → tables → grid)

### Task 8: Schema banner + app shell

**Files:**
- Create: `components/schema-banner.tsx`, `app/(god)/layout.tsx`
- Test: `components/__tests__/schema-banner.test.tsx` (uses jsdom)

**Interfaces:**
- Consumes: `env` (Task 2).
- Produces: `SchemaBanner({ schema }: { schema: string | null })` — renders a colored bar; red with "SYSTEM" text when `schema === env().systemSchemaName`, amber otherwise; neutral when null. The `(god)` layout wraps protected pages and shows a logout button.

- [ ] **Step 1: Add jsdom + react testing**

```bash
npm i -D jsdom @testing-library/react @testing-library/jest-dom
```
Add to `vitest.config.ts` test block: `environmentMatchGlobs: [["**/*.test.tsx", "jsdom"]]`.

- [ ] **Step 2: Write the failing test** — `components/__tests__/schema-banner.test.tsx`

```tsx
import { render, screen } from "@testing-library/react";
import { expect, test, beforeAll } from "vitest";
beforeAll(() => {
  process.env.SYSTEM_SCHEMA_NAME = "CARMEN_SYSTEM";
  process.env.DATABASE_URL = "postgresql://u:p@h:6432/postgres";
  process.env.SYSTEM_DATABASE_URL = "postgresql://u:p@h:6432/postgres";
  process.env.GOD_MODE_PASSWORD = "x";
  process.env.SESSION_SECRET = "x".repeat(32);
});

test("system schema shows SYSTEM warning", async () => {
  const { SchemaBanner } = await import("@/components/schema-banner");
  render(<SchemaBanner schema="CARMEN_SYSTEM" />);
  expect(screen.getByText(/SYSTEM/)).toBeDefined();
});

test("tenant schema shows its name", async () => {
  const { SchemaBanner } = await import("@/components/schema-banner");
  render(<SchemaBanner schema="BL_FIFO" />);
  expect(screen.getByText(/BL_FIFO/)).toBeDefined();
});
```

- [ ] **Step 3: Run it — expect FAIL.** Run: `npm test -- schema-banner`

- [ ] **Step 4: Implement `components/schema-banner.tsx`**

```tsx
import { env } from "@/lib/env";

export function SchemaBanner({ schema }: { schema: string | null }) {
  if (!schema) return null;
  const isSystem = schema === env().systemSchemaName;
  const cls = isSystem ? "bg-red-600 text-white" : "bg-amber-500 text-black";
  return (
    <div className={`flex items-center gap-2 px-4 py-1 text-sm font-semibold ${cls}`}>
      <span className="rounded bg-black/20 px-2 py-0.5">{isSystem ? "SYSTEM" : "TENANT"}</span>
      <span>Operating in: {schema}</span>
      <span className="ml-auto opacity-80">GOD MODE — changes are permanent</span>
    </div>
  );
}
```

- [ ] **Step 5: Run it — expect PASS.** Run: `npm test -- schema-banner`

- [ ] **Step 6: Implement `app/(god)/layout.tsx`**

```tsx
import Link from "next/link";
import { logout } from "@/server/auth";

export default function GodLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <header className="flex items-center gap-4 border-b px-4 py-2">
        <Link href="/schemas" className="font-semibold">Carmen God Mode</Link>
        <Link href="/audit" className="text-sm text-gray-600">Audit log</Link>
        <form action={logout} className="ml-auto">
          <button className="text-sm text-gray-600">Log out</button>
        </form>
      </header>
      <main className="p-4">{children}</main>
    </div>
  );
}
```

- [ ] **Step 7: Typecheck + commit**

```bash
git add components/schema-banner.tsx app/\(god\)/layout.tsx components/__tests__/schema-banner.test.tsx vitest.config.ts
git commit -m "feat: schema banner and protected app shell"
```

---

### Task 9: Registry home page (`/schemas`)

**Files:**
- Create: `app/(god)/schemas/page.tsx`

**Interfaces:**
- Consumes: `listBusinessUnits`, `listSelectableSchemas` (Task 7).
- Produces: a server-component page listing business units (code, name, active, resolved tenant schema or "no schema" badge) each linking to `/<tenantSchema>/tables`, plus a "Manage SYSTEM schema" link to `/<SYSTEM_SCHEMA_NAME>/tables`, and a raw list of all other schemas.

- [ ] **Step 1: Implement `app/(god)/schemas/page.tsx`**

```tsx
import Link from "next/link";
import { listBusinessUnits, listSelectableSchemas } from "@/lib/registry";

export const dynamic = "force-dynamic";

export default async function SchemasPage() {
  const [bus, sel] = await Promise.all([listBusinessUnits(), listSelectableSchemas()]);
  return (
    <div className="space-y-6">
      <section>
        <h1 className="mb-2 text-lg font-semibold">System</h1>
        <Link href={`/${encodeURIComponent(sel.system)}/tables`} className="inline-block rounded border border-red-300 bg-red-50 px-3 py-2 text-red-800">
          Manage {sel.system} (registry, users, business units)
        </Link>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Business Units</h2>
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left"><th>Code</th><th>Name</th><th>Active</th><th>Tenant schema</th><th></th></tr></thead>
          <tbody>
            {bus.map((b) => (
              <tr key={b.id} className="border-b">
                <td className="py-1 font-mono">{b.code}</td>
                <td>{b.name}</td>
                <td>{b.isActive ? "yes" : "no"}</td>
                <td>{b.tenantSchema ?? <span className="rounded bg-gray-200 px-2 text-xs">no schema</span>}</td>
                <td className="text-right">
                  {b.tenantSchema && <Link href={`/${encodeURIComponent(b.tenantSchema)}/tables`} className="text-blue-600">open →</Link>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">All schemas</h2>
        <ul className="flex flex-wrap gap-2">
          {sel.allSchemas.map((s) => (
            <li key={s}><Link href={`/${encodeURIComponent(s)}/tables`} className="rounded border px-2 py-1 text-sm">{s}</Link></li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Manual check + commit**

Run: `npm run dev`, log in, visit `/schemas`. (With no live DB it returns empty lists — acceptable; integration covered by Task 7.)
```bash
git add app/\(god\)/schemas/page.tsx
git commit -m "feat: registry home page"
```

---

### Task 10: Table list page (`/[schema]/tables`)

**Files:**
- Create: `app/(god)/[schema]/tables/page.tsx`

**Interfaces:**
- Consumes: `listTables` (Task 6), `SchemaBanner` (Task 8).
- Produces: page listing tables in the schema with estimated row counts, each linking to `/<schema>/<table>`.

- [ ] **Step 1: Implement `app/(god)/[schema]/tables/page.tsx`**

```tsx
import Link from "next/link";
import { listTables } from "@/lib/introspect";
import { SchemaBanner } from "@/components/schema-banner";

export const dynamic = "force-dynamic";

export default async function TablesPage({ params }: { params: Promise<{ schema: string }> }) {
  const { schema } = await params;
  const tables = await listTables(schema);
  return (
    <div>
      <SchemaBanner schema={schema} />
      <h1 className="my-3 text-lg font-semibold">Tables in {schema}</h1>
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left"><th>Table</th><th className="text-right">~rows</th></tr></thead>
        <tbody>
          {tables.map((t) => (
            <tr key={t.name} className="border-b">
              <td className="py-1"><Link href={`/${encodeURIComponent(schema)}/${encodeURIComponent(t.name)}`} className="text-blue-600 font-mono">{t.name}</Link></td>
              <td className="text-right tabular-nums">{t.estimatedRows.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/\(god\)/\[schema\]/tables/page.tsx
git commit -m "feat: table list page"
```

---

### Task 11: Row reader + generic grid (`/[schema]/[table]`)

**Files:**
- Create: `lib/rows.ts`, `app/(god)/[schema]/[table]/page.tsx`, `components/row-grid.tsx`
- Test: `lib/__tests__/rows.int.test.ts`

**Interfaces:**
- Consumes: `getSql` (Task 4), `describeTable` (Task 6), `ident`/`qualified` (Task 3).
- Produces in `lib/rows.ts`:
  - `export type RowPage = { columns: import("@/lib/introspect").ColumnInfo[]; primaryKey: string[]; rows: Record<string, unknown>[]; nextCursor: string | null }`.
  - `readRows(schema: string, table: string, opts?: { limit?: number; cursor?: string | null }): Promise<RowPage>` — keyset pagination ordered by primary key (falls back to `ctid` ordering and marks the table read-only when there is no PK). `cursor` encodes the last row's PK values (base64 JSON).
  - `rowPk(row: Record<string, unknown>, primaryKey: string[]): Record<string, unknown>` — extracts just the PK columns.

- [ ] **Step 1: Write the failing integration test** — `lib/__tests__/rows.int.test.ts`

```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { startPg } from "@/test/pg";

let container: StartedPostgreSqlContainer;
beforeAll(async () => {
  const pg = await startPg();
  container = pg.container;
  process.env.DATABASE_URL = pg.url;
  process.env.SYSTEM_DATABASE_URL = pg.url;
  process.env.GOD_MODE_PASSWORD = "x";
  process.env.SESSION_SECRET = "x".repeat(32);
  const { getSql } = await import("@/lib/db");
  await getSql().unsafe(`
    CREATE SCHEMA app;
    CREATE TABLE app.item (id int primary key, name text);
    INSERT INTO app.item SELECT g, 'n'||g FROM generate_series(1,5) g;
  `);
});
afterAll(async () => { await container.stop(); });

test("readRows paginates by pk", async () => {
  const { readRows } = await import("@/lib/rows");
  const p1 = await readRows("app", "item", { limit: 2 });
  expect(p1.rows.map((r) => r.id)).toEqual([1, 2]);
  expect(p1.nextCursor).not.toBeNull();
  const p2 = await readRows("app", "item", { limit: 2, cursor: p1.nextCursor });
  expect(p2.rows.map((r) => r.id)).toEqual([3, 4]);
});
```

- [ ] **Step 2: Run it — expect FAIL.** Run: `npm test -- rows.int`

- [ ] **Step 3: Implement `lib/rows.ts`**

```ts
import { getSql } from "@/lib/db";
import { describeTable, type ColumnInfo } from "@/lib/introspect";
import { ident, qualified } from "@/lib/sql-guard";

export type RowPage = { columns: ColumnInfo[]; primaryKey: string[]; rows: Record<string, unknown>[]; nextCursor: string | null };

function encodeCursor(v: unknown[]): string { return Buffer.from(JSON.stringify(v)).toString("base64url"); }
function decodeCursor(c: string): unknown[] { return JSON.parse(Buffer.from(c, "base64url").toString("utf8")); }

export function rowPk(row: Record<string, unknown>, primaryKey: string[]): Record<string, unknown> {
  return Object.fromEntries(primaryKey.map((k) => [k, row[k]]));
}

export async function readRows(
  schema: string, table: string, opts: { limit?: number; cursor?: string | null } = {},
): Promise<RowPage> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const shape = await describeTable(schema, table);
  const rel = qualified(schema, table);
  const orderCols = shape.primaryKey.length ? shape.primaryKey : null;

  if (!orderCols) {
    const rows = await getSql().unsafe(`SELECT * FROM ${rel} ORDER BY ctid LIMIT $1`, [limit]);
    return { columns: shape.columns, primaryKey: [], rows: rows as any, nextCursor: null };
  }

  const orderBy = orderCols.map((c) => `${ident(c)} ASC`).join(", ");
  let where = "";
  const args: unknown[] = [];
  if (opts.cursor) {
    const vals = decodeCursor(opts.cursor);
    // row-wise comparison: (c1,c2,...) > ($1,$2,...)
    const lhs = `(${orderCols.map(ident).join(", ")})`;
    const rhs = `(${orderCols.map((_, i) => `$${i + 1}`).join(", ")})`;
    where = `WHERE ${lhs} > ${rhs}`;
    args.push(...vals);
  }
  args.push(limit + 1);
  const rows = (await getSql().unsafe(
    `SELECT * FROM ${rel} ${where} ORDER BY ${orderBy} LIMIT $${args.length}`, args,
  )) as Record<string, unknown>[];

  let nextCursor: string | null = null;
  if (rows.length > limit) {
    rows.pop();
    const last = rows[rows.length - 1];
    nextCursor = encodeCursor(orderCols.map((c) => last[c]));
  }
  return { columns: shape.columns, primaryKey: shape.primaryKey, rows, nextCursor };
}
```

- [ ] **Step 4: Run it — expect PASS.** Run: `npm test -- rows.int`

- [ ] **Step 5: Implement `components/row-grid.tsx`** (client component; renders rows + Edit/Delete/Insert hooks wired in later tasks)

```tsx
"use client";
import Link from "next/link";
import type { RowPage } from "@/lib/rows";

export function RowGrid({ schema, table, page }: { schema: string; table: string; page: RowPage }) {
  const readOnly = page.primaryKey.length === 0;
  return (
    <div className="overflow-x-auto">
      {readOnly && <p className="mb-2 rounded bg-yellow-100 p-2 text-sm">No primary key — this table is read-only in god mode.</p>}
      <table className="min-w-full text-sm">
        <thead><tr className="border-b text-left">
          {page.columns.map((c) => <th key={c.name} className="px-2 py-1 font-mono">{c.name}</th>)}
          {!readOnly && <th className="px-2">actions</th>}
        </tr></thead>
        <tbody>
          {page.rows.map((row, i) => (
            <tr key={i} className="border-b">
              {page.columns.map((c) => <td key={c.name} className="max-w-xs truncate px-2 py-1">{format(row[c.name])}</td>)}
              {!readOnly && <td className="whitespace-nowrap px-2">
                <Link className="text-blue-600" href={`/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/edit?pk=${encodeURIComponent(JSON.stringify(pk(row, page.primaryKey)))}`}>edit</Link>
                {" · "}
                <Link className="text-red-600" href={`/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/delete?pk=${encodeURIComponent(JSON.stringify(pk(row, page.primaryKey)))}`}>delete</Link>
              </td>}
            </tr>
          ))}
        </tbody>
      </table>
      {page.nextCursor && (
        <Link className="mt-3 inline-block text-blue-600" href={`/${encodeURIComponent(schema)}/${encodeURIComponent(table)}?cursor=${encodeURIComponent(page.nextCursor)}`}>next →</Link>
      )}
    </div>
  );
}

function pk(row: Record<string, unknown>, keys: string[]) { return Object.fromEntries(keys.map((k) => [k, row[k]])); }
function format(v: unknown): string {
  if (v === null || v === undefined) return "∅";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
```

- [ ] **Step 6: Implement `app/(god)/[schema]/[table]/page.tsx`**

```tsx
import Link from "next/link";
import { readRows } from "@/lib/rows";
import { RowGrid } from "@/components/row-grid";
import { SchemaBanner } from "@/components/schema-banner";

export const dynamic = "force-dynamic";

export default async function TablePage({
  params, searchParams,
}: { params: Promise<{ schema: string; table: string }>; searchParams: Promise<{ cursor?: string }> }) {
  const { schema, table } = await params;
  const { cursor } = await searchParams;
  const page = await readRows(schema, table, { cursor: cursor ?? null });
  return (
    <div>
      <SchemaBanner schema={schema} />
      <div className="my-3 flex items-center gap-3">
        <h1 className="text-lg font-semibold font-mono">{schema}.{table}</h1>
        {page.primaryKey.length > 0 && (
          <Link href={`/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/insert`} className="rounded bg-green-600 px-2 py-1 text-sm text-white">+ Insert</Link>
        )}
        <Link href={`/${encodeURIComponent(schema)}/sql`} className="ml-auto text-sm text-gray-600">SQL console</Link>
      </div>
      <RowGrid schema={schema} table={table} page={page} />
    </div>
  );
}
```

- [ ] **Step 7: Typecheck + commit**

```bash
git add lib/rows.ts components/row-grid.tsx app/\(god\)/\[schema\]/\[table\]/page.tsx lib/__tests__/rows.int.test.ts
git commit -m "feat: generic row grid with keyset pagination"
```

---

## Phase 3 — Audit + single-row writes

### Task 12: Audit log storage

**Files:**
- Create: `lib/audit.ts`, `lib/migrate.ts`, `scripts/migrate.ts`
- Test: `lib/__tests__/audit.int.test.ts`

**Interfaces:**
- Consumes: `getSql`/`withTransaction` (Task 4), `env` (Task 2), `qualified` (Task 3).
- Produces:
  - `export type Operation = "INSERT" | "UPDATE" | "DELETE" | "CASCADE_DELETE" | "DROP_SCHEMA" | "RAW_SQL"`.
  - `export type AuditEntry = { actor: string; schemaName: string; tableName: string | null; operation: Operation; pk: unknown; oldValues: unknown; newValues: unknown; statement: string | null }`.
  - `ensureAuditTable(): Promise<void>` — creates `<SYSTEM_SCHEMA_NAME>.tb_god_mode_audit` if absent.
  - `writeAudit(tx: import("postgres").TransactionSql, entry: AuditEntry): Promise<void>` — inserts within the caller's transaction.
  - `listAudit(filter?: { schema?: string; table?: string; operation?: Operation; limit?: number }): Promise<Array<AuditEntry & { id: string; at: string }>>`.

- [ ] **Step 1: Write the failing integration test** — `lib/__tests__/audit.int.test.ts`

```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { startPg } from "@/test/pg";

let container: StartedPostgreSqlContainer;
beforeAll(async () => {
  const pg = await startPg();
  container = pg.container;
  process.env.DATABASE_URL = pg.url;
  process.env.SYSTEM_DATABASE_URL = pg.url;
  process.env.SYSTEM_SCHEMA_NAME = "CARMEN_SYSTEM";
  process.env.GOD_MODE_PASSWORD = "x";
  process.env.SESSION_SECRET = "x".repeat(32);
  const { getSql } = await import("@/lib/db");
  await getSql().unsafe(`CREATE SCHEMA "CARMEN_SYSTEM"`);
});
afterAll(async () => { await container.stop(); });

test("writeAudit persists an entry inside a txn", async () => {
  const { ensureAuditTable, writeAudit, listAudit } = await import("@/lib/audit");
  const { withTransaction } = await import("@/lib/db");
  await ensureAuditTable();
  await withTransaction(null, async (tx) => {
    await writeAudit(tx, { actor: "tester", schemaName: "app", tableName: "item",
      operation: "DELETE", pk: { id: 1 }, oldValues: { id: 1, name: "x" }, newValues: null, statement: "DELETE ..." });
  });
  const entries = await listAudit({ limit: 10 });
  expect(entries[0].operation).toBe("DELETE");
  expect(entries[0].actor).toBe("tester");
  expect((entries[0].pk as any).id).toBe(1);
});
```

- [ ] **Step 2: Run it — expect FAIL.** Run: `npm test -- audit.int`

- [ ] **Step 3: Implement `lib/audit.ts`**

```ts
import type { TransactionSql } from "postgres";
import { getSql } from "@/lib/db";
import { env } from "@/lib/env";
import { qualified } from "@/lib/sql-guard";

export type Operation = "INSERT" | "UPDATE" | "DELETE" | "CASCADE_DELETE" | "DROP_SCHEMA" | "RAW_SQL";
export type AuditEntry = { actor: string; schemaName: string; tableName: string | null; operation: Operation; pk: unknown; oldValues: unknown; newValues: unknown; statement: string | null };

function auditRel(): string { return qualified(env().systemSchemaName, "tb_god_mode_audit"); }

export async function ensureAuditTable(): Promise<void> {
  await getSql().unsafe(`
    CREATE TABLE IF NOT EXISTS ${auditRel()} (
      id uuid primary key default gen_random_uuid(),
      at timestamptz not null default now(),
      actor text not null,
      schema_name text not null,
      table_name text,
      operation text not null,
      pk jsonb, old_values jsonb, new_values jsonb, statement text
    )`);
}

export async function writeAudit(tx: TransactionSql, e: AuditEntry): Promise<void> {
  await tx.unsafe(
    `INSERT INTO ${auditRel()} (actor, schema_name, table_name, operation, pk, old_values, new_values, statement)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [e.actor, e.schemaName, e.tableName, e.operation,
     e.pk == null ? null : JSON.stringify(e.pk),
     e.oldValues == null ? null : JSON.stringify(e.oldValues),
     e.newValues == null ? null : JSON.stringify(e.newValues),
     e.statement],
  );
}

export async function listAudit(filter: { schema?: string; table?: string; operation?: Operation; limit?: number } = {}) {
  const conds: string[] = []; const args: unknown[] = [];
  if (filter.schema) { args.push(filter.schema); conds.push(`schema_name = $${args.length}`); }
  if (filter.table) { args.push(filter.table); conds.push(`table_name = $${args.length}`); }
  if (filter.operation) { args.push(filter.operation); conds.push(`operation = $${args.length}`); }
  args.push(Math.min(filter.limit ?? 100, 500));
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const rows = await getSql().unsafe(
    `SELECT id::text, at::text, actor, schema_name, table_name, operation, pk, old_values, new_values, statement
     FROM ${auditRel()} ${where} ORDER BY at DESC LIMIT $${args.length}`, args);
  return rows.map((r: any) => ({
    id: r.id, at: r.at, actor: r.actor, schemaName: r.schema_name, tableName: r.table_name,
    operation: r.operation as Operation, pk: r.pk, oldValues: r.old_values, newValues: r.new_values, statement: r.statement,
  }));
}
```

- [ ] **Step 4: Run it — expect PASS.** Run: `npm test -- audit.int`

- [ ] **Step 5: Implement `scripts/migrate.ts`** (one-off to provision the audit table against the real DB)

```ts
import { ensureAuditTable } from "@/lib/audit";
ensureAuditTable().then(() => { console.log("audit table ready"); process.exit(0); })
  .catch((e) => { console.error(e); process.exit(1); });
```
Add script: `"migrate": "tsx scripts/migrate.ts"` and `npm i -D tsx`.

- [ ] **Step 6: Commit**

```bash
git add lib/audit.ts scripts/migrate.ts lib/__tests__/audit.int.test.ts package.json
git commit -m "feat: audit log storage + migration script"
```

---

### Task 13: Atomic write helper (change + audit in one txn)

**Files:**
- Create: `lib/write.ts`
- Test: `lib/__tests__/write.int.test.ts`

**Interfaces:**
- Consumes: `withTransaction` (Task 4), `writeAudit` (Task 12), `getSession` (Task 5), `ident`/`qualified` (Task 3), `describeTable` (Task 6).
- Produces:
  - `currentActor(): Promise<string>` — reads the session actor (defaults `"god"`).
  - `applyInsert(schema: string, table: string, values: Record<string, unknown>): Promise<Record<string, unknown>>` — inserts; audits `INSERT` (newValues = inserted row via `RETURNING *`); returns the row.
  - `applyUpdate(schema: string, table: string, pk: Record<string, unknown>, values: Record<string, unknown>): Promise<{ before: Record<string, unknown>; after: Record<string, unknown> }>` — reads old row, updates, audits `UPDATE`.
  - `applySingleDelete(schema: string, table: string, pk: Record<string, unknown>): Promise<Record<string, unknown>>` — reads old row, deletes that one row, audits `DELETE`.
  - Helper `whereFromPk(pk, startIndex): { clause: string; args: unknown[] }`.

- [ ] **Step 1: Write the failing integration test** — `lib/__tests__/write.int.test.ts`

```ts
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { startPg } from "@/test/pg";

let container: StartedPostgreSqlContainer;
beforeAll(async () => {
  const pg = await startPg();
  container = pg.container;
  process.env.DATABASE_URL = pg.url;
  process.env.SYSTEM_DATABASE_URL = pg.url;
  process.env.SYSTEM_SCHEMA_NAME = "CARMEN_SYSTEM";
  process.env.GOD_MODE_PASSWORD = "x";
  process.env.SESSION_SECRET = "x".repeat(32);
  vi.mock("@/lib/session", () => ({ getSession: async () => ({ actor: "tester", authed: true }) }));
  const { getSql } = await import("@/lib/db");
  await getSql().unsafe(`
    CREATE SCHEMA "CARMEN_SYSTEM";
    CREATE SCHEMA app;
    CREATE TABLE app.item (id int primary key, name text);
    INSERT INTO app.item VALUES (1,'one');
  `);
  const { ensureAuditTable } = await import("@/lib/audit");
  await ensureAuditTable();
});
afterAll(async () => { await container.stop(); });

test("applyUpdate changes the row and writes audit", async () => {
  const { applyUpdate } = await import("@/lib/write");
  const { listAudit } = await import("@/lib/audit");
  const res = await applyUpdate("app", "item", { id: 1 }, { name: "ONE" });
  expect(res.after.name).toBe("ONE");
  expect(res.before.name).toBe("one");
  const audit = await listAudit({ operation: "UPDATE", limit: 1 });
  expect((audit[0].newValues as any).name).toBe("ONE");
});

test("applySingleDelete removes the row and audits", async () => {
  const { applyInsert, applySingleDelete } = await import("@/lib/write");
  await applyInsert("app", "item", { id: 2, name: "two" });
  const removed = await applySingleDelete("app", "item", { id: 2 });
  expect(removed.id).toBe(2);
});
```

- [ ] **Step 2: Run it — expect FAIL.** Run: `npm test -- write.int`

- [ ] **Step 3: Implement `lib/write.ts`**

```ts
import { withTransaction, getSql } from "@/lib/db";
import { ident, qualified } from "@/lib/sql-guard";
import { writeAudit } from "@/lib/audit";
import { getSession } from "@/lib/session";

export async function currentActor(): Promise<string> {
  try { return (await getSession()).actor ?? "god"; } catch { return "god"; }
}

export function whereFromPk(pk: Record<string, unknown>, startIndex: number): { clause: string; args: unknown[] } {
  const keys = Object.keys(pk);
  const parts = keys.map((k, i) => `${ident(k)} = $${startIndex + i}`);
  return { clause: parts.join(" AND "), args: keys.map((k) => pk[k]) };
}

async function readOne(schema: string, table: string, pk: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const { clause, args } = whereFromPk(pk, 1);
  const rows = await getSql().unsafe(`SELECT * FROM ${qualified(schema, table)} WHERE ${clause} LIMIT 1`, args);
  return (rows[0] as Record<string, unknown>) ?? null;
}

export async function applyInsert(schema: string, table: string, values: Record<string, unknown>): Promise<Record<string, unknown>> {
  const actor = await currentActor();
  const cols = Object.keys(values);
  const colSql = cols.map(ident).join(", ");
  const ph = cols.map((_, i) => `$${i + 1}`).join(", ");
  const args = cols.map((c) => values[c]);
  return withTransaction(null, async (tx) => {
    const rows = await tx.unsafe(`INSERT INTO ${qualified(schema, table)} (${colSql}) VALUES (${ph}) RETURNING *`, args);
    const row = rows[0] as Record<string, unknown>;
    await writeAudit(tx, { actor, schemaName: schema, tableName: table, operation: "INSERT", pk: null, oldValues: null, newValues: row, statement: `INSERT INTO ${qualified(schema, table)}` });
    return row;
  });
}

export async function applyUpdate(schema: string, table: string, pk: Record<string, unknown>, values: Record<string, unknown>) {
  const actor = await currentActor();
  const before = await readOne(schema, table, pk);
  if (!before) throw new Error("Row not found");
  const cols = Object.keys(values);
  const setSql = cols.map((c, i) => `${ident(c)} = $${i + 1}`).join(", ");
  const setArgs = cols.map((c) => values[c]);
  const { clause, args: pkArgs } = whereFromPk(pk, cols.length + 1);
  return withTransaction(null, async (tx) => {
    const rows = await tx.unsafe(`UPDATE ${qualified(schema, table)} SET ${setSql} WHERE ${clause} RETURNING *`, [...setArgs, ...pkArgs]);
    const after = rows[0] as Record<string, unknown>;
    await writeAudit(tx, { actor, schemaName: schema, tableName: table, operation: "UPDATE", pk, oldValues: before, newValues: after, statement: `UPDATE ${qualified(schema, table)}` });
    return { before, after };
  });
}

export async function applySingleDelete(schema: string, table: string, pk: Record<string, unknown>): Promise<Record<string, unknown>> {
  const actor = await currentActor();
  const before = await readOne(schema, table, pk);
  if (!before) throw new Error("Row not found");
  const { clause, args } = whereFromPk(pk, 1);
  return withTransaction(null, async (tx) => {
    await tx.unsafe(`DELETE FROM ${qualified(schema, table)} WHERE ${clause}`, args);
    await writeAudit(tx, { actor, schemaName: schema, tableName: table, operation: "DELETE", pk, oldValues: before, newValues: null, statement: `DELETE FROM ${qualified(schema, table)}` });
    return before;
  });
}
```

- [ ] **Step 4: Run it — expect PASS.** Run: `npm test -- write.int`

- [ ] **Step 5: Commit**

```bash
git add lib/write.ts lib/__tests__/write.int.test.ts
git commit -m "feat: atomic write helpers with inline audit"
```

---

### Task 14: Row form, insert + edit pages, server actions

**Files:**
- Create: `lib/coerce.ts`, `components/row-form.tsx`, `server/rows.ts`, `app/(god)/[schema]/[table]/insert/page.tsx`, `app/(god)/[schema]/[table]/edit/page.tsx`
- Test: `lib/__tests__/coerce.test.ts`

**Interfaces:**
- Consumes: `describeTable` (Task 6), `applyInsert`/`applyUpdate` (Task 13), `ColumnInfo` (Task 6).
- Produces:
  - `lib/coerce.ts`: `coerceValue(col: ColumnInfo, raw: string, isNull: boolean): unknown` — converts a form string to a JS value by `udtName` (numbers, booleans, json parse, null passthrough); throws a readable error on bad json/number.
  - `server/rows.ts`: `submitInsert(schema, table, formData): Promise<void>` and `submitUpdate(schema, table, pkJson, formData): Promise<void>` — build value maps from the form (honoring per-field NULL checkboxes), call the Task 13 helpers, `revalidatePath`, and `redirect` back to the table.
  - `components/row-form.tsx`: `RowForm({ columns, primaryKey, initial, action })` — renders type-aware inputs with a NULL toggle per nullable column.

- [ ] **Step 1: Write the failing test** — `lib/__tests__/coerce.test.ts`

```ts
import { expect, test } from "vitest";
import { coerceValue } from "@/lib/coerce";
import type { ColumnInfo } from "@/lib/introspect";

const col = (over: Partial<ColumnInfo>): ColumnInfo => ({ name: "c", dataType: "text", udtName: "text", isNullable: true, default: null, isPrimaryKey: false, ...over });

test("null toggle wins", () => { expect(coerceValue(col({}), "ignored", true)).toBeNull(); });
test("int4 parses to number", () => { expect(coerceValue(col({ udtName: "int4" }), "42", false)).toBe(42); });
test("bool parses", () => { expect(coerceValue(col({ udtName: "bool" }), "true", false)).toBe(true); });
test("jsonb parses", () => { expect(coerceValue(col({ udtName: "jsonb" }), '{"a":1}', false)).toEqual({ a: 1 }); });
test("bad number throws", () => { expect(() => coerceValue(col({ udtName: "int4" }), "abc", false)).toThrow(); });
test("bad json throws", () => { expect(() => coerceValue(col({ udtName: "jsonb" }), "{", false)).toThrow(); });
```

- [ ] **Step 2: Run it — expect FAIL.** Run: `npm test -- coerce`

- [ ] **Step 3: Implement `lib/coerce.ts`**

```ts
import type { ColumnInfo } from "@/lib/introspect";

export function coerceValue(col: ColumnInfo, raw: string, isNull: boolean): unknown {
  if (isNull) return null;
  const t = col.udtName.toLowerCase();
  if (["int2", "int4", "int8", "numeric", "float4", "float8"].includes(t)) {
    if (raw.trim() === "") return null;
    const n = Number(raw);
    if (Number.isNaN(n)) throw new Error(`Invalid number for ${col.name}: ${raw}`);
    return n;
  }
  if (t === "bool") return raw === "true" || raw === "on" || raw === "t";
  if (t === "json" || t === "jsonb") {
    try { return JSON.parse(raw); } catch { throw new Error(`Invalid JSON for ${col.name}`); }
  }
  return raw;
}
```

- [ ] **Step 4: Run it — expect PASS.** Run: `npm test -- coerce`

- [ ] **Step 5: Implement `server/rows.ts`**

```ts
"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { describeTable } from "@/lib/introspect";
import { coerceValue } from "@/lib/coerce";
import { applyInsert, applyUpdate } from "@/lib/write";

async function valuesFromForm(schema: string, table: string, formData: FormData, includeAllColumns: boolean) {
  const shape = await describeTable(schema, table);
  const values: Record<string, unknown> = {};
  for (const col of shape.columns) {
    const present = formData.has(`f_${col.name}`);
    if (!includeAllColumns && !present && !formData.has(`null_${col.name}`)) continue;
    const isNull = formData.get(`null_${col.name}`) === "on";
    const raw = String(formData.get(`f_${col.name}`) ?? "");
    if (col.isPrimaryKey && col.default && raw.trim() === "" && !isNull) continue; // let DB default fire
    values[col.name] = coerceValue(col, raw, isNull);
  }
  return values;
}

export async function submitInsert(schema: string, table: string, formData: FormData): Promise<void> {
  const values = await valuesFromForm(schema, table, formData, false);
  await applyInsert(schema, table, values);
  revalidatePath(`/${schema}/${table}`);
  redirect(`/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`);
}

export async function submitUpdate(schema: string, table: string, pkJson: string, formData: FormData): Promise<void> {
  const pk = JSON.parse(pkJson) as Record<string, unknown>;
  const values = await valuesFromForm(schema, table, formData, true);
  for (const k of Object.keys(pk)) delete values[k]; // never update pk columns
  await applyUpdate(schema, table, pk, values);
  revalidatePath(`/${schema}/${table}`);
  redirect(`/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`);
}
```

- [ ] **Step 6: Implement `components/row-form.tsx`**

```tsx
import type { ColumnInfo } from "@/lib/introspect";

export function RowForm({
  columns, initial, action, submitLabel,
}: { columns: ColumnInfo[]; initial?: Record<string, unknown>; action: (fd: FormData) => void; submitLabel: string }) {
  return (
    <form action={action} className="max-w-xl space-y-3">
      {columns.map((c) => {
        const v = initial?.[c.name];
        const text = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v, null, 2) : String(v);
        const isJson = c.udtName === "json" || c.udtName === "jsonb";
        return (
          <div key={c.name} className="space-y-1">
            <label className="block text-sm font-mono">{c.name} <span className="text-gray-400">{c.dataType}{c.isNullable ? "" : " NOT NULL"}</span></label>
            {isJson
              ? <textarea name={`f_${c.name}`} defaultValue={text} rows={4} className="w-full rounded border p-2 font-mono text-xs" />
              : <input name={`f_${c.name}`} defaultValue={text} className="w-full rounded border p-2" />}
            {c.isNullable && (
              <label className="text-xs text-gray-600"><input type="checkbox" name={`null_${c.name}`} defaultChecked={v === null} /> set NULL</label>
            )}
          </div>
        );
      })}
      <button type="submit" className="rounded bg-black px-4 py-2 text-white">{submitLabel}</button>
    </form>
  );
}
```

- [ ] **Step 7: Implement `app/(god)/[schema]/[table]/insert/page.tsx`**

```tsx
import { describeTable } from "@/lib/introspect";
import { RowForm } from "@/components/row-form";
import { submitInsert } from "@/server/rows";
import { SchemaBanner } from "@/components/schema-banner";

export const dynamic = "force-dynamic";

export default async function InsertPage({ params }: { params: Promise<{ schema: string; table: string }> }) {
  const { schema, table } = await params;
  const shape = await describeTable(schema, table);
  const action = submitInsert.bind(null, schema, table);
  return (
    <div>
      <SchemaBanner schema={schema} />
      <h1 className="my-3 text-lg font-semibold font-mono">Insert into {schema}.{table}</h1>
      <RowForm columns={shape.columns} action={action} submitLabel="Insert" />
    </div>
  );
}
```

- [ ] **Step 8: Implement `app/(god)/[schema]/[table]/edit/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import { describeTable } from "@/lib/introspect";
import { getSql } from "@/lib/db";
import { qualified } from "@/lib/sql-guard";
import { whereFromPk } from "@/lib/write";
import { RowForm } from "@/components/row-form";
import { submitUpdate } from "@/server/rows";
import { SchemaBanner } from "@/components/schema-banner";

export const dynamic = "force-dynamic";

export default async function EditPage({
  params, searchParams,
}: { params: Promise<{ schema: string; table: string }>; searchParams: Promise<{ pk?: string }> }) {
  const { schema, table } = await params;
  const { pk: pkParam } = await searchParams;
  if (!pkParam) notFound();
  const pk = JSON.parse(pkParam) as Record<string, unknown>;
  const shape = await describeTable(schema, table);
  const { clause, args } = whereFromPk(pk, 1);
  const rows = await getSql().unsafe(`SELECT * FROM ${qualified(schema, table)} WHERE ${clause} LIMIT 1`, args);
  if (!rows[0]) notFound();
  const action = submitUpdate.bind(null, schema, table, JSON.stringify(pk));
  return (
    <div>
      <SchemaBanner schema={schema} />
      <h1 className="my-3 text-lg font-semibold font-mono">Edit {schema}.{table}</h1>
      <RowForm columns={shape.columns} initial={rows[0] as Record<string, unknown>} action={action} submitLabel="Save changes" />
    </div>
  );
}
```

- [ ] **Step 9: Typecheck + commit**

```bash
git add lib/coerce.ts components/row-form.tsx server/rows.ts app/\(god\)/\[schema\]/\[table\]/insert app/\(god\)/\[schema\]/\[table\]/edit lib/__tests__/coerce.test.ts
git commit -m "feat: insert and edit row forms with type coercion"
```

---

## Phase 4 — Cascade delete

### Task 15: FK topological sort (pure logic)

**Files:**
- Create: `lib/topo.ts`
- Test: `lib/__tests__/topo.test.ts`

**Interfaces:**
- Consumes: `ForeignKey` (Task 6).
- Produces:
  - `export type TableRef = { schema: string; table: string }`; `tableKey(t: TableRef): string` → `"schema.table"`.
  - `orderTablesForDeletion(tables: TableRef[], fks: ForeignKey[]): { order: TableRef[]; cycles: string[][] }` — returns the tables ordered so that every child (referencing) table precedes its parent (referenced) table. Self-references are ignored (a table never blocks itself here). Genuine multi-table cycles are reported in `cycles` and appended in best-effort order.

- [ ] **Step 1: Write the failing test** — `lib/__tests__/topo.test.ts`

```ts
import { expect, test } from "vitest";
import { orderTablesForDeletion, tableKey, type TableRef } from "@/lib/topo";
import type { ForeignKey } from "@/lib/introspect";

const t = (table: string): TableRef => ({ schema: "app", table });
const fk = (child: string, parent: string): ForeignKey => ({
  childSchema: "app", childTable: child, childColumns: ["x"],
  parentSchema: "app", parentTable: parent, parentColumns: ["id"], onDelete: "NO ACTION",
});

test("children come before parents", () => {
  const { order } = orderTablesForDeletion([t("parent"), t("child")], [fk("child", "parent")]);
  expect(order.map((o) => o.table)).toEqual(["child", "parent"]);
});

test("multi-level ordering", () => {
  const { order } = orderTablesForDeletion(
    [t("a"), t("b"), t("c")], [fk("c", "b"), fk("b", "a")]);
  expect(order.map((o) => o.table)).toEqual(["c", "b", "a"]);
});

test("self reference does not deadlock", () => {
  const { order, cycles } = orderTablesForDeletion([t("node")], [fk("node", "node")]);
  expect(order.map((o) => o.table)).toEqual(["node"]);
  expect(cycles).toEqual([]);
});

test("genuine cycle is reported", () => {
  const { cycles } = orderTablesForDeletion([t("a"), t("b")], [fk("a", "b"), fk("b", "a")]);
  expect(cycles.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run it — expect FAIL.** Run: `npm test -- topo`

- [ ] **Step 3: Implement `lib/topo.ts`**

```ts
import type { ForeignKey } from "@/lib/introspect";

export type TableRef = { schema: string; table: string };
export function tableKey(t: TableRef): string { return `${t.schema}.${t.table}`; }

export function orderTablesForDeletion(tables: TableRef[], fks: ForeignKey[]): { order: TableRef[]; cycles: string[][] } {
  const byKey = new Map<string, TableRef>();
  for (const t of tables) byKey.set(tableKey(t), t);

  // edge child -> parent (child must be deleted first). Ignore self-edges.
  const parents = new Map<string, Set<string>>(); // key -> set of parent keys it depends on
  for (const k of byKey.keys()) parents.set(k, new Set());
  for (const f of fks) {
    const c = `${f.childSchema}.${f.childTable}`;
    const p = `${f.parentSchema}.${f.parentTable}`;
    if (c === p) continue;
    if (!byKey.has(c) || !byKey.has(p)) continue;
    parents.get(c)!.add(p);
  }

  // Kahn: emit a table once all its parents (that it depends on) are already emitted? No —
  // child must come BEFORE parent. So emit a table when nothing it depends-on-being-after remains.
  // Reframe: we want order where child precedes parent. Build indegree on edge parent<-child meaning
  // "parent waits for child". A parent can be emitted only after all its children are emitted.
  const childrenOf = new Map<string, Set<string>>(); // parentKey -> child keys
  for (const k of byKey.keys()) childrenOf.set(k, new Set());
  for (const [child, ps] of parents) for (const p of ps) childrenOf.get(p)!.add(child);

  const remainingChildren = new Map<string, number>();
  for (const [k, kids] of childrenOf) remainingChildren.set(k, kids.size);

  const ready: string[] = [...remainingChildren].filter(([, n]) => n === 0).map(([k]) => k).sort();
  const order: TableRef[] = [];
  const emitted = new Set<string>();
  while (ready.length) {
    const k = ready.shift()!;
    if (emitted.has(k)) continue;
    emitted.add(k);
    order.push(byKey.get(k)!);
    for (const p of parents.get(k)!) {
      remainingChildren.set(p, remainingChildren.get(p)! - 1);
      if (remainingChildren.get(p) === 0) { ready.push(p); ready.sort(); }
    }
  }

  const cycles: string[][] = [];
  if (emitted.size < byKey.size) {
    const stuck = [...byKey.keys()].filter((k) => !emitted.has(k));
    cycles.push(stuck);
    for (const k of stuck) order.push(byKey.get(k)!); // best-effort
  }
  return { order, cycles };
}
```

- [ ] **Step 4: Run it — expect PASS.** Run: `npm test -- topo`

- [ ] **Step 5: Commit**

```bash
git add lib/topo.ts lib/__tests__/topo.test.ts
git commit -m "feat: topological table ordering for deletion"
```

---

### Task 16: Cascade blast-radius + executor

**Files:**
- Create: `lib/cascade.ts`
- Test: `lib/__tests__/cascade.int.test.ts`

**Interfaces:**
- Consumes: `getSql`/`withTransaction` (Task 4), `listForeignKeys`/`describeTable` (Task 6), `orderTablesForDeletion`/`tableKey` (Task 15), `ident`/`qualified` (Task 3), `env` (Task 2), `writeAudit` (Task 12), `currentActor` (Task 13).
- Produces:
  - `export type CascadeRow = { schema: string; table: string; pk: Record<string, unknown>; depth: number }`.
  - `export type BlastRadius = { rows: CascadeRow[]; byTable: Array<{ schema: string; table: string; count: number }>; maxDepth: number; truncated: boolean }`.
  - `computeBlastRadius(schema: string, table: string, pk: Record<string, unknown>): Promise<BlastRadius>` — BFS over child FKs within `schema` (plus cross-schema FKs returned by `listForeignKeys`), deduped by `schema.table` + JSON pk, capped by `env().cascadeMaxRows`/`cascadeMaxDepth` (sets `truncated`).
  - `executeCascade(schema: string, table: string, pk: Record<string, unknown>, opts: { dropTenantSchema?: string | null }): Promise<{ deleted: number; droppedSchema: string | null }>` — recomputes the blast radius, orders tables children-first, deletes per table in one transaction, writes one `CASCADE_DELETE` audit row per deleted row (old values captured), optionally `DROP SCHEMA "<tenant>" CASCADE` with its own `DROP_SCHEMA` audit row.

- [ ] **Step 1: Write the failing integration test** — `lib/__tests__/cascade.int.test.ts`

```ts
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { startPg } from "@/test/pg";

let container: StartedPostgreSqlContainer;
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
  vi.mock("@/lib/session", () => ({ getSession: async () => ({ actor: "tester", authed: true }) }));
  const { getSql } = await import("@/lib/db");
  await getSql().unsafe(`
    CREATE SCHEMA "CARMEN_SYSTEM";
    CREATE SCHEMA app;
    CREATE TABLE app.bu (id int primary key, name text);
    CREATE TABLE app.role (id int primary key, bu_id int references app.bu(id));
    CREATE TABLE app.perm (id int primary key, role_id int references app.role(id));
    INSERT INTO app.bu VALUES (1,'BU1');
    INSERT INTO app.role VALUES (10,1),(11,1);
    INSERT INTO app.perm VALUES (100,10),(101,11);
  `);
  const { ensureAuditTable } = await import("@/lib/audit");
  await ensureAuditTable();
});
afterAll(async () => { await container.stop(); });

test("computeBlastRadius finds all descendants", async () => {
  const { computeBlastRadius } = await import("@/lib/cascade");
  const r = await computeBlastRadius("app", "bu", { id: 1 });
  const total = r.rows.length;
  expect(total).toBe(5); // bu + 2 roles + 2 perms
  expect(r.maxDepth).toBe(2);
});

test("executeCascade deletes children-first without FK error", async () => {
  const { executeCascade } = await import("@/lib/cascade");
  const { getSql } = await import("@/lib/db");
  const res = await executeCascade("app", "bu", { id: 1 }, {});
  expect(res.deleted).toBe(5);
  const left = await getSql().unsafe(`SELECT count(*)::int n FROM app.bu`);
  expect(left[0].n).toBe(0);
  const { listAudit } = await import("@/lib/audit");
  const audit = await listAudit({ operation: "CASCADE_DELETE", limit: 10 });
  expect(audit.length).toBe(5);
});
```

- [ ] **Step 2: Run it — expect FAIL.** Run: `npm test -- cascade.int`

- [ ] **Step 3: Implement `lib/cascade.ts`**

```ts
import { getSql, withTransaction } from "@/lib/db";
import { listForeignKeys, describeTable, type ForeignKey } from "@/lib/introspect";
import { orderTablesForDeletion, type TableRef } from "@/lib/topo";
import { ident, qualified } from "@/lib/sql-guard";
import { env } from "@/lib/env";
import { writeAudit } from "@/lib/audit";
import { currentActor } from "@/lib/write";

export type CascadeRow = { schema: string; table: string; pk: Record<string, unknown>; depth: number };
export type BlastRadius = { rows: CascadeRow[]; byTable: Array<{ schema: string; table: string; count: number }>; maxDepth: number; truncated: boolean };

function rowKey(schema: string, table: string, pk: Record<string, unknown>): string {
  return `${schema}.${table}:${JSON.stringify(pk)}`;
}

// children whose FK points at (schema.table)
function childrenFks(fks: ForeignKey[], schema: string, table: string): ForeignKey[] {
  return fks.filter((f) => f.parentSchema === schema && f.parentTable === table);
}

export async function computeBlastRadius(schema: string, table: string, pk: Record<string, unknown>): Promise<BlastRadius> {
  const maxRows = env().cascadeMaxRows, maxDepth = env().cascadeMaxDepth;
  const fkCache = new Map<string, ForeignKey[]>();
  async function fksFor(s: string): Promise<ForeignKey[]> {
    if (!fkCache.has(s)) fkCache.set(s, await listForeignKeys(s));
    return fkCache.get(s)!;
  }
  const pkColsCache = new Map<string, string[]>();
  async function pkCols(s: string, t: string): Promise<string[]> {
    const k = `${s}.${t}`;
    if (!pkColsCache.has(k)) pkColsCache.set(k, (await describeTable(s, t)).primaryKey);
    return pkColsCache.get(k)!;
  }

  const seen = new Set<string>();
  const rows: CascadeRow[] = [];
  let truncated = false;
  const queue: CascadeRow[] = [{ schema, table, pk, depth: 0 }];
  seen.add(rowKey(schema, table, pk));
  rows.push(queue[0]);

  while (queue.length) {
    const node = queue.shift()!;
    if (node.depth >= maxDepth) { truncated = true; continue; }
    const fks = await fksFor(node.schema);
    for (const f of childrenFks(fks, node.schema, node.table)) {
      const childPk = await pkCols(f.childSchema, f.childTable);
      if (childPk.length === 0) continue; // can't address rows without a pk
      const whereParts = f.childColumns.map((c, i) => `${ident(c)} = $${i + 1}`);
      const args = f.parentColumns.map((pc) => node.pk[pc]);
      const selectPk = childPk.map(ident).join(", ");
      const found = await getSql().unsafe(
        `SELECT ${selectPk} FROM ${qualified(f.childSchema, f.childTable)} WHERE ${whereParts.join(" AND ")}`, args,
      ) as Record<string, unknown>[];
      for (const r of found) {
        const cpk = Object.fromEntries(childPk.map((c) => [c, r[c]]));
        const key = rowKey(f.childSchema, f.childTable, cpk);
        if (seen.has(key)) continue;
        seen.add(key);
        const childRow: CascadeRow = { schema: f.childSchema, table: f.childTable, pk: cpk, depth: node.depth + 1 };
        rows.push(childRow);
        queue.push(childRow);
        if (rows.length >= maxRows) { truncated = true; queue.length = 0; break; }
      }
      if (truncated) break;
    }
  }

  const counts = new Map<string, number>();
  let maxDepthSeen = 0;
  for (const r of rows) {
    counts.set(`${r.schema}.${r.table}`, (counts.get(`${r.schema}.${r.table}`) ?? 0) + 1);
    if (r.depth > maxDepthSeen) maxDepthSeen = r.depth;
  }
  const byTable = [...counts].map(([k, count]) => { const [s, t] = k.split("."); return { schema: s, table: t, count }; });
  return { rows, byTable, maxDepth: maxDepthSeen, truncated };
}

export async function executeCascade(
  schema: string, table: string, pk: Record<string, unknown>, opts: { dropTenantSchema?: string | null },
): Promise<{ deleted: number; droppedSchema: string | null }> {
  const actor = await currentActor();
  const radius = await computeBlastRadius(schema, table, pk);
  if (radius.truncated) throw new Error("Blast radius exceeds configured caps; refusing to cascade. Raise CASCADE_MAX_ROWS/DEPTH or narrow the target.");

  const involvedTables: TableRef[] = [...new Set(radius.rows.map((r) => `${r.schema}.${r.table}`))]
    .map((k) => { const [s, t] = k.split("."); return { schema: s, table: t }; });
  const allFks: ForeignKey[] = [];
  for (const s of new Set(involvedTables.map((t) => t.schema))) allFks.push(...await listForeignKeys(s));
  const { order } = orderTablesForDeletion(involvedTables, allFks);

  const rowsByTable = new Map<string, CascadeRow[]>();
  for (const r of radius.rows) {
    const k = `${r.schema}.${r.table}`;
    if (!rowsByTable.has(k)) rowsByTable.set(k, []);
    rowsByTable.get(k)!.push(r);
  }

  return withTransaction(null, async (tx) => {
    let deleted = 0;
    for (const t of order) {
      const list = rowsByTable.get(`${t.schema}.${t.table}`) ?? [];
      for (const r of list) {
        const keys = Object.keys(r.pk);
        const clause = keys.map((k, i) => `${ident(k)} = $${i + 1}`).join(" AND ");
        const args = keys.map((k) => r.pk[k]);
        const oldRows = await tx.unsafe(`SELECT * FROM ${qualified(t.schema, t.table)} WHERE ${clause}`, args);
        await tx.unsafe(`DELETE FROM ${qualified(t.schema, t.table)} WHERE ${clause}`, args);
        await writeAudit(tx, { actor, schemaName: t.schema, tableName: t.table, operation: "CASCADE_DELETE",
          pk: r.pk, oldValues: oldRows[0] ?? null, newValues: null, statement: `DELETE FROM ${qualified(t.schema, t.table)}` });
        deleted += 1;
      }
    }
    let droppedSchema: string | null = null;
    if (opts.dropTenantSchema) {
      await tx.unsafe(`DROP SCHEMA ${ident(opts.dropTenantSchema)} CASCADE`);
      droppedSchema = opts.dropTenantSchema;
      await writeAudit(tx, { actor, schemaName: opts.dropTenantSchema, tableName: null, operation: "DROP_SCHEMA",
        pk: null, oldValues: null, newValues: null, statement: `DROP SCHEMA ${ident(opts.dropTenantSchema)} CASCADE` });
    }
    return { deleted, droppedSchema };
  });
}
```

- [ ] **Step 4: Run it — expect PASS.** Run: `npm test -- cascade.int`

- [ ] **Step 5: Commit**

```bash
git add lib/cascade.ts lib/__tests__/cascade.int.test.ts
git commit -m "feat: FK-graph cascade blast-radius and executor"
```

---

### Task 17: Delete preview page + confirm action

**Files:**
- Create: `server/delete.ts`, `app/(god)/[schema]/[table]/delete/page.tsx`, `components/confirm-delete.tsx`
- Test: covered by Task 16 integration (server action is a thin wrapper); add `lib/__tests__/delete-confirm.test.ts` for the confirm-phrase logic.

**Interfaces:**
- Consumes: `computeBlastRadius`/`executeCascade` (Task 16), `env` (Task 2), `resolveTenantSchema`/`listBusinessUnits` (Task 7).
- Produces:
  - `lib/delete-confirm.ts`: `requiredPhrase(opts: { isBusinessUnit: boolean; dropSchema: string | null }): string` — returns the schema name when dropping a tenant schema, else `"DELETE"`. `phraseMatches(input: string, required: string): boolean`.
  - `server/delete.ts`: `confirmDelete(schema, table, pkJson, formData): Promise<void>` — validates the typed phrase (server-side), reads the `dropSchema` checkbox, calls `executeCascade`, redirects to the table. Rejects if the phrase doesn't match.

- [ ] **Step 1: Write the failing test** — `lib/__tests__/delete-confirm.test.ts`

```ts
import { expect, test } from "vitest";
import { requiredPhrase, phraseMatches } from "@/lib/delete-confirm";

test("plain delete requires DELETE", () => {
  expect(requiredPhrase({ isBusinessUnit: false, dropSchema: null })).toBe("DELETE");
});
test("schema drop requires the schema name", () => {
  expect(requiredPhrase({ isBusinessUnit: true, dropSchema: "BL_FIFO" })).toBe("BL_FIFO");
});
test("phraseMatches is exact", () => {
  expect(phraseMatches("DELETE", "DELETE")).toBe(true);
  expect(phraseMatches(" delete ", "DELETE")).toBe(false);
});
```

- [ ] **Step 2: Run it — expect FAIL.** Run: `npm test -- delete-confirm`

- [ ] **Step 3: Implement `lib/delete-confirm.ts`**

```ts
export function requiredPhrase(opts: { isBusinessUnit: boolean; dropSchema: string | null }): string {
  return opts.dropSchema ? opts.dropSchema : "DELETE";
}
export function phraseMatches(input: string, required: string): boolean {
  return input === required;
}
```

- [ ] **Step 4: Run it — expect PASS.** Run: `npm test -- delete-confirm`

- [ ] **Step 5: Implement `server/delete.ts`**

```ts
"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { env } from "@/lib/env";
import { executeCascade } from "@/lib/cascade";
import { requiredPhrase, phraseMatches } from "@/lib/delete-confirm";
import { resolveTenantSchema } from "@/lib/registry";

export async function confirmDelete(schema: string, table: string, pkJson: string, formData: FormData): Promise<void> {
  const pk = JSON.parse(pkJson) as Record<string, unknown>;
  const isBusinessUnit = schema === env().systemSchemaName && table === "tb_business_unit";
  let dropSchema: string | null = null;
  if (isBusinessUnit && formData.get("drop_schema") === "on") {
    dropSchema = await resolveTenantSchema(String(pk.id));
  }
  const phrase = requiredPhrase({ isBusinessUnit, dropSchema });
  if (!phraseMatches(String(formData.get("confirm") ?? ""), phrase)) {
    throw new Error(`Confirmation text must equal "${phrase}"`);
  }
  await executeCascade(schema, table, pk, { dropTenantSchema: dropSchema });
  revalidatePath(`/${schema}/${table}`);
  redirect(`/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`);
}
```

- [ ] **Step 6: Implement `components/confirm-delete.tsx`**

```tsx
import type { BlastRadius } from "@/lib/cascade";

export function ConfirmDelete({
  schema, table, pkJson, radius, action, isBusinessUnit, tenantSchema, requiredPhrase,
}: {
  schema: string; table: string; pkJson: string; radius: BlastRadius;
  action: (fd: FormData) => void; isBusinessUnit: boolean; tenantSchema: string | null; requiredPhrase: string;
}) {
  return (
    <form action={action} className="max-w-2xl space-y-4">
      <div className="rounded border border-red-300 bg-red-50 p-3">
        <p className="font-semibold text-red-800">This permanently deletes {radius.rows.length} row(s) across {radius.byTable.length} table(s). Max depth {radius.maxDepth}.</p>
        {radius.truncated && <p className="mt-1 text-sm text-red-900">⚠ Blast radius hit the configured cap — execution will be refused until you narrow it or raise the caps.</p>}
      </div>
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left"><th>Table</th><th className="text-right">rows</th></tr></thead>
        <tbody>{radius.byTable.map((b) => (
          <tr key={`${b.schema}.${b.table}`} className="border-b"><td className="font-mono">{b.schema}.{b.table}</td><td className="text-right">{b.count}</td></tr>
        ))}</tbody>
      </table>

      {isBusinessUnit && tenantSchema && (
        <label className="flex items-center gap-2 rounded border border-amber-400 bg-amber-50 p-2 text-sm">
          <input type="checkbox" name="drop_schema" />
          Also <strong>DROP SCHEMA "{tenantSchema}" CASCADE</strong> (wipes the entire tenant database for this BU)
        </label>
      )}

      <div className="space-y-1">
        <label className="block text-sm">Type <code className="rounded bg-gray-200 px-1">{requiredPhrase}</code> to confirm:</label>
        <input name="confirm" autoComplete="off" className="w-full rounded border p-2" />
        <p className="text-xs text-gray-500">If you check the schema-drop box, the required phrase becomes the schema name.</p>
      </div>

      <button type="submit" className="rounded bg-red-600 px-4 py-2 font-semibold text-white" disabled={radius.truncated}>Permanently delete</button>
    </form>
  );
}
```

> Note: the required phrase shown is computed for the *current* checkbox state on the server. Because checking the box changes the required phrase, the page also renders a small inline script-free hint; the server action re-derives and re-validates the phrase authoritatively, so a stale hint can never cause a wrong-scope delete — it just makes the user re-submit.

- [ ] **Step 7: Implement `app/(god)/[schema]/[table]/delete/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import { env } from "@/lib/env";
import { computeBlastRadius } from "@/lib/cascade";
import { resolveTenantSchema } from "@/lib/registry";
import { requiredPhrase } from "@/lib/delete-confirm";
import { confirmDelete } from "@/server/delete";
import { ConfirmDelete } from "@/components/confirm-delete";
import { SchemaBanner } from "@/components/schema-banner";

export const dynamic = "force-dynamic";

export default async function DeletePage({
  params, searchParams,
}: { params: Promise<{ schema: string; table: string }>; searchParams: Promise<{ pk?: string }> }) {
  const { schema, table } = await params;
  const { pk: pkParam } = await searchParams;
  if (!pkParam) notFound();
  const pk = JSON.parse(pkParam) as Record<string, unknown>;
  const isBusinessUnit = schema === env().systemSchemaName && table === "tb_business_unit";
  const tenantSchema = isBusinessUnit ? await resolveTenantSchema(String(pk.id)) : null;
  const radius = await computeBlastRadius(schema, table, pk);
  const action = confirmDelete.bind(null, schema, table, JSON.stringify(pk));
  return (
    <div>
      <SchemaBanner schema={schema} />
      <h1 className="my-3 text-lg font-semibold font-mono">Delete from {schema}.{table}</h1>
      <ConfirmDelete schema={schema} table={table} pkJson={JSON.stringify(pk)} radius={radius}
        action={action} isBusinessUnit={isBusinessUnit} tenantSchema={tenantSchema}
        requiredPhrase={requiredPhrase({ isBusinessUnit, dropSchema: null })} />
    </div>
  );
}
```

- [ ] **Step 8: Typecheck + commit**

```bash
git add server/delete.ts lib/delete-confirm.ts components/confirm-delete.tsx app/\(god\)/\[schema\]/\[table\]/delete lib/__tests__/delete-confirm.test.ts
git commit -m "feat: cascade delete preview + type-to-confirm"
```

---

## Phase 5 — Raw SQL console

### Task 18: SQL console (dry-run via rollback, commit on apply)

**Files:**
- Create: `lib/sql-runner.ts`, `server/sql.ts`, `app/(god)/[schema]/sql/page.tsx`, `components/sql-console.tsx`
- Test: `lib/__tests__/sql-runner.int.test.ts`

**Interfaces:**
- Consumes: `withTransaction`/`getSql` (Task 4), `classifyStatement` (Task 3), `writeAudit` (Task 12), `currentActor` (Task 13).
- Produces in `lib/sql-runner.ts`:
  - `export type SqlResult = { kind: "read"; columns: string[]; rows: Record<string, unknown>[]; rowCount: number } | { kind: "write-preview"; affected: number } | { kind: "write-applied"; affected: number }`.
  - `runRead(schema: string, statement: string): Promise<SqlResult>` — executes a read in a `search_path`-scoped transaction (rolled back); returns rows.
  - `previewWrite(schema: string, statement: string): Promise<SqlResult>` — runs the write in a transaction, captures `affected`, then **rolls back** (throws a sentinel to force rollback). Returns the affected count without committing.
  - `applyWrite(schema: string, statement: string): Promise<SqlResult>` — runs the write in a transaction, writes a `RAW_SQL` audit row, commits. Returns affected count.

- [ ] **Step 1: Write the failing integration test** — `lib/__tests__/sql-runner.int.test.ts`

```ts
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { startPg } from "@/test/pg";

let container: StartedPostgreSqlContainer;
beforeAll(async () => {
  const pg = await startPg();
  container = pg.container;
  process.env.DATABASE_URL = pg.url;
  process.env.SYSTEM_DATABASE_URL = pg.url;
  process.env.SYSTEM_SCHEMA_NAME = "CARMEN_SYSTEM";
  process.env.GOD_MODE_PASSWORD = "x";
  process.env.SESSION_SECRET = "x".repeat(32);
  vi.mock("@/lib/session", () => ({ getSession: async () => ({ actor: "tester", authed: true }) }));
  const { getSql } = await import("@/lib/db");
  await getSql().unsafe(`
    CREATE SCHEMA "CARMEN_SYSTEM"; CREATE SCHEMA app;
    CREATE TABLE app.item (id int primary key, name text);
    INSERT INTO app.item VALUES (1,'a'),(2,'b'),(3,'c');
  `);
  const { ensureAuditTable } = await import("@/lib/audit");
  await ensureAuditTable();
});
afterAll(async () => { await container.stop(); });

test("runRead returns rows", async () => {
  const { runRead } = await import("@/lib/sql-runner");
  const r = await runRead("app", "SELECT * FROM item ORDER BY id");
  expect(r.kind).toBe("read");
  if (r.kind === "read") expect(r.rowCount).toBe(3);
});

test("previewWrite does not persist", async () => {
  const { previewWrite } = await import("@/lib/sql-runner");
  const { getSql } = await import("@/lib/db");
  const r = await previewWrite("app", "DELETE FROM item WHERE id <= 2");
  expect(r.kind).toBe("write-preview");
  if (r.kind === "write-preview") expect(r.affected).toBe(2);
  const left = await getSql().unsafe(`SELECT count(*)::int n FROM app.item`);
  expect(left[0].n).toBe(3); // unchanged
});

test("applyWrite persists and audits", async () => {
  const { applyWrite } = await import("@/lib/sql-runner");
  const { getSql } = await import("@/lib/db");
  const r = await applyWrite("app", "DELETE FROM item WHERE id = 3");
  if (r.kind === "write-applied") expect(r.affected).toBe(1);
  const left = await getSql().unsafe(`SELECT count(*)::int n FROM app.item`);
  expect(left[0].n).toBe(2);
  const { listAudit } = await import("@/lib/audit");
  const audit = await listAudit({ operation: "RAW_SQL", limit: 1 });
  expect(audit[0].statement).toContain("DELETE FROM item WHERE id = 3");
});
```

- [ ] **Step 2: Run it — expect FAIL.** Run: `npm test -- sql-runner.int`

- [ ] **Step 3: Implement `lib/sql-runner.ts`**

```ts
import { withTransaction } from "@/lib/db";
import { ident } from "@/lib/sql-guard";
import { writeAudit } from "@/lib/audit";
import { currentActor } from "@/lib/write";

export type SqlResult =
  | { kind: "read"; columns: string[]; rows: Record<string, unknown>[]; rowCount: number }
  | { kind: "write-preview"; affected: number }
  | { kind: "write-applied"; affected: number };

const ROLLBACK = Symbol("rollback-preview");

export async function runRead(schema: string, statement: string): Promise<SqlResult> {
  return withTransaction(schema, async (tx) => {
    const rows = (await tx.unsafe(statement)) as unknown as Record<string, unknown>[];
    const columns = rows.length ? Object.keys(rows[0]) : [];
    return { kind: "read", columns, rows: rows.slice(0, 500), rowCount: rows.length };
  });
}

export async function previewWrite(schema: string, statement: string): Promise<SqlResult> {
  let affected = 0;
  try {
    await withTransaction(schema, async (tx) => {
      const res: any = await tx.unsafe(statement);
      affected = typeof res?.count === "number" ? res.count : Array.isArray(res) ? res.length : 0;
      throw ROLLBACK; // force rollback — preview only
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
  return { kind: "write-preview", affected };
}

export async function applyWrite(schema: string, statement: string): Promise<SqlResult> {
  const actor = await currentActor();
  return withTransaction(schema, async (tx) => {
    const res: any = await tx.unsafe(statement);
    const affected = typeof res?.count === "number" ? res.count : Array.isArray(res) ? res.length : 0;
    await writeAudit(tx, { actor, schemaName: schema, tableName: null, operation: "RAW_SQL", pk: null, oldValues: null, newValues: null, statement });
    return { kind: "write-applied", affected };
  });
}
```

> Caveat to document in the UI: a non-deterministic write (e.g. uses `now()`, `random()`, or `RETURNING` of generated values) runs once for preview (rolled back) and again on apply, so generated values may differ between preview and apply. The affected-row **count** is the contract, not row-identity.

- [ ] **Step 4: Run it — expect PASS.** Run: `npm test -- sql-runner.int`

- [ ] **Step 5: Implement `server/sql.ts`**

```ts
"use server";
import { classifyStatement } from "@/lib/sql-guard";
import { runRead, previewWrite, applyWrite, type SqlResult } from "@/lib/sql-runner";

export async function runSql(schema: string, statement: string): Promise<SqlResult> {
  const s = statement.trim();
  if (!s) throw new Error("Empty statement");
  return classifyStatement(s) === "read" ? runRead(schema, s) : previewWrite(schema, s);
}

export async function applySql(schema: string, statement: string): Promise<SqlResult> {
  const s = statement.trim();
  if (classifyStatement(s) === "read") return runRead(schema, s);
  return applyWrite(schema, s);
}
```

- [ ] **Step 6: Implement `components/sql-console.tsx`** (client component)

```tsx
"use client";
import { useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { sql as sqlLang } from "@codemirror/lang-sql";
import { runSql, applySql } from "@/server/sql";
import type { SqlResult } from "@/lib/sql-runner";

export function SqlConsole({ schema }: { schema: string }) {
  const [text, setText] = useState("SELECT 1");
  const [result, setResult] = useState<SqlResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: (s: string, q: string) => Promise<SqlResult>) {
    setBusy(true); setError(null);
    try { setResult(await fn(schema, text)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setResult(null); }
    finally { setBusy(false); }
  }

  const isWritePreview = result?.kind === "write-preview";
  return (
    <div className="space-y-3">
      <CodeMirror value={text} height="200px" extensions={[sqlLang()]} onChange={setText} />
      <div className="flex gap-2">
        <button disabled={busy} onClick={() => run(runSql)} className="rounded bg-black px-3 py-1.5 text-white">Run</button>
        {isWritePreview && (
          <button disabled={busy} onClick={() => run(applySql)} className="rounded bg-red-600 px-3 py-1.5 text-white">
            Commit ({(result as any).affected} rows)
          </button>
        )}
      </div>
      {error && <pre className="whitespace-pre-wrap rounded bg-red-50 p-3 text-sm text-red-800">{error}</pre>}
      {result?.kind === "read" && (
        <div className="overflow-x-auto">
          <p className="text-sm text-gray-500">{result.rowCount} rows</p>
          <table className="min-w-full text-sm"><thead><tr className="border-b text-left">
            {result.columns.map((c) => <th key={c} className="px-2 py-1 font-mono">{c}</th>)}
          </tr></thead><tbody>
            {result.rows.map((r, i) => <tr key={i} className="border-b">{result.columns.map((c) => <td key={c} className="max-w-xs truncate px-2 py-1">{fmt(r[c])}</td>)}</tr>)}
          </tbody></table>
        </div>
      )}
      {isWritePreview && <p className="rounded bg-amber-100 p-2 text-sm">Preview only — {(result as any).affected} row(s) would change. Nothing committed yet. Press Commit to apply.</p>}
      {result?.kind === "write-applied" && <p className="rounded bg-green-100 p-2 text-sm">Applied — {(result as any).affected} row(s) changed and audited.</p>}
    </div>
  );
}
function fmt(v: unknown): string { return v === null || v === undefined ? "∅" : typeof v === "object" ? JSON.stringify(v) : String(v); }
```

- [ ] **Step 7: Implement `app/(god)/[schema]/sql/page.tsx`**

```tsx
import { SqlConsole } from "@/components/sql-console";
import { SchemaBanner } from "@/components/schema-banner";

export const dynamic = "force-dynamic";

export default async function SqlPage({ params }: { params: Promise<{ schema: string }> }) {
  const { schema } = await params;
  return (
    <div>
      <SchemaBanner schema={schema} />
      <h1 className="my-3 text-lg font-semibold">SQL console — {schema}</h1>
      <p className="mb-2 text-sm text-gray-600">Reads run immediately. Writes run in a transaction, show affected rows, and require an explicit Commit. Every executed statement is audited.</p>
      <SqlConsole schema={schema} />
    </div>
  );
}
```

- [ ] **Step 8: Typecheck + commit**

```bash
git add lib/sql-runner.ts server/sql.ts components/sql-console.tsx app/\(god\)/\[schema\]/sql lib/__tests__/sql-runner.int.test.ts
git commit -m "feat: wrapped raw SQL console with preview/commit"
```

---

## Phase 6 — Audit viewer + E2E smoke

### Task 19: Audit viewer page (`/audit`)

**Files:**
- Create: `app/(god)/audit/page.tsx`

**Interfaces:**
- Consumes: `listAudit` (Task 12).
- Produces: a filterable table of audit entries (at, actor, schema.table, operation, pk, links/expanders to old/new JSON).

- [ ] **Step 1: Implement `app/(god)/audit/page.tsx`**

```tsx
import { listAudit, type Operation } from "@/lib/audit";

export const dynamic = "force-dynamic";
const OPS: Operation[] = ["INSERT", "UPDATE", "DELETE", "CASCADE_DELETE", "DROP_SCHEMA", "RAW_SQL"];

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ schema?: string; table?: string; operation?: string }> }) {
  const sp = await searchParams;
  const entries = await listAudit({ schema: sp.schema, table: sp.table, operation: sp.operation as Operation | undefined, limit: 200 });
  return (
    <div>
      <h1 className="my-3 text-lg font-semibold">Audit log</h1>
      <form className="mb-3 flex gap-2 text-sm">
        <input name="schema" defaultValue={sp.schema ?? ""} placeholder="schema" className="rounded border p-1" />
        <input name="table" defaultValue={sp.table ?? ""} placeholder="table" className="rounded border p-1" />
        <select name="operation" defaultValue={sp.operation ?? ""} className="rounded border p-1">
          <option value="">any op</option>
          {OPS.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <button className="rounded bg-black px-3 text-white">Filter</button>
      </form>
      <table className="min-w-full text-sm">
        <thead><tr className="border-b text-left"><th>at</th><th>actor</th><th>target</th><th>op</th><th>pk</th><th>before→after</th></tr></thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-b align-top">
              <td className="whitespace-nowrap py-1">{e.at}</td>
              <td>{e.actor}</td>
              <td className="font-mono">{e.schemaName}{e.tableName ? `.${e.tableName}` : ""}</td>
              <td>{e.operation}</td>
              <td className="font-mono text-xs">{e.pk ? JSON.stringify(e.pk) : ""}</td>
              <td className="max-w-md">
                <details><summary className="cursor-pointer text-gray-500">view</summary>
                  <pre className="whitespace-pre-wrap text-xs">old: {JSON.stringify(e.oldValues, null, 2)}{"\n"}new: {JSON.stringify(e.newValues, null, 2)}{e.statement ? `\nsql: ${e.statement}` : ""}</pre>
                </details>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/\(god\)/audit/page.tsx
git commit -m "feat: audit log viewer"
```

---

### Task 20: E2E smoke + README + provisioning

**Files:**
- Create: `playwright.config.ts`, `e2e/smoke.spec.ts`, `README.md`
- Modify: `.gitignore` (ensure `.env*` ignored)

**Interfaces:**
- Consumes: the full running app.
- Produces: a Playwright login-gate smoke test and operator docs.

- [ ] **Step 1: Install Playwright**

```bash
npm i -D @playwright/test
npx playwright install chromium
```

- [ ] **Step 2: Write `playwright.config.ts`**

```ts
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  webServer: { command: "npm run dev", url: "http://localhost:3000/login", reuseExistingServer: true, timeout: 60_000 },
  use: { baseURL: "http://localhost:3000" },
});
```

- [ ] **Step 3: Write `e2e/smoke.spec.ts`** (asserts the auth gate redirects)

```ts
import { test, expect } from "@playwright/test";

test("unauthed user is redirected to login", async ({ page }) => {
  await page.goto("/schemas");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText("God Mode")).toBeVisible();
});
```

- [ ] **Step 4: Run it** (requires a reachable DB or a stubbed env for `next dev`; if dev server needs DB env, set dummy `DATABASE_URL`/secrets in `.env.local` first)

Run: `npx playwright test`
Expected: 1 passed.

- [ ] **Step 5: Write `README.md`**

````markdown
# Carmen Inventory God Mode

Direct admin tool for the Carmen inventory PostgreSQL database. **Every change is
permanent — there is no undo.** The audit log is the only recovery record.

## Setup
1. `cp .env.example .env.local` and fill in `GOD_MODE_PASSWORD`, `SESSION_SECRET` (>=32 chars), and the DB URLs.
2. `npm install`
3. `npm run migrate`  # creates CARMEN_SYSTEM.tb_god_mode_audit
4. `npm run dev`

## Tests
- `npm test` — unit + integration (integration needs Docker for Testcontainers).
- `npx playwright test` — light E2E.

## Safety
- Shared-secret login; cookie session.
- Deletes show a blast-radius preview and require typing a confirm phrase.
- Deleting a business unit can optionally `DROP SCHEMA` its tenant database (off by default; requires typing the schema name).
- Raw SQL writes require an explicit Commit after a preview.
- `CASCADE_MAX_ROWS` / `CASCADE_MAX_DEPTH` cap the blast radius; an over-cap cascade is refused.
````

- [ ] **Step 6: Final typecheck, full test run, commit**

Run: `npm run typecheck && npm test`
```bash
git add playwright.config.ts e2e/smoke.spec.ts README.md .gitignore
git commit -m "test: e2e smoke + operator README"
```

---

## Self-Review (completed by plan author)

**Spec coverage check:**
- Hybrid generic browser + curated registry home → Tasks 9–11. ✓
- System=registry model, resolve tenant schema from `db_connection` jsonb → Task 7. ✓
- Shared-secret auth + cookie + middleware → Task 5. ✓
- Safety net: audit (Task 12–13), type-to-confirm (Task 17), preview-before-apply (Task 17 + 18). ✓
- Operations: UPDATE/INSERT (Task 14), single DELETE (Task 13), cascade DELETE (Tasks 15–17), raw SQL (Task 18). ✓
- Cascade via runtime FK introspection, children-first, one txn, optional DROP SCHEMA, per-deletion checkbox → Tasks 16–17. ✓
- One DB / many schemas, PgBouncer `prepare:false`, identifier guard → Tasks 3–4, Global Constraints. ✓
- Audit viewer → Task 19. Schema banner → Task 8. Error handling = surface real PG errors (SQL console + actions throw raw messages) → Tasks 17–18. Testing strategy → unit + Testcontainers integration + Playwright throughout. Config/env → Task 2. ✓
- Out-of-scope items intentionally absent. ✓

**Placeholder scan:** No TBD/TODO; every code step contains runnable code. ✓
**Type consistency:** `BlastRadius`/`CascadeRow`/`ForeignKey`/`ColumnInfo`/`AuditEntry`/`SqlResult` names used consistently across producing and consuming tasks; `whereFromPk`, `currentActor`, `ident`, `qualified`, `classifyStatement` referenced with the signatures they are defined with. ✓
