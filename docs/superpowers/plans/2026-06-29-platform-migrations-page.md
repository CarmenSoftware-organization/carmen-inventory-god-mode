# Platform Migrations Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a god-mode admin page that runs the migration scripts (Prisma migrations, tenant views, seeds) of the sibling `@repo/prisma-shared-schema-platform` package against the DB this god-mode instance manages, streaming live subprocess output.

**Architecture:** A new `/platform-migrations` page POSTs to `app/api/ops/platform-migrate/route.ts`, which `spawn`s the package's own `bun run db:*` commands (and `bun x prisma migrate status`) in the sibling package dir, with god-mode's DB connection injected into the subprocess env. Each stdout/stderr line is streamed back as an NDJSON `log` event (a new event type on the existing streaming-progress mechanism) and rendered in a live `<pre>`. Writes require a typed confirm phrase (the DB name) re-validated server-side; destructive resets require a second gate.

**Tech Stack:** Next.js 16 (Route Handlers, React Server Components), `postgres` lib, Node `child_process.spawn`, Vitest, Playwright, Tailwind v4.

## Global Constraints

- Run tests with `bun run test` (Vitest) — **never** `bun test`. `.test.ts` → node env; `.int.test.ts` → embedded-postgres via `@/test/pg` `startPg()`.
- Route/unit tests mock `@/lib/session` (`requireAuth`) and, where used, `next/cache` (`revalidatePath`).
- Subprocesses are spawned with an **argument array and `shell: false`** — never a shell string. All user-supplied args are validated against an allow-list before use.
- SQL writes go through `lib/sql-guard` helpers; audit every operation via `lib/audit`.
- Keep **new** files lint-clean (`bun run lint`); do **not** fix unrelated pre-existing lint.
- Per `AGENTS.md`: before writing Next.js route/page code, consult `node_modules/next/dist/docs/` for current conventions (Route Handlers, RSC).
- Dev server port is **3305** (set via `PORT`).
- The app is launched via `bun`, so `bun` is on PATH for the spawned subprocess; `psql` must also be on PATH for tenant-view ops.
- Commit message footer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `lib/env.ts` (modify) | Add `SYSTEM_DIRECT_URL` (default = `SYSTEM_DATABASE_URL`) and `PLATFORM_PACKAGE_DIR` (optional) |
| `lib/progress.ts` (modify) | Add `{ type: "log"; line; stream? }` event |
| `lib/operation-stream.ts` (modify) | Accumulate a bounded `logs` buffer in `OperationState` |
| `lib/run-process.ts` (create) | `spawn`-based runner: stream stdout/stderr lines → `onLine`, resolve `{ code }` |
| `lib/platform-package.ts` (create) | Resolve package dir, build subprocess env, parse/mask target DB, `psql` preflight, list tenant files |
| `lib/platform-migrations.ts` (create) | Command catalog + arg validation + argv builder + run-gating (pure) |
| `lib/audit.ts` (modify) | Add `"MIGRATION"` to the `Operation` union |
| `app/api/ops/platform-migrate/route.ts` (create) | Auth → validate args → confirm gates → preflight → stream subprocess → audit |
| `components/operation-log.tsx` (create) | Render `state.logs` in a live scrolling `<pre>` |
| `components/platform-migrations.tsx` (create) | Op picker (grouped), arg inputs, confirm gates, Run, live log |
| `app/(god)/platform-migrations/page.tsx` (create) | Server page: preload catalog + active BU codes + tenant files + target DB |
| `app/(god)/layout.tsx` (modify) | Add "Platform migrations" nav link |
| `README.md`, `CLAUDE.md` (modify) | Document env vars + the new page |

---

## Task 1: Env additions (`SYSTEM_DIRECT_URL`, `PLATFORM_PACKAGE_DIR`)

**Files:**
- Modify: `lib/env.ts`
- Test: `lib/__tests__/env.test.ts`

**Interfaces:**
- Produces: `Env` gains `systemDirectUrl: string` and `platformPackageDir?: string`. `loadEnv(raw)` unchanged signature.

- [ ] **Step 1: Write the failing tests** — append to `lib/__tests__/env.test.ts`:

```ts
test("systemDirectUrl defaults to systemDatabaseUrl when SYSTEM_DIRECT_URL unset", () => {
  const env = loadEnv(base);
  expect(env.systemDirectUrl).toBe(base.SYSTEM_DATABASE_URL);
});

test("systemDirectUrl uses SYSTEM_DIRECT_URL when present", () => {
  const env = loadEnv({ ...base, SYSTEM_DIRECT_URL: "postgresql://u:p@direct:5432/postgres" });
  expect(env.systemDirectUrl).toBe("postgresql://u:p@direct:5432/postgres");
});

test("platformPackageDir is undefined by default and passes through when set", () => {
  expect(loadEnv(base).platformPackageDir).toBeUndefined();
  expect(loadEnv({ ...base, PLATFORM_PACKAGE_DIR: "/x/pkg" }).platformPackageDir).toBe("/x/pkg");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test lib/__tests__/env.test.ts`
Expected: FAIL (`systemDirectUrl`/`platformPackageDir` undefined on `Env`).

- [ ] **Step 3: Implement** — in `lib/env.ts`, add to the zod `schema` object:

```ts
  SYSTEM_DIRECT_URL: z.string().min(1).optional(),
  PLATFORM_PACKAGE_DIR: z.string().min(1).optional(),
```

Add to the `Env` type:

```ts
  systemDirectUrl: string;
  platformPackageDir?: string;
```

Add to the object returned by `loadEnv`:

```ts
    systemDirectUrl: p.SYSTEM_DIRECT_URL ?? p.SYSTEM_DATABASE_URL,
    platformPackageDir: p.PLATFORM_PACKAGE_DIR,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test lib/__tests__/env.test.ts`
Expected: PASS (all env tests).

- [ ] **Step 5: Typecheck + commit**

