# Platform Migrations: Show Script Names — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show, under every operation on `/platform-migrations`, the npm script it runs and (when the script runs a TypeScript file) the `.ts` file name, with a subtle badge on ops whose script is missing from the platform package.

**Architecture:** A server-side fs helper reads the platform package's `package.json` scripts; two pure helpers turn a catalog op + that scripts map into a `{ script, file, missing }` record; the page builds a `Record<opId, ScriptInfo>` and passes it to the client component, which renders a secondary mono line and a "not in package" badge per op.

**Tech Stack:** Next.js 16 (RSC), React, TypeScript, Vitest (`bun run test`), Testing Library, Tailwind tokens.

## Global Constraints

- Test runner is Vitest via **`bun run test`** — never `bun test`. A single file: `bun run test <path>`.
- `.test.ts` runs in node, `.test.tsx` in jsdom (auto-selected by `vitest.config.ts`). Tests live in `__tests__/` subfolders.
- `bun run lint` must stay **clean** repo-wide; `bun run typecheck` must pass.
- SQL/audit/route behaviour is **unchanged** — this feature is display-only.
- Every commit message ends with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Work happens on branch `feat/platform-migrations-script-names` (already created; spec committed there).

## File Structure

- `lib/platform-migrations.ts` — **modify**: add `ScriptInfo` type + pure `extractTsFile()` and `resolveScriptInfo()`. Stays pure/testable; `CATALOG` untouched.
- `lib/platform-package.ts` — **modify**: add async `readPackageScripts()` (fs I/O for the package). Fits the module's existing role (owns pkg dir + fs).
- `app/(god)/platform-migrations/page.tsx` — **modify**: read scripts, build the `scriptInfo` map, pass it as a prop.
- `components/platform-migrations.tsx` — **modify**: accept optional `scriptInfo` prop; render the secondary line + badge.
- `lib/__tests__/platform-migrations.test.ts` — **modify**: unit tests for the two new pure helpers.
- `lib/__tests__/platform-package.test.ts` — **modify**: tests for `readPackageScripts()`.
- `components/__tests__/platform-migrations.test.tsx` — **modify**: render tests for the secondary line, badge, and fallback.

---

### Task 1: Pure helpers — `extractTsFile` + `resolveScriptInfo`

**Files:**
- Modify: `lib/platform-migrations.ts`
- Test: `lib/__tests__/platform-migrations.test.ts`

**Interfaces:**
- Consumes: existing `CatalogOp` (has `kind: "script" | "bin"`, `run: string`) and `findOp()` from `lib/platform-migrations.ts`.
- Produces:
  - `type ScriptInfo = { script: string; file: string | null; missing: boolean }`
  - `extractTsFile(command: string): string | null`
  - `resolveScriptInfo(op: CatalogOp, scripts: Record<string, string> | null): ScriptInfo`

- [ ] **Step 1: Write the failing tests**

Append to `lib/__tests__/platform-migrations.test.ts`. Also add `extractTsFile, resolveScriptInfo` to the existing top import from `@/lib/platform-migrations`.

```ts
import {
  CATALOG, findOp, validateBuCode, validateOnlyPrefix, buildArgv, canRun, validateSchemaName,
  extractTsFile, resolveScriptInfo,
} from "@/lib/platform-migrations";

test("extractTsFile returns the basename of a single .ts in the command", () => {
  expect(extractTsFile("ts-node -r tsconfig-paths/register prisma/seed.permission.ts"))
    .toBe("seed.permission.ts");
});

test("extractTsFile returns null when there is no .ts", () => {
  expect(extractTsFile("prisma migrate deploy")).toBeNull();
});

test("extractTsFile picks the single .ts from a compound command", () => {
  expect(extractTsFile(
    "prisma migrate reset --force && ts-node -r tsconfig-paths/register prisma/seed.ts",
  )).toBe("seed.ts");
});

test("extractTsFile returns null when multiple distinct .ts files are present", () => {
  expect(extractTsFile("ts-node a.ts && ts-node b.ts")).toBeNull();
});

test("resolveScriptInfo returns the run command for bin ops without a file", () => {
  const info = resolveScriptInfo(findOp("prisma-status")!, { "db:seed": "ts-node prisma/seed.ts" });
  expect(info).toEqual({ script: "prisma migrate status", file: null, missing: false });
});

test("resolveScriptInfo resolves a known script to its .ts file", () => {
  const info = resolveScriptInfo(findOp("seed-permission")!, {
    "db:seed.permission": "ts-node -r tsconfig-paths/register prisma/seed.permission.ts",
  });
  expect(info).toEqual({ script: "db:seed.permission", file: "seed.permission.ts", missing: false });
});

test("resolveScriptInfo flags a script missing from the package", () => {
  const info = resolveScriptInfo(findOp("seed-application")!, {});
  expect(info).toEqual({ script: "db:seed.application", file: null, missing: true });
});

test("resolveScriptInfo does not accuse when scripts are unavailable", () => {
  const info = resolveScriptInfo(findOp("seed-permission")!, null);
  expect(info).toEqual({ script: "db:seed.permission", file: null, missing: false });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test lib/__tests__/platform-migrations.test.ts`
