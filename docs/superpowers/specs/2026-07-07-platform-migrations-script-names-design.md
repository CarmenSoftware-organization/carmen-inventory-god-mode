# Platform migrations: show script names

Date: 2026-07-07
Branch base: main (proposed branch: `feat/platform-migrations-script-names`)

## Goal

On `/platform-migrations`, show which script each operation actually runs. Today
every op renders only its human-friendly `label` (e.g. "Seed: permission
catalog"), so the operator cannot see the real command. Add a secondary line per
op that shows the **npm script name** and, when the script runs a TypeScript
file, the **`.ts` file name** — for every operation group, not just seeds.

The `.ts` file name is derived **dynamically** from the platform package's own
`package.json` so it stays in sync with the package and never drifts. As a
byproduct, an op whose script is not found in the package is flagged.

## Background

- The page (`app/(god)/platform-migrations/page.tsx`) is a server component that
  passes the static `CATALOG` (`lib/platform-migrations.ts`) to the client
  component `components/platform-migrations.tsx`, which renders each op as a
  radio `<label>` showing `{o.label}` (line ~169).
- Each `CatalogOp` already carries a `run` field: for `kind: "script"` it is an
  npm script name (e.g. `db:seed.permission`) invoked `bun run <run>` in the
  package dir; for `kind: "bin"` it is a readable command string (e.g.
  `prisma migrate status`).
- The platform package's `package.json` maps each script to its command, e.g.
  `db:seed.permission` → `ts-node -r tsconfig-paths/register prisma/seed.permission.ts`.
  So the `.ts` file can be extracted from the script command.
- `lib/platform-package.ts` already owns fs/env I/O for the package (resolves the
  dir via `packageDir()`, lists tenant files, builds subprocess env).
- Serializing props across the RSC boundary: only plain objects of strings are
  passed, which serialize safely (avoids the known server→client prop-serialization
  RSC pitfall).

### Observed mismatches (motivating the `missing` flag)

While inspecting the real package, two catalog ops reference scripts that do not
exist in the package's `package.json`:

- `seed-application` → `db:seed.application`
- `mock-reset` → `db:mock:reset`

These are latent bugs: clicking Run on them would fail at spawn time. Dynamic
parsing surfaces them for free, so we flag them in the UI.

## Design

### Data flow

1. **`lib/platform-package.ts`** — add:
   ```ts
   export async function readPackageScripts(): Promise<Record<string, string> | null>
   ```
   Reads `<packageDir()>/package.json`, returns its `scripts` object, or `null`
   if the file is missing/unreadable/malformed (graceful degradation — the page
   still renders, showing script names without files and without `missing`
   badges).

2. **`lib/platform-migrations.ts`** — add two pure, unit-tested helpers plus a
   result type:
   ```ts
   export type ScriptInfo = {
     script: string;       // "db:seed.permission" or bin command "prisma migrate status"
     file: string | null;  // "seed.permission.ts" or null when the command runs no .ts
     missing: boolean;      // true when kind:"script" and `run` not found in package scripts
   };

   export function extractTsFile(command: string): string | null;
   export function resolveScriptInfo(op: CatalogOp, scripts: Record<string, string> | null): ScriptInfo;
   ```
   - `extractTsFile` finds `.ts` tokens in a command string and returns the
     **basename** of the single one present (e.g.
     `ts-node -r tsconfig-paths/register prisma/seed.permission.ts` →
     `"seed.permission.ts"`). Returns `null` when there is no `.ts` token.
     Compound commands with exactly one `.ts` (e.g. `db:seed:reset` =
     `prisma migrate reset --force && ts-node ... prisma/seed.ts`) resolve to that
     one file (`seed.ts`). If more than one distinct `.ts` basename is present,
     return `null` (avoid picking arbitrarily).
   - `resolveScriptInfo`:
     - `kind: "bin"` → `{ script: op.run, file: null, missing: false }`
       (bin ops do not depend on an npm script).
     - `kind: "script"` → `script: op.run`; look up `scripts?.[op.run]`; if
       `scripts` is `null` → `{ file: null, missing: false }` (unknown, don't
       accuse); if the key is absent → `{ file: null, missing: true }`; else
       `{ file: extractTsFile(command), missing: false }`.

3. **`app/(god)/platform-migrations/page.tsx`** — add `readPackageScripts()` to
   the existing `Promise.all`, then build
   `const scriptInfo: Record<string, ScriptInfo> =
     Object.fromEntries(CATALOG.map((op) => [op.id, resolveScriptInfo(op, scripts)]))`
   and pass it as a new `scriptInfo` prop to `<PlatformMigrations>`. `CATALOG`
   stays pure (not mutated); the map is a separate derived structure keyed by
   `op.id`.

4. **`components/platform-migrations.tsx`** — accept the `scriptInfo` prop and
   render a secondary line under each op's label.

### Display

Each op row changes from a single-line `flex items-center` to `flex items-start`,
with the label and a secondary line stacked in a `flex-col` next to the radio:

```
Prisma schema migrations
  ○ Prisma: migration status (read-only)
      prisma migrate status
  ○ Prisma: apply pending migrations (deploy)
      db:deploy

Seed scripts
  ○ Seed: baseline
      db:seed · seed.ts
  ○ Seed: permission catalog
      db:seed.permission · seed.permission.ts
  ○ Seed: applications          ⚠ not in package
      db:seed.application
```

- Secondary line: `font-mono text-xs text-foreground-subtle`.
- Text: `{script}`, followed by ` · {file}` only when `file` is non-null.
- When `info.missing`, render a subtle badge/pill `⚠ not in package` (muted
  warning styling using existing warning tokens; not alarmist). The badge is
  informational only — it does **not** disable the op (run-gating is unchanged;
  the existing route/preflight already errors on a bad spawn).
- If `scriptInfo` for an op is absent (defensive), render nothing extra — the row
  falls back to just the label.

### Scope boundaries

- No change to run-gating, confirm phrases, argument validation, the danger-zone
  gates, streaming, or the audit trail.
- Not fixing the underlying `db:seed.application` / `db:mock:reset` mismatch in
  the catalog — only surfacing it. (Deciding whether to remove those catalog
  entries is a separate call, out of scope here.)
- No new env vars, no new route, no server-action changes.

## Error handling

- `package.json` missing / unreadable / no `scripts` key → `readPackageScripts()`
  returns `null` → every op shows its `script` only, `missing = false`, no badge.
  Page renders normally.
- `extractTsFile` on an unexpected command shape → returns `null` (no file line);
  never throws.

## Testing

- **Unit** (`lib/platform-migrations.test.ts`, node):
  - `extractTsFile`: single `.ts` with path prefix; no `.ts` (returns `null`);
    compound command with one `.ts`; multiple distinct `.ts` (returns `null`).
  - `resolveScriptInfo`: bin op → `file: null, missing: false`; script found →
    correct `file`; script absent from map → `missing: true`; `scripts === null`
    → `missing: false, file: null`.
- **Component** (`components/platform-migrations.test.tsx`, jsdom):
  - Renders the secondary `{script} · {file}` line for a seed op.
  - Renders script-only line (no ` · `) when `file` is null.
  - Renders the `⚠ not in package` badge when `missing` is true, and not when
    false.
  - Falls back to label-only when an op has no `scriptInfo` entry.
- New/edited files kept lint-clean; pre-existing repo lint left untouched
  (per `CLAUDE.md`). Run `bun run typecheck` + `bun run lint`.

## Files touched

```
lib/platform-package.ts                     + readPackageScripts()
lib/platform-migrations.ts                  + ScriptInfo, extractTsFile(), resolveScriptInfo()
app/(god)/platform-migrations/page.tsx      read scripts, build scriptInfo map, pass prop
components/platform-migrations.tsx          accept scriptInfo prop, render secondary line + badge
lib/platform-migrations.test.ts             unit tests for the two new pure helpers
components/platform-migrations.test.tsx     render tests for secondary line + badge + fallback
```

## Out of scope

- Removing or fixing catalog entries whose scripts don't exist in the package.
- Showing the full resolved command (e.g. `ts-node ... prisma/seed.ts`) — only
  the script name and `.ts` basename are shown.
- Any change to how operations are executed, gated, or audited.