```bash
bun run typecheck
git add lib/env.ts lib/__tests__/env.test.ts
git commit -m "feat(env): add SYSTEM_DIRECT_URL and PLATFORM_PACKAGE_DIR

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `log` progress event + log buffer

**Files:**
- Modify: `lib/progress.ts`
- Modify: `lib/operation-stream.ts`
- Test: `lib/__tests__/progress.test.ts`, `lib/__tests__/operation-stream.test.ts`

**Interfaces:**
- Consumes: existing `ProgressEvent`, `OperationState`, `reduceOperation`.
- Produces: `ProgressEvent` gains `{ type: "log"; line: string; stream?: "out" | "err" }`. `OperationState` gains `logs?: string[]` (bounded to last 1000). `reduceOperation` handles `"log"`.

- [ ] **Step 1: Write the failing tests** — append to `lib/__tests__/progress.test.ts`:

```ts
test("passes log events through the stream verbatim", async () => {
  const res = streamOperation(async (onProgress) => {
    onProgress({ type: "log", line: "hello", stream: "out" });
    onProgress({ type: "log", line: "oops", stream: "err" });
    return { summary: "done" };
  });
  expect(await collect(res)).toEqual([
    { type: "log", line: "hello", stream: "out" },
    { type: "log", line: "oops", stream: "err" },
    { type: "done", summary: "done", redirect: undefined },
  ]);
});
```

And append to `lib/__tests__/operation-stream.test.ts`:

```ts
import { reduceOperation, initialOperationState } from "@/lib/operation-stream";

test("log events accumulate into state.logs and set phase running", () => {
  let s = reduceOperation(initialOperationState, { type: "log", line: "a" });
  s = reduceOperation(s, { type: "log", line: "b", stream: "err" });
  expect(s.phase).toBe("running");
  expect(s.logs).toEqual(["a", "b"]);
});

test("log buffer is bounded to the last 1000 lines", () => {
  let s = initialOperationState;
  for (let i = 0; i < 1100; i++) s = reduceOperation(s, { type: "log", line: `L${i}` });
  expect(s.logs!.length).toBe(1000);
  expect(s.logs![0]).toBe("L100");
  expect(s.logs!.at(-1)).toBe("L1099");
});
```

> Note: `lib/__tests__/operation-stream.test.ts` already exists; add these tests and the import if not already present.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test lib/__tests__/progress.test.ts lib/__tests__/operation-stream.test.ts`
Expected: FAIL (`"log"` not a known event type / `logs` undefined).

- [ ] **Step 3: Implement**

In `lib/progress.ts`, extend the `ProgressEvent` union:

```ts
export type ProgressEvent =
  | { type: "step"; label: string; done?: number }
  | { type: "total"; total: number; title?: string }
  | { type: "log"; line: string; stream?: "out" | "err" }
  | { type: "done"; summary: string; redirect?: string }
  | { type: "error"; message: string };
```

In `lib/operation-stream.ts`, add `logs?: string[]` to `OperationState` and a `"log"` case to `reduceOperation`:

```ts
    case "log": {
      const next = [...(prev.logs ?? []), event.line];
      return { ...prev, phase: "running", logs: next.length > 1000 ? next.slice(-1000) : next };
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test lib/__tests__/progress.test.ts lib/__tests__/operation-stream.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
bun run typecheck
git add lib/progress.ts lib/operation-stream.ts lib/__tests__/progress.test.ts lib/__tests__/operation-stream.test.ts
git commit -m "feat(progress): add log event + bounded log buffer

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Subprocess runner (`lib/run-process.ts`)

**Files:**
- Create: `lib/run-process.ts`
- Test: `lib/__tests__/run-process.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ProcessResult = { code: number };
  export function runProcess(opts: {
    command: string;
    args: string[];
    cwd: string;
    env: NodeJS.ProcessEnv;
    onLine: (line: string, stream: "out" | "err") => void;
  }): Promise<ProcessResult>;
  ```

- [ ] **Step 1: Write the failing test** — create `lib/__tests__/run-process.test.ts`:

```ts
import { expect, test } from "vitest";
import { runProcess } from "@/lib/run-process";

test("streams stdout and stderr lines and resolves with exit code 0", async () => {
  const lines: { line: string; stream: string }[] = [];
  const res = await runProcess({
    command: process.execPath, // node
    args: ["-e", "process.stdout.write('a\\nb\\n'); process.stderr.write('e1\\n')"],
    cwd: process.cwd(),
    env: process.env,
    onLine: (line, stream) => lines.push({ line, stream }),
  });
  expect(res.code).toBe(0);
  expect(lines).toContainEqual({ line: "a", stream: "out" });
  expect(lines).toContainEqual({ line: "b", stream: "out" });
  expect(lines).toContainEqual({ line: "e1", stream: "err" });
});

test("captures a non-zero exit code", async () => {
  const res = await runProcess({
    command: process.execPath,
    args: ["-e", "process.exit(3)"],
    cwd: process.cwd(),
    env: process.env,
    onLine: () => {},
  });
  expect(res.code).toBe(3);
});

test("flushes a trailing line with no newline", async () => {
  const lines: string[] = [];
  await runProcess({
    command: process.execPath,
    args: ["-e", "process.stdout.write('no-newline')"],
    cwd: process.cwd(),
    env: process.env,
    onLine: (line) => lines.push(line),
  });
  expect(lines).toContain("no-newline");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test lib/__tests__/run-process.test.ts`
Expected: FAIL (`Cannot find module '@/lib/run-process'`).

- [ ] **Step 3: Implement** — create `lib/run-process.ts`:

```ts
import { spawn } from "node:child_process";

export type ProcessResult = { code: number };

export function runProcess(opts: {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  onLine: (line: string, stream: "out" | "err") => void;
}): Promise<ProcessResult> {
  return new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(opts.command, opts.args, { cwd: opts.cwd, env: opts.env, shell: false });

    const splitter = (stream: "out" | "err") => {
      let buf = "";
      return {
        push(chunk: string) {
          buf += chunk;
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            opts.onLine(buf.slice(0, nl).replace(/\r$/, ""), stream);
            buf = buf.slice(nl + 1);
          }
        },
        flush() {
          if (buf.length) { opts.onLine(buf.replace(/\r$/, ""), stream); buf = ""; }
        },
      };
    };

    const out = splitter("out");
    const err = splitter("err");
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c: string) => out.push(c));
    child.stderr.on("data", (c: string) => err.push(c));
    child.on("error", reject);
    child.on("close", (code) => { out.flush(); err.flush(); resolve({ code: code ?? 0 }); });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test lib/__tests__/run-process.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
