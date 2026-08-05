# build:bump Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `bun run build:bump`, a guarded release script that bumps the version in `package.json`, creates a `chore(release): vX.Y.Z` commit and an annotated `vX.Y.Z` tag — locally only, no push.

**Architecture:** A single Bun-run TypeScript file, `scripts/bump.ts`, that is a guard rail around Bun's built-in `bun pm version`. The script owns the branch guard, the clean-tree guard, the tag-collision guard, the typecheck/lint gate and the level prompt; `bun pm version` owns rewriting `package.json`, the commit and the annotated tag. Task 1 delivers the fully working non-interactive path; Task 2 layers the interactive prompt on top; Task 3 documents the command.

**Tech Stack:** Bun 1.3.14 (`bun pm version`), TypeScript, `node:child_process` / `node:fs` / `node:readline`. No new dependencies.

**Pre-validated:** the finished `scripts/bump.ts` from Tasks 1–2 was compiled against this repo's `tsconfig` options (exit 0) and run end-to-end in a throwaway repo before this plan was written. The code below is what passed. Two findings are baked into it: `gate()` uses `bun run --silent` (otherwise every gate echoes `$ tsc --noEmit`), and `promptLevel()` iterates readline instead of calling `rl.question()` per attempt (see Task 2 Step 3).

**Spec:** `docs/superpowers/specs/2026-08-05-build-bump-design.md`

## Global Constraints

- **No new dependencies.** Nothing is added to `package.json` `dependencies` or `devDependencies`.
- **`node:` APIs only — never the `Bun.*` globals.** `tsconfig.json` has `"include": ["**/*.ts", …]`, so `scripts/bump.ts` is typechecked by `bun run typecheck`. Neither `bun-types` nor `@types/bun` is installed, so `Bun.spawnSync` / `Bun.file` would fail typecheck with `Cannot find name 'Bun'`. `@types/node` (v20) is installed and `lib/run-process.ts` already uses `node:child_process`.
- **`bun run lint` is clean repo-wide and must stay that way.** `eslint.config.mjs` does not ignore `scripts/`, so the new file is linted.
- **The script must never touch the real repository during verification.** Every runtime check happens in a throwaway git repo under the scratchpad. The real repo gets no release commit and no tag until the operator runs the command themselves.
- **Operator-facing strings are in Thai**, matching the rest of this tool. Identifiers, git messages and tag names stay in English/ASCII.
- **Commit message format is `chore(release): v%s`.** Verified: `bun pm version` substitutes `%s` with the *bare* version (`0.1.1`), so the `v` must be written literally.
- **Per the operator's standing preference, do not create `*.test.ts` / `*.spec.ts` files.** Static checks (`bun run typecheck`, `bun run lint`) still run and must pass.

---

### Task 1: Non-interactive `scripts/bump.ts` + `package.json` entry

Delivers a fully working release script driven by an explicit argument: `bun run build:bump patch|minor|major`. Every guard and gate from the spec is in place. The interactive prompt is Task 2.

**Files:**
- Create: `scripts/bump.ts`
- Modify: `package.json` (add one line to `scripts`)

**Interfaces:**
- Consumes: nothing.
- Produces (Task 2 modifies these):
  - `nextVersions(current: string): Record<Level, string> | null` — pure; returns `null` when `current` does not match `MAJOR.MINOR.PATCH`.
  - `type Level = "patch" | "minor" | "major"`
  - `parseLevelArg(): Level` — Task 2 changes the return type to `Level | null`.
  - `fail(message: string): never`

- [ ] **Step 1: Create `scripts/bump.ts`**