Expected: FAIL — `extractTsFile is not a function` / `resolveScriptInfo is not a function` (import undefined).

- [ ] **Step 3: Implement the helpers**

Append to `lib/platform-migrations.ts` (after `findOp`, keeping the file's existing pure style):

```ts
export type ScriptInfo = {
  script: string;
  file: string | null;
  missing: boolean;
};

export function extractTsFile(command: string): string | null {
  const matches = command.match(/\S+\.ts\b/g);
  if (!matches) return null;
  const bases = [...new Set(matches.map((m) => m.split("/").pop()!))];
  return bases.length === 1 ? bases[0] : null;
}

export function resolveScriptInfo(
  op: CatalogOp,
  scripts: Record<string, string> | null,
): ScriptInfo {
  if (op.kind === "bin") return { script: op.run, file: null, missing: false };
  if (!scripts) return { script: op.run, file: null, missing: false };
  const command = scripts[op.run];
  if (command === undefined) return { script: op.run, file: null, missing: true };
  return { script: op.run, file: extractTsFile(command), missing: false };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test lib/__tests__/platform-migrations.test.ts`
Expected: PASS (all existing + 8 new tests green).

- [ ] **Step 5: Commit**

```bash
git add lib/platform-migrations.ts lib/__tests__/platform-migrations.test.ts
git commit -m "$(cat <<'EOF'
feat(platform-migrations): derive script + .ts file per catalog op

Add pure ScriptInfo, extractTsFile(), and resolveScriptInfo() helpers.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: fs helper — `readPackageScripts`

**Files:**
- Modify: `lib/platform-package.ts`
- Test: `lib/__tests__/platform-package.test.ts`

**Interfaces:**
- Consumes: existing `packageDir()` from `lib/platform-package.ts`; `fs` (`node:fs/promises`) and `path` are already imported there.
- Produces: `readPackageScripts(): Promise<Record<string, string> | null>` — the package.json `scripts` map, or `null` when the file is missing / unreadable / malformed / has no `scripts` key.

- [ ] **Step 1: Write the failing tests**

Append to `lib/__tests__/platform-package.test.ts` (the file already imports `fs`, `os`, `path` and uses the `mkdtemp` + `PLATFORM_PACKAGE_DIR` + `vi.resetModules()` pattern):

```ts
test("readPackageScripts returns the scripts map from package.json", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pkg-"));
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ scripts: { "db:seed": "ts-node prisma/seed.ts" } }),
  );
  process.env.PLATFORM_PACKAGE_DIR = dir;
  vi.resetModules();
  const { readPackageScripts } = await import("@/lib/platform-package");
  expect(await readPackageScripts()).toEqual({ "db:seed": "ts-node prisma/seed.ts" });
});

test("readPackageScripts returns null when package.json is absent", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pkg-"));
  process.env.PLATFORM_PACKAGE_DIR = dir;
  vi.resetModules();
  const { readPackageScripts } = await import("@/lib/platform-package");
  expect(await readPackageScripts()).toBeNull();
});

