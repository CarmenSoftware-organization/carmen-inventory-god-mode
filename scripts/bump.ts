import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

import {
  collectEntries,
  hasEntries,
  promote,
  renderDraft,
  unreleasedBody,
  withDraft,
} from "./changelog";

const LEVELS = ["patch", "minor", "major"] as const;
type Level = (typeof LEVELS)[number];

const CHANGELOG_FILE = "CHANGELOG.md";

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

/**
 * `git()` variant that returns `null` instead of exiting. Needed for checks
 * that can fail legitimately — e.g. `@{upstream}` when no upstream is
 * configured — where that failure must not abort the script. stderr is
 * suppressed (unlike `git()`): failing here is an expected path with its own
 * printed message, not an exceptional one worth showing git's raw error for.
 */
function tryGit(...args: string[]): string | null {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

/** Pure. `null` when `current` is not MAJOR.MINOR.PATCH. */
function nextVersions(current: string): Record<Level, string> | null {
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
  const raw = readFileSync("package.json", "utf8");
  let pkg: { version?: unknown };
  try {
    pkg = JSON.parse(raw) as { version?: unknown };
  } catch {
    return fail("package.json อ่านเป็น JSON ไม่ได้");
  }
  if (typeof pkg.version !== "string") fail("package.json ไม่มีฟิลด์ version");
  return pkg.version;
}

function parseLevelArg(): Level | null {
  // Annotated explicitly: `noUncheckedIndexedAccess` is off, so `process.argv[2]`
  // is plain `string` and comparing it to `undefined` is a TS2367 error.
  const arg: string | undefined = process.argv[2];
  if (arg === undefined) return null;
  const level = LEVELS.find((candidate) => candidate === arg);
  if (!level) fail("ระดับต้องเป็น patch|minor|major");
  return level;
}

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
  console.log("    q) ยกเลิก (หรือกด Enter)");

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

function assertBranchAndTree(): void {
  const branch = git("branch", "--show-current");
  if (branch !== "main") {
    fail(`build:bump ต้องรันบน main (ตอนนี้อยู่ ${branch || "detached HEAD"})`);
  }
  console.log("▸ branch ........... main ✓");

  // CHANGELOG.md is the one file allowed to be dirty here. The first run writes
  // a draft into it and stops for the rewrite; the second run has to accept that
  // edit, and asking for a commit first would put a changelog commit straight on
  // main outside a PR. Instead `release()` stages it into the release commit.
  const status = git("status", "--porcelain").split("\n").filter((line) => line !== "");
  const dirty = status.filter((line) => line.slice(3) !== CHANGELOG_FILE);
  if (dirty.length > 0) {
    console.error("✗ working tree ไม่สะอาด — commit หรือ stash ก่อน");
    console.error(dirty.join("\n"));
    process.exit(1);
  }
  const edited = status.length > dirty.length;
  console.log(`▸ working tree ..... clean${edited ? ` (ยกเว้น ${CHANGELOG_FILE})` : ""} ✓`);
}

/** Release dates are UTC, so a tag cut anywhere carries the same date. */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function readChangelog(): string {
  try {
    return readFileSync(CHANGELOG_FILE, "utf8");
  } catch {
    return fail(`ไม่พบ ${CHANGELOG_FILE}`);
  }
}

/**
 * The changelog gate — and the only guard that writes. An empty `[Unreleased]`
 * is filled with a draft built from the commits since the last tag, and the run
 * stops there: those lines are commit subjects, not release notes, and the
 * rewrite is the point. Runs before the prompt, with the other instant guards.
 */
function assertChangelogReady(): void {
  const markdown = readChangelog();

  let body: string;
  try {
    body = unreleasedBody(markdown);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }

  if (hasEntries(body)) {
    console.log("▸ changelog ........ [Unreleased] พร้อม ✓");
    return;
  }

  const lastTag = tryGit("describe", "--tags", "--abbrev=0");
  const range = lastTag === null ? "HEAD" : `${lastTag}..HEAD`;
  const { entries, skipped } = collectEntries(range, git);
  if (entries.length === 0) {
    fail(
      `[Unreleased] ว่าง และไม่มี commit ที่เข้าเกณฑ์ใน ${range} (ข้าม ${skipped}) — เขียนรายการเองก่อนตัดรุ่น`,
    );
  }

  writeFileSync(CHANGELOG_FILE, withDraft(markdown, renderDraft(entries)));
  const dropped = skipped === 0 ? "" : ` (ข้าม ${skipped} commit)`;
  console.log(`▸ changelog ........ เขียนร่าง ${entries.length} รายการจาก ${range}${dropped}`);
  fail(
    `[Unreleased] ใน ${CHANGELOG_FILE} เป็นร่างดิบจาก commit — แก้ให้เป็นภาษาคนแล้วรัน build:bump ซ้ำ\n  ไม่ต้อง commit ไฟล์นี้: release commit จะรวมให้เอง`,
  );
}

/**
 * Uses only already-fetched remote-tracking refs — never runs `git fetch`.
 * No upstream configured is not an error and is skipped, not aborted. Being
 * *ahead* of upstream is normal and does not abort either. Being *behind*
 * means the tag would land on a commit that `git push` will reject as
 * non-fast-forward — and the intuitive fix, `git pull --rebase`, moves the
 * release commit out from under the already-created annotated tag. So this
 * runs before the prompt, alongside the other instant guards.
 */
function assertUpToDate(): void {
  const upstream = tryGit("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}");
  if (upstream === null) {
    console.log("▸ upstream ......... skip (ไม่มี upstream) ✓");
    return;
  }

  const behind = Number(git("rev-list", "--count", "HEAD..@{upstream}"));
  if (behind !== 0) {
    fail(`local อยู่หลัง ${upstream} ${behind} commit — git pull ก่อนรันซ้ำ`);
  }
  console.log(`▸ upstream ......... up to date (${upstream}) ✓`);
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
 *
 * A gate must never write a git-tracked file: `release()` stages `package.json`
 * and `CHANGELOG.md` without re-checking the tree, so anything a gate dirtied
 * would be left behind uncommitted next to a finished release. Today that holds
 * only because `tsconfig.json`'s `"incremental": true` writes
 * `tsconfig.tsbuildinfo`, which `.gitignore` excludes.
 */
function gate(script: string, done: string): void {
  const result = spawnSync("bun", ["run", "--silent", script], { stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`✗ ${script} ไม่ผ่าน`);
    process.exit(result.status ?? 1);
  }
  console.log(done);
}

/** Runs a git step that mutates the repo, showing git's own output, or fails with how to undo it. */
function gitStep(args: string[], recovery: string): void {
  const result = spawnSync("git", args, { stdio: ["ignore", "inherit", "inherit"] });
  if (result.status === 0) return;
  fail(`git ${args[0]} ล้มเหลว\n  กู้คืนด้วย: ${recovery}`);
}

/**
 * Bumps `package.json`, moves `[Unreleased]` into the new version's heading and
 * lands both as one commit plus its tag.
 *
 * `bun pm version` runs with `--no-git-tag-version` and the commit is made here
 * instead: it refuses to run at all while `CHANGELOG.md` carries the edited
 * draft — a staged file still counts as unclean — and the changelog entry has to
 * be inside the commit the tag points at, not a commit after it.
 */
function release(level: Level, version: string): void {
  const bump = spawnSync("bun", ["pm", "version", level, "--no-git-tag-version"], {
    stdio: "inherit",
  });
  if (bump.status !== 0) {
    fail(
      `bun pm version ล้มเหลว (exit ${bump.status ?? "?"}) — package.json อาจถูก bump ไว้แล้ว ตรวจด้วย git status\n  กู้คืนด้วย: git restore package.json`,
    );
  }

  const undo = `git restore package.json ${CHANGELOG_FILE}`;
  try {
    writeFileSync(CHANGELOG_FILE, promote(readChangelog(), version, todayUtc()));
  } catch (error) {
    fail(`${error instanceof Error ? error.message : String(error)}\n  กู้คืนด้วย: ${undo}`);
  }

  const tag = `v${version}`;
  gitStep(["add", "--", "package.json", CHANGELOG_FILE], undo);
  gitStep(["commit", "-m", `chore(release): ${tag}`], `git restore --staged --worktree . ; ${undo}`);
  gitStep(["tag", "-a", tag, "-m", tag], "git reset --hard HEAD~1");
}

async function main(): Promise<void> {
  const current = readVersion();
  const next = nextVersions(current);
  if (!next) fail(`อ่านเวอร์ชันจาก package.json ไม่ได้: ${current}`);

  assertBranchAndTree();
  assertUpToDate();
  assertChangelogReady();

  const level = parseLevelArg() ?? (await promptLevel(current, next));
  if (level === null) {
    console.log("ยกเลิก — ไม่มีอะไรเปลี่ยน");
    return;
  }

  const target = next[level];
  assertTagFree(target);

  gate("typecheck", "▸ typecheck ........ ✓");
  gate("lint", "▸ lint ............. ✓");

  release(level, target);

  console.log(`✓ v${target}`);
  console.log(`  commit  chore(release): v${target}`);
  console.log(`  tag     v${target} (annotated)`);
  console.log(`  files   package.json, ${CHANGELOG_FILE}`);
  console.log("");
  console.log(`→ ขั้นต่อไป: git push origin main && git push origin v${target}`);
}

await main();