```typescript
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const LEVELS = ["patch", "minor", "major"] as const;
type Level = (typeof LEVELS)[number];

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function git(...args: string[]): string {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trim();
  } catch {
    return fail(`เรียก git ล้มเหลว: git ${args.join(" ")}`);
  }
}

/** Pure. `null` when `current` is not MAJOR.MINOR.PATCH. */
export function nextVersions(current: string): Record<Level, string> | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
  if (!m) return null;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = Number(m[3]);
  return {
    patch: `${major}.${minor}.${patch + 1}`,
    minor: `${major}.${minor + 1}.0`,
    major: `${major + 1}.0.0`,
  };
}

function readVersion(): string {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version?: unknown };
  if (typeof pkg.version !== "string") fail("package.json ไม่มีฟิลด์ version");
  return pkg.version;
}

function parseLevelArg(): Level {
  // Annotated explicitly: `noUncheckedIndexedAccess` is off, so `process.argv[2]`
  // is plain `string` and comparing it to `undefined` is a TS2367 error.
  const arg: string | undefined = process.argv[2];
  if (arg === undefined) fail("ต้องระบุระดับ: patch|minor|major");
  const level = LEVELS.find((candidate) => candidate === arg);
  if (!level) fail("ระดับต้องเป็น patch|minor|major");
  return level;
}

function assertBranchAndTree(): void {
  const branch = git("branch", "--show-current");
  if (branch !== "main") {
    fail(`build:bump ต้องรันบน main (ตอนนี้อยู่ ${branch || "detached HEAD"})`);
  }
  console.log("▸ branch ........... main ✓");

  const dirty = git("status", "--porcelain");
  if (dirty !== "") {
    console.error("✗ working tree ไม่สะอาด — commit หรือ stash ก่อน");
    console.error(dirty);
    process.exit(1);
  }
  console.log("▸ working tree ..... clean ✓");
}

/**
 * Checks only the chosen version — an existing v0.1.1 must not block a minor
 * bump to v0.2.0. Runs before any write because `bun pm version` commits first
 * and tags second: on a tag collision it exits 1 having already committed the
 * bump, leaving a release commit with no tag.
 */
function assertTagFree(version: string): void {
  const tag = `v${version}`;
  if (git("tag", "--list", tag) !== "") fail(`tag ${tag} มีอยู่แล้ว`);
}

/**
 * Runs `bun run --silent <script>`, forwarding its output. Exits with its code
 * on failure. `--silent` suppresses bun's own `$ tsc --noEmit` echo line.
 */
function gate(script: string, done: string): void {
  const result = spawnSync("bun", ["run", "--silent", script], { stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`✗ ${script} ไม่ผ่าน`);
    process.exit(result.status ?? 1);
  }
  console.log(done);
}

function main(): void {
  const current = readVersion();
  const next = nextVersions(current);
  if (!next) fail(`อ่านเวอร์ชันจาก package.json ไม่ได้: ${current}`);

  assertBranchAndTree();

  const level = parseLevelArg();
  const target = next[level];
  assertTagFree(target);

  gate("typecheck", "▸ typecheck ........ ✓");
  gate("lint", "▸ lint ............. ✓");

  const bump = spawnSync("bun", ["pm", "version", level, "-m", "chore(release): v%s"], {
    stdio: "inherit",
  });
  if (bump.status !== 0) {
    fail(`bun pm version ล้มเหลว (exit ${bump.status ?? "?"}) — ตรวจ git log และ git tag ก่อนรันซ้ำ`);
  }

  console.log(`✓ v${target}`);
  console.log(`  commit  chore(release): v${target}`);
  console.log(`  tag     v${target} (annotated)`);
  console.log("");
  console.log(`→ ขั้นต่อไป: git push origin main && git push origin v${target}`);
}

main();
```

- [ ] **Step 2: Add the script entry to `package.json`**

Insert `"build:bump"` immediately after the existing `"build"` line, so the `scripts` block reads:

```json
  "scripts": {
    "dev": "bun run dev:local",
    "dev:local": "bun --env-file=.env.local next dev",
    "dev:prod": "bun --env-file=.env.prod next dev",
    "dev:uat": "bun --env-file=.env.uat next dev",
    "build": "next build",
    "build:bump": "bun scripts/bump.ts",
    "start": "next start",
    "lint": "eslint",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
```

- [ ] **Step 3: Run the static checks**

```bash
bun run typecheck
bun run lint
```

Expected: both exit 0 with no output. If `typecheck` reports `Cannot find name 'Bun'`, a `Bun.*` global slipped in — replace it with the `node:` equivalent (see Global Constraints).

- [ ] **Step 4: Build a throwaway repo to verify against**

Never verify against the real repo. `typecheck` and `lint` are stubbed to `true` so the gate passes without a TypeScript project.

```bash
SCRATCH=/private/tmp/claude-501/-Users-samutpra-GitHub-carmensoftware-organize-carmen-inventory-god-mode/cca3a3a0-49ef-47dc-8760-dd6789e1761f/scratchpad/bump-verify
rm -rf "$SCRATCH" && mkdir -p "$SCRATCH/scripts"
cp scripts/bump.ts "$SCRATCH/scripts/bump.ts"
cat > "$SCRATCH/package.json" <<'JSON'
{
  "name": "bump-verify",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "typecheck": "true",
    "lint": "true",
    "build:bump": "bun scripts/bump.ts"
  }
}
JSON
git -C "$SCRATCH" init -q -b main
git -C "$SCRATCH" config user.email verify@example.com
git -C "$SCRATCH" config user.name verify
git -C "$SCRATCH" add -A
git -C "$SCRATCH" commit -qm init
```