bun run typecheck
git add lib/run-process.ts lib/__tests__/run-process.test.ts
git commit -m "feat(run-process): spawn-based line-streaming subprocess runner

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Platform package resolver (`lib/platform-package.ts`)

**Files:**
- Create: `lib/platform-package.ts`
- Test: `lib/__tests__/platform-package.test.ts`

**Interfaces:**
- Consumes: `env()` from `@/lib/env` (`systemDatabaseUrl`, `systemDirectUrl`, `systemSchemaName`, `platformPackageDir`).
- Produces:
  ```ts
  export function packageDir(): string;
  export async function assertPackageDir(): Promise<void>;
  export function buildSubprocessEnv(): NodeJS.ProcessEnv;
  export function targetDbInfo(): { host: string; database: string; schema: string; masked: string };
  export async function assertPsql(): Promise<void>;
  export async function listTenantFiles(): Promise<string[]>; // basenames of migrations/tenant/*.up.sql, sorted
  ```

- [ ] **Step 1: Write the failing test** — create `lib/__tests__/platform-package.test.ts`:

```ts
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const base = {
  SYSTEM_DATABASE_URL: "postgresql://carmen_user:s3cret@db.example.com:6432/carmen_platform",
  DATABASE_URL: "postgresql://carmen_user:s3cret@db.example.com:6432/carmen_platform",
  SYSTEM_SCHEMA_NAME: "CARMEN_SYSTEM",
  GOD_MODE_PASSWORD: "x",
  SESSION_SECRET: "x".repeat(32),
};

beforeEach(() => { Object.assign(process.env, base); });
afterEach(() => { vi.resetModules(); for (const k of ["SYSTEM_DIRECT_URL", "PLATFORM_PACKAGE_DIR"]) delete process.env[k]; });

test("targetDbInfo parses host/database/schema and masks the password", async () => {
  vi.resetModules();
  const { targetDbInfo } = await import("@/lib/platform-package");
  const t = targetDbInfo();
  expect(t.host).toBe("db.example.com:6432");
  expect(t.database).toBe("carmen_platform");
  expect(t.schema).toBe("CARMEN_SYSTEM");
  expect(t.masked).toBe("postgresql://carmen_user@db.example.com:6432/carmen_platform");
  expect(t.masked).not.toContain("s3cret");
});

test("buildSubprocessEnv injects DB vars; SYSTEM_DIRECT_URL defaults to SYSTEM_DATABASE_URL", async () => {
  vi.resetModules();
  const { buildSubprocessEnv } = await import("@/lib/platform-package");
  const e = buildSubprocessEnv();
  expect(e.SYSTEM_DATABASE_URL).toBe(base.SYSTEM_DATABASE_URL);
  expect(e.SYSTEM_DIRECT_URL).toBe(base.SYSTEM_DATABASE_URL);
  expect(e.SYSTEM_SCHEMA_NAME).toBe("CARMEN_SYSTEM");
});

test("assertPackageDir resolves when package.json exists and throws otherwise", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pkg-"));
  await fs.writeFile(path.join(dir, "package.json"), "{}");
  process.env.PLATFORM_PACKAGE_DIR = dir;
  vi.resetModules();
  const { assertPackageDir, packageDir } = await import("@/lib/platform-package");
  expect(packageDir()).toBe(dir);
  await expect(assertPackageDir()).resolves.toBeUndefined();

  process.env.PLATFORM_PACKAGE_DIR = path.join(dir, "does-not-exist");
  vi.resetModules();
  const mod = await import("@/lib/platform-package");
  await expect(mod.assertPackageDir()).rejects.toThrow(/not found/);
});

test("listTenantFiles returns sorted *.up.sql basenames", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pkg-"));
  await fs.mkdir(path.join(dir, "migrations", "tenant"), { recursive: true });
  await fs.writeFile(path.join(dir, "migrations", "tenant", "002_b.up.sql"), "");
  await fs.writeFile(path.join(dir, "migrations", "tenant", "001_a.up.sql"), "");
  await fs.writeFile(path.join(dir, "migrations", "tenant", "001_a.down.sql"), "");
  process.env.PLATFORM_PACKAGE_DIR = dir;
  vi.resetModules();
  const { listTenantFiles } = await import("@/lib/platform-package");
  expect(await listTenantFiles()).toEqual(["001_a.up.sql", "002_b.up.sql"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test lib/__tests__/platform-package.test.ts`
Expected: FAIL (`Cannot find module '@/lib/platform-package'`).

- [ ] **Step 3: Implement** — create `lib/platform-package.ts`:

```ts
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { env } from "@/lib/env";

const execFileP = promisify(execFile);

const DEFAULT_REL = "../carmen-turborepo-backend-v2/packages/prisma-shared-schema-platform";

export function packageDir(): string {
  return env().platformPackageDir ?? path.resolve(process.cwd(), DEFAULT_REL);
}

export async function assertPackageDir(): Promise<void> {
  const dir = packageDir();
  try {
    await fs.access(path.join(dir, "package.json"));
  } catch {
    throw new Error(`Platform package not found at ${dir} (set PLATFORM_PACKAGE_DIR)`);
  }
}

export function buildSubprocessEnv(): NodeJS.ProcessEnv {
  const e = env();
  return {
    ...process.env,
    SYSTEM_DATABASE_URL: e.systemDatabaseUrl,
    SYSTEM_DIRECT_URL: e.systemDirectUrl,
    SYSTEM_SCHEMA_NAME: e.systemSchemaName,
  };
}

export function targetDbInfo(): { host: string; database: string; schema: string; masked: string } {
  const u = new URL(env().systemDatabaseUrl);
  const host = u.port ? `${u.hostname}:${u.port}` : u.hostname;
  const database = decodeURIComponent(u.pathname.replace(/^\//, ""));
  const masked = `${u.protocol}//${u.username}@${host}/${database}`;
  return { host, database, schema: env().systemSchemaName, masked };
}