test("readPackageScripts returns null when package.json has no scripts key", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pkg-"));
  await fs.writeFile(path.join(dir, "package.json"), "{}");
  process.env.PLATFORM_PACKAGE_DIR = dir;
  vi.resetModules();
  const { readPackageScripts } = await import("@/lib/platform-package");
  expect(await readPackageScripts()).toBeNull();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test lib/__tests__/platform-package.test.ts`
Expected: FAIL — `readPackageScripts is not a function`.

- [ ] **Step 3: Implement the helper**

Append to `lib/platform-package.ts` (uses the already-imported `fs` and `path`, and existing `packageDir()`):

```ts
export async function readPackageScripts(): Promise<Record<string, string> | null> {
  try {
    const raw = await fs.readFile(path.join(packageDir(), "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
    return parsed.scripts ?? null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test lib/__tests__/platform-package.test.ts`
Expected: PASS (existing + 3 new tests green).

- [ ] **Step 5: Commit**

```bash
git add lib/platform-package.ts lib/__tests__/platform-package.test.ts
git commit -m "$(cat <<'EOF'
feat(platform-migrations): read package.json scripts map

readPackageScripts() returns the platform package's scripts, or null
when unreadable (page degrades to script-name-only).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Component — secondary line + missing badge

**Files:**
- Modify: `components/platform-migrations.tsx`
- Test: `components/__tests__/platform-migrations.test.tsx`

**Interfaces:**
- Consumes: `ScriptInfo` from `@/lib/platform-migrations` (Task 1); `TriangleAlert` from `lucide-react` (already imported in the component).
- Produces: `PlatformMigrations` gains an **optional** prop `scriptInfo?: Record<string, ScriptInfo>` (defaults to `{}`). No change to any other prop or to run-gating.

- [ ] **Step 1: Write the failing tests**

Append to `components/__tests__/platform-migrations.test.tsx` (the file already defines `props`, which does **not** include `scriptInfo`; new renders pass it explicitly after the spread):

```ts
test("shows the npm script and .ts file under an op label", () => {
  render(<PlatformMigrations {...props} scriptInfo={{
    "seed-permission": { script: "db:seed.permission", file: "seed.permission.ts", missing: false },
  }} />);
  expect(screen.getByText("db:seed.permission · seed.permission.ts")).toBeInTheDocument();
});

test("shows the script name only when there is no .ts file", () => {
  render(<PlatformMigrations {...props} scriptInfo={{
    "prisma-deploy": { script: "db:deploy", file: null, missing: false },
  }} />);
  expect(screen.getByText("db:deploy")).toBeInTheDocument();
  expect(screen.queryByText(/·/)).not.toBeInTheDocument();
});

test("flags an op whose script is missing from the package", () => {
  render(<PlatformMigrations {...props} scriptInfo={{
    "seed-application": { script: "db:seed.application", file: null, missing: true },
  }} />);
  expect(screen.getByText(/not in package/i)).toBeInTheDocument();
});

test("renders the label only when an op has no scriptInfo entry", () => {
  render(<PlatformMigrations {...props} scriptInfo={{}} />);
  expect(screen.getByText("Seed: baseline")).toBeInTheDocument();
  expect(screen.queryByText(/not in package/i)).not.toBeInTheDocument();
});
```

Note: the `·` in the first test is U+00B7 (middle dot) — the same character the component emits.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test components/__tests__/platform-migrations.test.tsx`
Expected: FAIL — the secondary line / badge text is not found (`Unable to find an element with the text: db:seed.permission · seed.permission.ts`).

- [ ] **Step 3: Implement the prop + rendering**

In `components/platform-migrations.tsx`:

**(a)** Extend the import from `@/lib/platform-migrations` to include `type ScriptInfo`:

```ts
import { canRun, validateSchemaName, type CatalogOp, type OpGroup, type ScriptInfo } from "@/lib/platform-migrations";
```

**(b)** Add the optional prop to the destructure and the type (default `{}`):

```ts
export function PlatformMigrations({
  target,
  catalog,
  buCodes,
  tenantFiles,
  schemas,
  defaultSchema,
  scriptInfo = {},
}: {
  target: TargetDb;
  catalog: CatalogOp[];
  buCodes: string[];
  tenantFiles: string[];
  schemas: string[];
  defaultSchema: string;
  scriptInfo?: Record<string, ScriptInfo>;
}) {
```

**(c)** Replace the op radio row (`ops.map(...)`, currently the block rendering
`<label ...><input type="radio" .../><span>{o.label}</span></label>`) with:

```tsx
{ops.map((o) => {
  const info = scriptInfo[o.id];
  return (
    <label
      key={o.id}
      className="flex cursor-pointer items-start gap-2 text-sm"
    >
      <input
        type="radio"
        name="op"
        checked={selectedId === o.id}
        onChange={() => select(o.id)}
        className="mt-0.5 accent-accent"
      />
      <span className="flex flex-col">
        <span className="flex items-center gap-1.5">
          {o.label}
          {info?.missing && (
            <span className="inline-flex items-center gap-1 rounded border border-warning-border bg-warning-subtle px-1.5 py-0.5 text-xs font-medium text-warning-subtle-foreground">
              <TriangleAlert className="h-3 w-3" aria-hidden="true" />
              not in package
            </span>
          )}
        </span>
        {info && (
          <span className="font-mono text-xs text-foreground-subtle">
            {info.file ? `${info.script} · ${info.file}` : info.script}
          </span>
        )}
      </span>
    </label>
  );
})}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test components/__tests__/platform-migrations.test.tsx`
Expected: PASS (existing banner/run-gating tests + 4 new tests green — the existing tests use the default `scriptInfo = {}`, so their label lookups are unchanged).

- [ ] **Step 5: Commit**

```bash
git add components/platform-migrations.tsx components/__tests__/platform-migrations.test.tsx
git commit -m "$(cat <<'EOF'
feat(platform-migrations): render script name + .ts file per op

Optional scriptInfo prop drives a mono secondary line and a subtle
"not in package" badge; ops without an entry fall back to label only.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Page wiring — build and pass `scriptInfo`

**Files:**
- Modify: `app/(god)/platform-migrations/page.tsx`

**Interfaces:**
- Consumes: `readPackageScripts()` (Task 2); `resolveScriptInfo`, `type ScriptInfo`, `CATALOG` (Task 1) from `@/lib/platform-migrations`; the `scriptInfo` prop on `<PlatformMigrations>` (Task 3).
- Produces: no new exports — final wiring that makes the feature live in the real page.

- [ ] **Step 1: Edit the page**

In `app/(god)/platform-migrations/page.tsx`:

**(a)** Update the two imports:

```ts
import { CATALOG, resolveScriptInfo, type ScriptInfo } from "@/lib/platform-migrations";
import { listTenantFiles, targetDbInfo, readPackageScripts } from "@/lib/platform-package";
```

**(b)** Add `readPackageScripts()` to the existing `Promise.all` and build the map:

```ts
const [bus, tenantFiles, schemas, scripts] = await Promise.all([
  listBusinessUnits(), listTenantFiles(), listSchemaNames(), readPackageScripts(),
]);
const buCodes = bus.filter((b) => b.isActive).map((b) => b.code);
const target = targetDbInfo();
const scriptInfo: Record<string, ScriptInfo> = Object.fromEntries(
  CATALOG.map((op) => [op.id, resolveScriptInfo(op, scripts)]),
);
```

**(c)** Pass the prop to the component:

```tsx
<PlatformMigrations
  target={target} catalog={CATALOG} buCodes={buCodes} tenantFiles={tenantFiles}
  schemas={schemas} defaultSchema={target.schema} scriptInfo={scriptInfo}
/>
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS (no type errors — `Object.fromEntries` result is annotated `Record<string, ScriptInfo>`).

- [ ] **Step 3: Full test suite + lint**

Run: `bun run test && bun run lint`
Expected: All tests PASS; lint reports **no new** problems.

- [ ] **Step 4: Manual verification (RSC boundary)**

jsdom + typecheck do not exercise the server→client prop serialization. Boot an authed god route and eyeball the page:

Run: `bun run dev` (port **3305**), then open `http://localhost:3305/platform-migrations`.
Expected: each op shows a mono secondary line (`db:seed.permission · seed.permission.ts`, `prisma migrate status`, `db:deploy`, …); `Seed: applications` and the `db:mock:reset` danger op show the `⚠ not in package` badge; no console/serialization error.

- [ ] **Step 5: Commit**

```bash
git add "app/(god)/platform-migrations/page.tsx"
git commit -m "$(cat <<'EOF'
feat(platform-migrations): show script names on the page

Read package scripts, build the scriptInfo map, pass it to the client.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- Secondary line `{script} · {file}` for all ops → Task 3 (component) + Task 4 (data). ✓
- `.ts` file derived dynamically from package.json → Task 1 (`extractTsFile`/`resolveScriptInfo`) + Task 2 (`readPackageScripts`). ✓
- `missing` badge for ops absent from the package → Task 1 (`missing` flag) + Task 3 (badge). ✓
- Graceful degradation when package unreadable → Task 2 (`null`) + Task 1 (`scripts === null` ⇒ `missing:false`) + Task 3 (optional prop). ✓
- bin ops show the run command, no file → Task 1 (`kind === "bin"` branch) + test. ✓
- No change to run-gating / confirm / audit / streaming → nothing in any task touches those paths. ✓
- Tests: unit (helpers), fs (readPackageScripts), component (line/badge/fallback) → Tasks 1–3. ✓

**Placeholder scan:** No TBD/TODO; every code step contains complete code and exact commands. ✓

**Type consistency:** `ScriptInfo` fields `{ script, file, missing }` are identical across Task 1 (definition), Task 3 (prop `Record<string, ScriptInfo>`), Task 4 (map annotation). `resolveScriptInfo(op, scripts)` signature matches its call sites in Task 4. `readPackageScripts(): Promise<Record<string, string> | null>` return type matches `resolveScriptInfo`'s second parameter. ✓