Expected: no errors. `git -C "$SCRATCH" branch --show-current` prints `main`.

- [ ] **Step 5: Verify the happy path**

```bash
cd "$SCRATCH" && bun run build:bump patch
```

`bun run` echoes the command it is about to run (`$ bun scripts/bump.ts patch`) as its first line — that is bun, not the script. After it, expected output is:

```
▸ branch ........... main ✓
▸ working tree ..... clean ✓
▸ typecheck ........ ✓
▸ lint ............. ✓
✓ v0.1.1
  commit  chore(release): v0.1.1
  tag     v0.1.1 (annotated)

→ ขั้นต่อไป: git push origin main && git push origin v0.1.1
```

Then confirm the git state:

```bash
git -C "$SCRATCH" log -1 --pretty=%s     # chore(release): v0.1.1
git -C "$SCRATCH" cat-file -t v0.1.1     # tag        (annotated, not "commit")
git -C "$SCRATCH" tag                    # v0.1.1
grep '"version"' "$SCRATCH/package.json" # "version": "0.1.1",
git -C "$SCRATCH" status --porcelain     # empty
```

- [ ] **Step 6: Verify the branch guard**

```bash
git -C "$SCRATCH" checkout -q -b feature/x
cd "$SCRATCH" && bun run build:bump patch; echo "exit=$?"
git -C "$SCRATCH" checkout -q main
```

Expected: `✗ build:bump ต้องรันบน main (ตอนนี้อยู่ feature/x)` and `exit=1`.

- [ ] **Step 7: Verify the clean-tree guard**

```bash
echo junk > "$SCRATCH/junk.txt"
cd "$SCRATCH" && bun run build:bump patch; echo "exit=$?"
rm "$SCRATCH/junk.txt"
```

Expected: `✗ working tree ไม่สะอาด — commit หรือ stash ก่อน`, then `?? junk.txt`, and `exit=1`.

- [ ] **Step 8: Verify the tag guard leaves `package.json` untouched**

This is the guard that matters most — without it, `bun pm version` would commit the bump and only then fail on the tag.

```bash
git -C "$SCRATCH" tag v0.1.2
cd "$SCRATCH" && bun run build:bump patch; echo "exit=$?"
grep '"version"' "$SCRATCH/package.json"
git -C "$SCRATCH" log -1 --pretty=%s
```

Expected: `✗ tag v0.1.2 มีอยู่แล้ว`, `exit=1`, version still `0.1.1`, and the last commit still `chore(release): v0.1.1` — **no new commit**.

- [ ] **Step 9: Verify the bad-argument and missing-argument paths**

```bash
cd "$SCRATCH" && bun run build:bump nonsense; echo "exit=$?"
cd "$SCRATCH" && bun run build:bump; echo "exit=$?"
```

Expected: `✗ ระดับต้องเป็น patch|minor|major` / `✗ ต้องระบุระดับ: patch|minor|major`, both `exit=1`.

- [ ] **Step 10: Verify minor and major arithmetic**

```bash
git -C "$SCRATCH" tag -d v0.1.2
cd "$SCRATCH" && bun run build:bump minor && grep '"version"' package.json && git tag
```

Expected: version `0.2.0`, tags now include `v0.2.0`.

- [ ] **Step 11: Verify a failing gate aborts before any write**

Point the stubbed `typecheck` at a command that fails, and confirm nothing is bumped.

```bash
cd "$SCRATCH" && bun pm pkg set scripts.typecheck="false"
git -C "$SCRATCH" add -A && git -C "$SCRATCH" commit -qm "stub failing typecheck"
cd "$SCRATCH" && bun run build:bump patch; echo "exit=$?"
grep '"version"' "$SCRATCH/package.json"
cd "$SCRATCH" && bun pm pkg set scripts.typecheck="true"
git -C "$SCRATCH" add -A && git -C "$SCRATCH" commit -qm "restore typecheck stub"
```

Expected: `✗ typecheck ไม่ผ่าน`, a non-zero `exit`, and the version still `0.2.0` — the gate must run before `bun pm version`.

- [ ] **Step 12: Verify an unparseable version is rejected**

```bash
cd "$SCRATCH" && bun pm pkg set version="not-a-version"
cd "$SCRATCH" && bun run build:bump patch; echo "exit=$?"
cd "$SCRATCH" && bun pm pkg set version="0.2.0"
```

Expected: `✗ อ่านเวอร์ชันจาก package.json ไม่ได้: not-a-version` and `exit=1`.

- [ ] **Step 13: Commit**

