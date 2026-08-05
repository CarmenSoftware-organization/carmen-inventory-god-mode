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