export async function assertPsql(): Promise<void> {
  try {
    await execFileP("psql", ["--version"]);
  } catch {
    throw new Error("psql not found on PATH (required for tenant-view migrations)");
  }
}

export async function listTenantFiles(): Promise<string[]> {
  const dir = path.join(packageDir(), "migrations", "tenant");
  try {
    const all = await fs.readdir(dir);
    return all.filter((f) => f.endsWith(".up.sql")).sort();
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test lib/__tests__/platform-package.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
bun run typecheck
git add lib/platform-package.ts lib/__tests__/platform-package.test.ts
git commit -m "feat(platform-package): resolve pkg dir, build subprocess env, parse target DB

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Command catalog + validation (`lib/platform-migrations.ts`)

**Files:**
- Create: `lib/platform-migrations.ts`
- Test: `lib/__tests__/platform-migrations.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type OpGroup = "prisma" | "tenant" | "seed" | "danger";
  export type CatalogOp = {
    id: string;
    group: OpGroup;
    label: string;
    kind: "script" | "bin";   // "script" → bun run <run>; "bin" → bun <baseArgs>
    run: string;              // npm script name (kind="script"); informational for kind="bin"
    baseArgs?: string[];      // argv after "bun" for kind="bin"
    acceptsBu?: boolean;
    acceptsOnly?: boolean;
    writes: boolean;
    destructive: boolean;
    requiresPsql?: boolean;
    readonly?: boolean;       // read-only → no confirm
  };
  export const CATALOG: CatalogOp[];
  export function findOp(id: string): CatalogOp | undefined;
  export function validateBuCode(code: string, activeCodes: string[]): boolean;
  export function validateOnlyPrefix(prefix: string, fileNames: string[]): boolean;
  export function buildArgv(op: CatalogOp, args: { bu?: string; only?: string }): string[];
  export function canRun(op: CatalogOp, opts: { confirm: string; dbName: string; destroyChecked: boolean }): boolean;
  ```
- Consumed by: Task 6 (route), Task 7 (component), Task 8 (page).

- [ ] **Step 1: Write the failing test** — create `lib/__tests__/platform-migrations.test.ts`:

```ts
import { expect, test } from "vitest";
import {
  CATALOG, findOp, validateBuCode, validateOnlyPrefix, buildArgv, canRun,
} from "@/lib/platform-migrations";

test("catalog exposes the expected operation ids across groups", () => {
  const ids = CATALOG.map((o) => o.id);
  expect(ids).toEqual(expect.arrayContaining([
    "prisma-status", "prisma-deploy",
    "tenant-apply", "tenant-revert",
    "seed", "seed-permission", "seed-platform-super-admin",
    "migrate-reset", "seed-reset", "mock-reset",
  ]));
  expect(findOp("prisma-status")?.readonly).toBe(true);
  expect(findOp("prisma-deploy")?.writes).toBe(true);
  expect(findOp("migrate-reset")?.destructive).toBe(true);
});

test("findOp returns undefined for unknown ids", () => {
  expect(findOp("nope")).toBeUndefined();
});

test("validateBuCode requires a known active code and a safe charset", () => {
  expect(validateBuCode("T03", ["T03", "T04"])).toBe(true);
  expect(validateBuCode("T99", ["T03"])).toBe(false);          // not active
  expect(validateBuCode("T03; DROP", ["T03; DROP"])).toBe(false); // bad charset
});

test("validateOnlyPrefix requires a matching existing file and a safe charset", () => {
  const files = ["001_v_operational_product_list.up.sql"];
  expect(validateOnlyPrefix("001_v_operational", files)).toBe(true);
  expect(validateOnlyPrefix("999_nope", files)).toBe(false);
  expect(validateOnlyPrefix("001 rm -rf", files)).toBe(false);
});

test("buildArgv builds bun argv for script and bin ops, with -- separated args", () => {
  expect(buildArgv(findOp("prisma-status")!, {})).toEqual(["x", "prisma", "migrate", "status"]);
  expect(buildArgv(findOp("prisma-deploy")!, {})).toEqual(["run", "db:deploy"]);
  expect(buildArgv(findOp("tenant-apply")!, { bu: "T03" }))
    .toEqual(["run", "db:tenant-views:apply", "--", "--bu", "T03"]);
  expect(buildArgv(findOp("tenant-apply")!, { only: "001_v" }))
    .toEqual(["run", "db:tenant-views:apply", "--", "--only", "001_v"]);
});

test("buildArgv ignores bu/only on ops that do not accept them", () => {
  expect(buildArgv(findOp("seed")!, { bu: "T03", only: "x" })).toEqual(["run", "db:seed"]);
});

test("canRun gates writes on the DB-name phrase and destructive on the checkbox", () => {
  const status = findOp("prisma-status")!;
  const deploy = findOp("prisma-deploy")!;
  const reset = findOp("migrate-reset")!;
  expect(canRun(status, { confirm: "", dbName: "carmen", destroyChecked: false })).toBe(true);
  expect(canRun(deploy, { confirm: "wrong", dbName: "carmen", destroyChecked: false })).toBe(false);
  expect(canRun(deploy, { confirm: "carmen", dbName: "carmen", destroyChecked: false })).toBe(true);
  expect(canRun(reset, { confirm: "carmen", dbName: "carmen", destroyChecked: false })).toBe(false);
  expect(canRun(reset, { confirm: "carmen", dbName: "carmen", destroyChecked: true })).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test lib/__tests__/platform-migrations.test.ts`
Expected: FAIL (`Cannot find module '@/lib/platform-migrations'`).

- [ ] **Step 3: Implement** — create `lib/platform-migrations.ts`:

```ts
export type OpGroup = "prisma" | "tenant" | "seed" | "danger";

export type CatalogOp = {
  id: string;
  group: OpGroup;
  label: string;
  kind: "script" | "bin";
  run: string;
  baseArgs?: string[];
  acceptsBu?: boolean;
  acceptsOnly?: boolean;
  writes: boolean;
  destructive: boolean;
  requiresPsql?: boolean;
  readonly?: boolean;
};

const seed = (id: string, run: string, label: string): CatalogOp => ({
  id, group: "seed", label, kind: "script", run, writes: true, destructive: false,
});

export const CATALOG: CatalogOp[] = [
  { id: "prisma-status", group: "prisma", label: "Prisma: migration status (read-only)",
    kind: "bin", run: "prisma migrate status", baseArgs: ["x", "prisma", "migrate", "status"],
    writes: false, destructive: false, readonly: true },
  { id: "prisma-deploy", group: "prisma", label: "Prisma: apply pending migrations (deploy)",
    kind: "script", run: "db:deploy", writes: true, destructive: false },

  { id: "tenant-apply", group: "tenant", label: "Tenant views: apply",
    kind: "script", run: "db:tenant-views:apply", acceptsBu: true, acceptsOnly: true,
    writes: true, destructive: false, requiresPsql: true },
  { id: "tenant-revert", group: "tenant", label: "Tenant views: revert (down)",
    kind: "script", run: "db:tenant-views:revert", acceptsBu: true, acceptsOnly: true,
    writes: true, destructive: true, requiresPsql: true },

  seed("seed", "db:seed", "Seed: baseline"),
  seed("seed-permission", "db:seed.permission", "Seed: permission catalog"),
  seed("seed-platform-permission", "db:seed.platform-permission", "Seed: platform permissions"),
  seed("seed-application", "db:seed.application", "Seed: applications"),
  seed("seed-role-permission", "db:seed.role-permission", "Seed: role permissions"),
  seed("seed-platform-role-permission", "db:seed.platform-role-permission", "Seed: platform role permissions"),
  seed("seed-platform-super-admin", "db:seed.platform-super-admin", "Seed: platform super admin"),
  seed("seed-report-template", "db:seed.report-template", "Seed: report templates"),

  { id: "migrate-reset", group: "danger", label: "DANGER: prisma migrate reset (drops & recreates)",
    kind: "script", run: "db:migrate:reset", writes: true, destructive: true },
  { id: "seed-reset", group: "danger", label: "DANGER: seed reset (migrate reset + seed)",
    kind: "script", run: "db:seed:reset", writes: true, destructive: true },
  { id: "mock-reset", group: "danger", label: "DANGER: mock reset (reset + seed + mock)",
    kind: "script", run: "db:mock:reset", writes: true, destructive: true },
];

export function findOp(id: string): CatalogOp | undefined {
  return CATALOG.find((o) => o.id === id);
}

const BU_RE = /^[A-Za-z0-9_-]+$/;
const PREFIX_RE = /^[A-Za-z0-9_.-]+$/;

export function validateBuCode(code: string, activeCodes: string[]): boolean {
  return BU_RE.test(code) && activeCodes.includes(code);
}

export function validateOnlyPrefix(prefix: string, fileNames: string[]): boolean {
  return PREFIX_RE.test(prefix) && fileNames.some((f) => f.startsWith(prefix));
}

export function buildArgv(op: CatalogOp, args: { bu?: string; only?: string }): string[] {
  if (op.kind === "bin") return [...(op.baseArgs ?? [])];
  const extra: string[] = [];
  if (op.acceptsBu && args.bu) extra.push("--bu", args.bu);
  if (op.acceptsOnly && args.only) extra.push("--only", args.only);
  return ["run", op.run, ...(extra.length ? ["--", ...extra] : [])];
}

export function canRun(op: CatalogOp, opts: { confirm: string; dbName: string; destroyChecked: boolean }): boolean {
  if (op.readonly || !op.writes) return true;
  if (opts.confirm !== opts.dbName) return false;
  if (op.destructive && !opts.destroyChecked) return false;
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test lib/__tests__/platform-migrations.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint new file + commit**

```bash
bun run lint lib/platform-migrations.ts
git add lib/platform-migrations.ts lib/__tests__/platform-migrations.test.ts
git commit -m "feat(platform-migrations): command catalog, arg validation, argv + run gating

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Route handler (`app/api/ops/platform-migrate/route.ts`)

**Files:**
- Create: `app/api/ops/platform-migrate/route.ts`
- Modify: `lib/audit.ts` (add `"MIGRATION"` to `Operation`)
- Test: `lib/__tests__/platform-migrate-route.test.ts`

**Interfaces:**
- Consumes: `requireAuth` (`@/lib/session`), `findOp`/`validateBuCode`/`validateOnlyPrefix`/`buildArgv` (`@/lib/platform-migrations`), `runProcess` (`@/lib/run-process`), `assertPackageDir`/`assertPsql`/`buildSubprocessEnv`/`targetDbInfo`/`packageDir`/`listTenantFiles` (`@/lib/platform-package`), `listBusinessUnits` (`@/lib/registry`), `streamOperation` (`@/lib/progress`), `ensureAuditTable`/`writeAudit` (`@/lib/audit`), `withTransaction` (`@/lib/db`), `env` (`@/lib/env`).
- Request body: `{ opId: string; bu?: string; only?: string; confirm?: string; confirmDestroy?: boolean }`.
- Produces: NDJSON stream of `log` events then `done`/`error`; or JSON `{ error }` with 400/401/404 before streaming.

- [ ] **Step 1: Add `"MIGRATION"` to the audit Operation union** — in `lib/audit.ts`:

```ts
export type Operation = "INSERT" | "UPDATE" | "DELETE" | "CASCADE_DELETE" | "DROP_SCHEMA" | "RAW_SQL" | "SOFT_DELETE" | "RESTORE" | "MIGRATION";
```

- [ ] **Step 2: Write the failing test** — create `lib/__tests__/platform-migrate-route.test.ts`:

```ts
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
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun run test lib/__tests__/platform-migrate-route.test.ts`
Expected: FAIL (`Cannot find module '@/app/api/ops/platform-migrate/route'`).

- [ ] **Step 4: Implement** — create `app/api/ops/platform-migrate/route.ts`:

```ts
import { env } from "@/lib/env";
import { requireAuth } from "@/lib/session";
import { streamOperation } from "@/lib/progress";
import { withTransaction } from "@/lib/db";
import { ensureAuditTable, writeAudit } from "@/lib/audit";
import { listBusinessUnits } from "@/lib/registry";
import { runProcess } from "@/lib/run-process";
import {
  findOp, validateBuCode, validateOnlyPrefix, buildArgv, type CatalogOp,
} from "@/lib/platform-migrations";
import {
  assertPackageDir, assertPsql, buildSubprocessEnv, targetDbInfo, packageDir,
  listTenantFiles,
} from "@/lib/platform-package";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { opId: string; bu?: string; only?: string; confirm?: string; confirmDestroy?: boolean };

const bad = (error: string, status: number) => Response.json({ error }, { status });

async function auditRun(op: CatalogOp, args: { bu?: string; only?: string }, code: number): Promise<void> {
  await ensureAuditTable();
  await withTransaction(null, (tx) =>
    writeAudit(tx, {
      actor: env().godModeUserId ?? "god-mode",
      schemaName: env().systemSchemaName,
      tableName: null,
      operation: "MIGRATION",
      pk: null,
      oldValues: null,
      newValues: { opId: op.id, bu: args.bu ?? null, only: args.only ?? null, exitCode: code },
      statement: `bun ${buildArgv(op, args).join(" ")}`,
    }),
  );
}

export async function POST(request: Request): Promise<Response> {
  try {
    await requireAuth();
  } catch {
    return bad("Unauthorized", 401);
  }

  const { opId, bu, only, confirm, confirmDestroy } = (await request.json()) as Body;
  const op = findOp(opId);
  if (!op) return bad(`Unknown operation: ${opId}`, 404);

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
    const db = targetDbInfo().database;
    if ((confirm ?? "") !== db) return bad(`Confirmation text must equal "${db}"`, 400);
    if (op.destructive && confirmDestroy !== true) {
      return bad("Destructive operations require confirmDestroy: true", 400);
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
  const spawnEnv = buildSubprocessEnv();
  const masked = targetDbInfo().masked;

  return streamOperation(async (onProgress) => {
    onProgress({ type: "log", line: `$ bun ${args.join(" ")}  (cwd=${cwd}, target=${masked})`, stream: "out" });
    const { code } = await runProcess({
      command: "bun",
      args,
      cwd,
      env: spawnEnv,
      onLine: (line, stream) => onProgress({ type: "log", line, stream }),
    });
    await auditRun(op, { bu, only }, code);
    if (code !== 0) throw new Error(`${op.label} failed (exit code ${code})`);
    return { summary: `${op.label} completed (exit 0)` };
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun run test lib/__tests__/platform-migrate-route.test.ts`
Expected: PASS (all route tests).

- [ ] **Step 6: Typecheck + commit**

```bash
bun run typecheck
git add lib/audit.ts app/api/ops/platform-migrate/route.ts lib/__tests__/platform-migrate-route.test.ts
git commit -m "feat(api): platform-migrate route — auth, validation, confirm gates, stream, audit

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Live log + page UI components

**Files:**
- Create: `components/operation-log.tsx`
- Create: `components/platform-migrations.tsx`
- Test: `components/__tests__/platform-migrations.test.tsx`

**Interfaces:**
- Consumes: `OperationState` (`@/lib/operation-stream`), `useOperationStream` (`@/components/use-operation-stream`), `OperationProgress` (`@/components/operation-progress`), `CATALOG`/`CatalogOp`/`canRun` (`@/lib/platform-migrations`).
- Produces:
  ```ts
  export function OperationLog({ state }: { state: OperationState }): JSX.Element | null;
  export type TargetDb = { masked: string; database: string; schema: string };
  export function PlatformMigrations(props: {
    target: TargetDb;
    catalog: CatalogOp[];
    buCodes: string[];
    tenantFiles: string[];
  }): JSX.Element;
  ```

- [ ] **Step 1: Write the failing test** — create `components/__tests__/platform-migrations.test.tsx`:

```tsx
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CATALOG } from "@/lib/platform-migrations";
import { PlatformMigrations } from "@/components/platform-migrations";

vi.mock("@/components/use-operation-stream", () => ({
  useOperationStream: () => ({ state: { phase: "idle", done: 0 }, start: vi.fn() }),
}));

afterEach(cleanup);

const props = {
  target: { masked: "postgresql://u@h/carmen_platform", database: "carmen_platform", schema: "CARMEN_SYSTEM" },
  catalog: CATALOG,
  buCodes: ["T03"],
  tenantFiles: ["001_v_operational_product_list.up.sql"],
};

test("shows the masked target DB banner", () => {
  render(<PlatformMigrations {...props} />);
  expect(screen.getByText(/carmen_platform/)).toBeInTheDocument();
  expect(screen.queryByText(/:s3cret@|:p@/)).not.toBeInTheDocument();
});

test("read-only op enables Run immediately", () => {
  render(<PlatformMigrations {...props} />);
  fireEvent.click(screen.getByLabelText(/Prisma: migration status/i));
  expect(screen.getByRole("button", { name: /^Run$/i })).toBeEnabled();
});

test("write op keeps Run disabled until the DB name is typed", () => {
  render(<PlatformMigrations {...props} />);
  fireEvent.click(screen.getByLabelText(/apply pending migrations/i));
  const run = screen.getByRole("button", { name: /^Run$/i });
  expect(run).toBeDisabled();
  fireEvent.change(screen.getByLabelText(/confirm/i), { target: { value: "carmen_platform" } });
  expect(run).toBeEnabled();
});

test("destructive op also requires the destroy checkbox", () => {
  render(<PlatformMigrations {...props} />);
  fireEvent.click(screen.getByLabelText(/prisma migrate reset/i));
  fireEvent.change(screen.getByLabelText(/confirm/i), { target: { value: "carmen_platform" } });
  const run = screen.getByRole("button", { name: /^Run$/i });
  expect(run).toBeDisabled();
  fireEvent.click(screen.getByLabelText(/destroys data/i));
  expect(run).toBeEnabled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test components/__tests__/platform-migrations.test.tsx`
Expected: FAIL (`Cannot find module '@/components/platform-migrations'`).

- [ ] **Step 3: Implement `components/operation-log.tsx`:**

```tsx
"use client";
import type { OperationState } from "@/lib/operation-stream";

export function OperationLog({ state }: { state: OperationState }) {
  if (!state.logs?.length) return null;
  return (
    <pre
      className="max-h-96 overflow-auto whitespace-pre-wrap rounded bg-gray-900 p-3 text-xs text-gray-100"
      role="log"
      aria-live="polite"
    >
      {state.logs.join("\n")}
    </pre>
  );
}
```

- [ ] **Step 4: Implement `components/platform-migrations.tsx`:**

```tsx
"use client";
import { useMemo, useState } from "react";
import { useOperationStream } from "@/components/use-operation-stream";
import { OperationProgress } from "@/components/operation-progress";
import { OperationLog } from "@/components/operation-log";
import { canRun, type CatalogOp, type OpGroup } from "@/lib/platform-migrations";

export type TargetDb = { masked: string; database: string; schema: string };

const GROUPS: { key: OpGroup; title: string }[] = [
  { key: "prisma", title: "Prisma schema migrations" },
  { key: "tenant", title: "Tenant view migrations (all active BU schemas)" },
  { key: "seed", title: "Seed scripts" },
  { key: "danger", title: "Danger zone — destructive resets" },
];

export function PlatformMigrations({ target, catalog, buCodes, tenantFiles }: {
  target: TargetDb; catalog: CatalogOp[]; buCodes: string[]; tenantFiles: string[];
}) {
  const { state, start } = useOperationStream();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bu, setBu] = useState("");
  const [only, setOnly] = useState("");
  const [confirm, setConfirm] = useState("");
  const [destroyChecked, setDestroyChecked] = useState(false);

  const op = useMemo(() => catalog.find((o) => o.id === selectedId) ?? null, [catalog, selectedId]);
  const running = state.phase === "running";
  const enabled = !!op && !running && canRun(op, { confirm, dbName: target.database, destroyChecked });

  const run = () => {
    if (!op) return;
    start("/api/ops/platform-migrate", {
      opId: op.id,
      bu: op.acceptsBu && bu ? bu : undefined,
      only: op.acceptsOnly && only ? only : undefined,
      confirm,
      confirmDestroy: op.destructive ? destroyChecked : undefined,
    });
  };

  const select = (id: string) => {
    setSelectedId(id); setBu(""); setOnly(""); setConfirm(""); setDestroyChecked(false);
  };

  return (
    <div className="space-y-4">
      <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
        <span className="font-semibold">Target:</span> <code>{target.masked}</code>{" "}
        <span className="text-gray-600">(schema {target.schema})</span>
      </div>

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

      {op && op.writes && !op.readonly && (
        <label className="block text-sm">
          Type the database name <code>{target.database}</code> to confirm
          <input
            aria-label="confirm" className="ml-2 rounded border px-2 py-1"
            value={confirm} onChange={(e) => setConfirm(e.target.value)}
          />
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

- [ ] **Step 5: Run test to verify it passes**

Run: `bun run test components/__tests__/platform-migrations.test.tsx`
Expected: PASS.

- [ ] **Step 6: Lint new files + commit**

```bash
bun run lint components/operation-log.tsx components/platform-migrations.tsx
git add components/operation-log.tsx components/platform-migrations.tsx components/__tests__/platform-migrations.test.tsx
git commit -m "feat(ui): platform migrations picker + live log component

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Page + navigation

**Files:**
- Create: `app/(god)/platform-migrations/page.tsx`
- Modify: `app/(god)/layout.tsx`

**Interfaces:**
- Consumes: `CATALOG` (`@/lib/platform-migrations`), `listBusinessUnits` (`@/lib/registry`), `listTenantFiles`/`targetDbInfo` (`@/lib/platform-package`), `PlatformMigrations` (`@/components/platform-migrations`).

- [ ] **Step 1: Create `app/(god)/platform-migrations/page.tsx`:**

```tsx
import { PlatformMigrations } from "@/components/platform-migrations";
import { CATALOG } from "@/lib/platform-migrations";
import { listBusinessUnits } from "@/lib/registry";
import { listTenantFiles, targetDbInfo } from "@/lib/platform-package";

export const dynamic = "force-dynamic";

export default async function PlatformMigrationsPage() {
  const [bus, tenantFiles] = await Promise.all([listBusinessUnits(), listTenantFiles()]);
  const buCodes = bus.filter((b) => b.isActive).map((b) => b.code);
  const target = targetDbInfo();
  return (
    <div>
      <h1 className="my-3 text-lg font-semibold">Platform migrations</h1>
      <p className="mb-3 text-sm text-gray-600">
        Runs migration scripts of <code>@repo/prisma-shared-schema-platform</code> against the database
        this instance manages, by spawning the package&apos;s own commands. Output streams live below.
      </p>
      <PlatformMigrations target={target} catalog={CATALOG} buCodes={buCodes} tenantFiles={tenantFiles} />
    </div>
  );
}
```

- [ ] **Step 2: Add the nav link** — in `app/(god)/layout.tsx`, after the existing Migrations link:

```tsx
        <Link href="/platform-migrations" className="text-sm text-gray-600">Platform migrations</Link>
```

- [ ] **Step 3: Verify typecheck + lint**

Run: `bun run typecheck`
Expected: no errors.

Run: `bun run lint "app/(god)/platform-migrations/page.tsx"`
Expected: clean.

- [ ] **Step 4: Boot-check the page renders** (manual; live DB)

Run: `bun run dev` (port 3305), log in, open `http://localhost:3305/platform-migrations`.
Expected: target-DB banner + grouped operation list render; selecting `Prisma: migration status` enables Run.

- [ ] **Step 5: Commit**

```bash
git add "app/(god)/platform-migrations/page.tsx" "app/(god)/layout.tsx"
git commit -m "feat(page): /platform-migrations page + nav link

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: End-to-end smoke (read-only) + docs

**Files:**
- Create: `e2e/platform-migrations.spec.ts`
- Modify: `README.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: the running dev server + a reachable platform DB + the sibling package present on disk. The spec **self-skips** when the package dir is absent so it never fails in environments without the backend repo.

- [ ] **Step 1: Write the E2E spec** — create `e2e/platform-migrations.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

const pkgDir = process.env.PLATFORM_PACKAGE_DIR
  ?? path.resolve(process.cwd(), "../carmen-turborepo-backend-v2/packages/prisma-shared-schema-platform");

test.skip(!fs.existsSync(path.join(pkgDir, "package.json")), "platform package not present");

test("runs read-only prisma migration status and streams output", async ({ page }) => {
  // Log in (mirror the auth flow used by other e2e specs).
  await page.goto("/login");
  await page.getByLabel(/password/i).fill(process.env.GOD_MODE_PASSWORD ?? "");
  await page.getByRole("button", { name: /log in/i }).click();

  await page.goto("/platform-migrations");
  await page.getByLabel(/Prisma: migration status/i).check();
  await page.getByRole("button", { name: /^Run$/i }).click();

  // The live log <pre role="log"> should receive output and the run should finish.
  await expect(page.getByRole("log")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/completed \(exit 0\)|Database schema is up to date|following migration/i))
    .toBeVisible({ timeout: 60_000 });
});
```

> Before finalizing, open `e2e/streaming-delete.spec.ts` and match its exact login steps (selectors/labels) — reuse that repo's established login flow rather than the placeholder above if it differs.

- [ ] **Step 2: Run the E2E spec**

Run: `node_modules/.bin/playwright test e2e/platform-migrations.spec.ts`
Expected: PASS, or **skipped** if the platform package is not present locally.

- [ ] **Step 3: Document env vars + the page** — add to `README.md` (env/setup section):

```md
### Platform migrations page

`/platform-migrations` runs the migration scripts of the sibling
`@repo/prisma-shared-schema-platform` package by spawning its own commands
(`prisma migrate deploy`, `db:tenant-views:apply`, `db:seed.*`). It requires:

- `PLATFORM_PACKAGE_DIR` — path to the package (defaults to
  `../carmen-turborepo-backend-v2/packages/prisma-shared-schema-platform`).
  The repo must be checked out with `node_modules` installed; `bun` and (for
  tenant views) `psql` must be on PATH.
- `SYSTEM_DIRECT_URL` — Prisma `directUrl` (non-pooled) for migrations/seeds.
  Defaults to `SYSTEM_DATABASE_URL` when unset.

Migrations run against the DB this instance is pointed at (the banner shows the
target). Writes require typing the database name; resets need a second
confirmation. Every run is recorded in `tb_god_mode_audit`.
```

Add a one-line note under Commands in `CLAUDE.md`:

```md
- `/platform-migrations` page runs the `prisma-shared-schema-platform` package's own scripts via subprocess (`lib/run-process.ts`, `lib/platform-package.ts`, `lib/platform-migrations.ts`, `app/api/ops/platform-migrate/route.ts`); needs `PLATFORM_PACKAGE_DIR` + `SYSTEM_DIRECT_URL`, `bun`/`psql` on PATH. Spec: `docs/superpowers/specs/2026-06-29-platform-migrations-page-design.md`.
```

- [ ] **Step 4: Add env vars to local env files** (not committed — `.env.local` / `.env.prod` are gitignored)

Add `SYSTEM_DIRECT_URL=` (set to the direct/non-pooled platform URL, or copy `SYSTEM_DATABASE_URL`) and, if the sibling repo is not at the default path, `PLATFORM_PACKAGE_DIR=` to `.env.local` and `.env.prod`.

- [ ] **Step 5: Full verification + commit**

```bash
bun run typecheck && bun run test
git add e2e/platform-migrations.spec.ts README.md CLAUDE.md
git commit -m "test(e2e)+docs: read-only platform-migrate smoke + env/page docs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final Verification

- [ ] `bun run typecheck` — clean.
- [ ] `bun run test` — full suite passes (existing 129 + new tests).
- [ ] `bun run lint <each new file>` — new files clean (repo-wide lint is not expected clean).
- [ ] Manual: `/platform-migrations` renders, `Prisma: migration status` streams output, a wrong confirm phrase blocks a write op, the danger zone requires the checkbox.

---

## Notes for the implementer

- **Why one command (`bun`) for everything:** script ops run `bun run <script>` (bun resolves the package's `node_modules/.bin` and ts-node), and `prisma-status` runs `bun x prisma migrate status`. The package dir is always the `cwd`, so Prisma finds `prisma/schema.prisma` and reads `SYSTEM_DATABASE_URL`/`SYSTEM_DIRECT_URL` from the injected env.
- **Out-of-band deploy risk (from the spec):** the page surfaces Prisma's raw output and exit code; lead with `prisma migrate status`. Do not swallow errors — a non-zero exit becomes an `error` event.
- **No shell, ever:** `runProcess` uses `spawn(..., { shell: false })` with an argv array; `--bu`/`--only` are validated against the active BU list and the real tenant filenames before they reach the argv.
- **v1 limitations (documented, not bugs):** client disconnect does not kill the subprocess; single-instance assumption (no cross-instance run lock).
```