```bash
git add scripts/bump.ts package.json
git commit -m "feat: add build:bump release script (non-interactive)"
```

---

### Task 2: Interactive level prompt

Makes the level argument optional. With no argument, the script prints the current version, the three candidate versions, and reads a choice from stdin.

**Files:**
- Modify: `scripts/bump.ts`

**Interfaces:**
- Consumes from Task 1: `type Level`, `nextVersions()`, `fail()`, `assertBranchAndTree()`, `assertTagFree()`, `gate()`, `readVersion()`.
- Produces:
  - `parseLevelArg(): Level | null` — now returns `null` instead of failing when `process.argv[2]` is absent.
  - `promptLevel(current: string, next: Record<Level, string>): Promise<Level | null>` — `null` means the operator cancelled.
  - `main()` becomes `async function main(): Promise<void>` and is invoked with `await main();`.

- [ ] **Step 1: Add the `node:readline` import**

Change the import block at the top of `scripts/bump.ts` to:

```typescript
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
```

Note: `node:readline`, **not** `node:readline/promises` — Step 3 iterates the interface rather than awaiting `rl.question()`.

- [ ] **Step 2: Make the argument optional**

Replace the whole `parseLevelArg` function with:

```typescript
function parseLevelArg(): Level | null {
  // Annotated explicitly: `noUncheckedIndexedAccess` is off, so `process.argv[2]`
  // is plain `string` and comparing it to `undefined` is a TS2367 error.
  const arg: string | undefined = process.argv[2];
  if (arg === undefined) return null;
  const level = LEVELS.find((candidate) => candidate === arg);
  if (!level) fail("ระดับต้องเป็น patch|minor|major");
  return level;
}
```

- [ ] **Step 3: Add `promptLevel`**

Insert this immediately after `parseLevelArg`:

```typescript
async function promptLevel(
  current: string,
  next: Record<Level, string>,
): Promise<Level | null> {
  console.log("");
  console.log(`  current: ${current}`);
  console.log("  ? เลือกระดับ bump");
  console.log(`    1) patch  → ${next.patch}`);
  console.log(`    2) minor  → ${next.minor}`);
  console.log(`    3) major  → ${next.major}`);
  console.log("    q) ยกเลิก");

  const answers: Record<string, Level> = {
    "1": "patch",
    "2": "minor",
    "3": "major",
    patch: "patch",
    minor: "minor",
    major: "major",
  };

  // Async-iterated rather than rl.question(): with piped stdin readline buffers
  // every line at once, and a line emitted while no question() is pending is
  // dropped. Iterating queues them. Exhausting the iterator means EOF (Ctrl-D).
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    process.stdout.write("  > ");
    for await (const line of rl) {
      const input = line.trim().toLowerCase();
      if (input === "q" || input === "") return null;
      const level = answers[input];
      if (level) return level;
      console.log("  ✗ เลือก 1, 2, 3 หรือ q");
      process.stdout.write("  > ");
    }
    return null;
  } finally {
    rl.close();
  }
}
```

**Do not "simplify" this to `rl.question()` in a loop.** That version was written first and observed to fail: feeding `zzz\n1\n` printed the error and the re-prompt, then exited 0 **without bumping** — readline had already emitted the `1` line while nothing was awaiting it, so the retry was swallowed. Step 9 is the regression check for exactly this.

- [ ] **Step 4: Wire the prompt into `main`**

Change `main`'s signature to `async function main(): Promise<void>`, replace the level line, and change the bottom-of-file invocation. The three edits:

```typescript
async function main(): Promise<void> {
```

```typescript
  const level = parseLevelArg() ?? (await promptLevel(current, next));
  if (level === null) {
    console.log("ยกเลิก — ไม่มีอะไรเปลี่ยน");
    return;
  }

  const target = next[level];
  assertTagFree(target);
```

```typescript
await main();
```

Note the ordering this produces, which is the spec's: guards run before the prompt, and `assertTagFree` + the typecheck/lint gate run after it.

- [ ] **Step 5: Run the static checks**

```bash
bun run typecheck
bun run lint
```

Expected: both exit 0 with no output.

- [ ] **Step 6: Rebuild the throwaway repo**

```bash
SCRATCH=/private/tmp/claude-501/-Users-samutpra-GitHub-carmensoftware-organize-carmen-inventory-god-mode/cca3a3a0-49ef-47dc-8760-dd6789e1761f/scratchpad/bump-verify
rm -rf "$SCRATCH" && mkdir -p "$SCRATCH/scripts"
cp scripts/bump.ts "$SCRATCH/scripts/bump.ts"
cat > "$SCRATCH/package.json" <<'JSON'
{
  "name": "bump-verify",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "typecheck": "true",
    "lint": "true",
    "build:bump": "bun scripts/bump.ts"
  }
}
JSON
git -C "$SCRATCH" init -q -b main
git -C "$SCRATCH" config user.email verify@example.com
git -C "$SCRATCH" config user.name verify
git -C "$SCRATCH" add -A
git -C "$SCRATCH" commit -qm init
```

- [ ] **Step 7: Verify the non-interactive path still works**

```bash
cd "$SCRATCH" && bun run build:bump patch
git -C "$SCRATCH" log -1 --pretty=%s   # chore(release): v0.1.1
```

Expected: unchanged from Task 1 — passing an argument must still skip the prompt.

- [ ] **Step 8: Verify the prompt via piped stdin**

`bun run build:bump` has no TTY under the Bash tool, but `readline` reads piped stdin fine.

```bash
cd "$SCRATCH" && echo "2" | bun run build:bump
grep '"version"' "$SCRATCH/package.json"
git -C "$SCRATCH" tag
```

Expected: the menu prints with `current: 0.1.1`, `1) patch → 0.1.2`, `2) minor → 0.2.0`, `3) major → 1.0.0`; choosing `2` produces version `0.2.0` and tag `v0.2.0`.

- [ ] **Step 9: Verify cancel, and the dropped-retry regression**

```bash
cd "$SCRATCH" && echo "q" | bun run build:bump; echo "exit=$?"
grep '"version"' "$SCRATCH/package.json"
cd "$SCRATCH" && printf 'zzz\n1\n' | bun run build:bump; echo "exit=$?"
grep '"version"' "$SCRATCH/package.json"
```

Expected: `q` prints `ยกเลิก — ไม่มีอะไรเปลี่ยน`, `exit=0`, version unchanged at `0.2.0`.

The second run is the regression check for the `rl.question()` bug described in Step 3. It must print `✗ เลือก 1, 2, 3 หรือ q`, re-prompt, and **bump to `0.2.1`**. If it instead prints `ยกเลิก — ไม่มีอะไรเปลี่ยน` and leaves the version at `0.2.0`, the retry line was swallowed — the loop is not iterating readline.

- [ ] **Step 10: Verify EOF**

```bash
cd "$SCRATCH" && bun run build:bump < /dev/null; echo "exit=$?"
grep '"version"' "$SCRATCH/package.json"
```

Expected: the menu prints, then `ยกเลิก — ไม่มีอะไรเปลี่ยน`, `exit=0`, version unchanged at `0.2.1`. Exhausting the readline iterator returns `null`, which `main()` treats as a cancel. If this hangs instead, `rl.question()` is being awaited somewhere.

- [ ] **Step 11: Verify guards still fire before the prompt**

```bash
echo junk > "$SCRATCH/junk.txt"
cd "$SCRATCH" && echo "1" | bun run build:bump; echo "exit=$?"
rm "$SCRATCH/junk.txt"
```

Expected: the tree guard fires and `exit=1` — **the menu must not be printed**, confirming guards run before the prompt.

- [ ] **Step 12: Commit**

```bash
git add scripts/bump.ts
git commit -m "feat: add interactive level prompt to build:bump"
```

---

### Task 3: Document the command

**Beyond the spec's file table** — the spec lists only `scripts/bump.ts` and `package.json`. This task exists because `CLAUDE.md` carries a `## Commands` section that enumerates this repo's scripts, and leaving `build:bump` out of it makes that section stale. Drop this task if the documentation is not wanted.

**Files:**
- Modify: `CLAUDE.md` (the `## Commands` section)

**Interfaces:**
- Consumes: the finished command from Tasks 1 and 2.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add a `build:bump` bullet to `## Commands`**

Append this bullet to the end of the `## Commands` list in `CLAUDE.md`:

```markdown
- `bun run build:bump` — cut a release: bumps `package.json`, makes a `chore(release): vX.Y.Z` commit and an annotated `vX.Y.Z` tag. **Local only — it never pushes.** Runs on `main` with a clean tree, gates on `typecheck` + `lint`, and prompts for patch/minor/major; pass the level (`bun run build:bump patch`) to skip the prompt. Spec: `docs/superpowers/specs/2026-08-05-build-bump-design.md`.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document the build:bump release script"
```

---

## Verification Summary

After all tasks:

```bash
bun run typecheck   # exits 0, no output
bun run lint        # exits 0, no output
git log --oneline -3
```

The real repo carries the new script and documentation but **no release commit and no tag** — `git tag` still returns nothing. Cutting the first real release is the operator's call, not part of this plan.
