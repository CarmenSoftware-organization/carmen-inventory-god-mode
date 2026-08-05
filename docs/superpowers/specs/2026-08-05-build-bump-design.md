# build:bump — release version bump script

Date: 2026-08-05
Branch base: main (branch: `feature/build-bump-script`)

## Goal

Add a `bun run build:bump` script that cuts an official release: bump the version
in `package.json`, create a release commit, and create an annotated git tag —
locally only. Pushing stays a manual step.

The repo currently has **no release mechanism at all**: `package.json` sits at
`0.1.0`, that field is read by nothing in the codebase, and `git tag` returns
zero tags. This script bootstraps the tag history.

## Background

- `package.json` is `"private": true`, so the `version` field has no packaging
  effect. Its only purpose here is to be the source of truth for the tag name.
- Existing scripts: `dev`, `dev:local`, `dev:prod`, `dev:uat`, `build`, `start`,
  `lint`, `test`, `test:watch`, `typecheck`. There is no `build:bump`.
- `CLAUDE.md` branching rules: `main` is production and protected, `develop` is
  integration, feature work happens on `feature/*`.

### Bun provides most of this already

Verified against Bun **1.3.14** in a throwaway git repo:

```
bun pm version [patch|minor|major|prerelease|from-git|<version>]
  --no-git-tag-version   Skip git operations
  --allow-same-version   Prevents throwing error if version is the same
  --message=<val>, -m    Custom commit message, use %s for version substitution
  --preid=<val>          Prerelease identifier
  --force, -f            Bypass dirty git history check
```

`bun pm version patch` was observed to:

- rewrite `package.json` `0.1.0 → 0.1.1`, preserving the existing formatting;
- create a git commit (message customisable via `-m "… %s"`);
- create tag `v0.1.1` — **annotated** (`git cat-file -t v0.1.1` returns `tag`);
- refuse to run on a dirty tree: `error: Git working directory not clean.`

`bun pm version` with **no increment argument** prints the current version and an
increment table, then exits. It does **not** prompt.

So the only things missing are the shell around it: a branch guard, a
typecheck/lint gate, and an interactive level prompt.

### Decisions captured during brainstorming

- **Purpose:** official release/tag — not a UI build stamp, not a cache-busting
  rebuild. Rejected: surfacing the version in the app UI (nothing reads it today;
  YAGNI).
- **Bump level:** chosen **interactively at run time**, with a preview of the
  resulting version for each level. Rejected: conventional-commit inference
  (needs a bootstrap tag and encodes more magic than this repo needs) and
  date-based versions.
- **Git scope:** stops at **local commit + tag**. No push, no
  `gh release create`. Rationale: a local mistake is undone with `git reset` +
  `git tag -d`; once pushed it is public. Also `main` is protected, so an
  automatic push would fail anyway.
- **Pre-flight gate:** branch/tree/tag guards plus `typecheck` and `lint`.
  Rejected: also running the 227-test suite and `next build` — the integration
  tests spin up embedded-postgres and `next build` may need live env for
  prerendering, which makes a release script slow and environment-dependent.
- **Branch guard:** `main` only. Release tags belong on the production branch;
  running elsewhere aborts rather than prompting.
- **Implementation shape:** thin wrapper delegating to `bun pm version`.
  Rejected: hand-rolling semver parsing, JSON rewriting and annotated-tag
  creation (~80 lines of avoidable risk for no gain), and a pure
  `package.json`-only chain such as
  `"build:bump": "bun run typecheck && bun run lint && bun pm version"` (no
  branch guard, and no prompt — the user would have to type a second command).

## Design

### Files

| File | Change |
| --- | --- |
| `scripts/bump.ts` | New. The whole implementation. |
| `package.json` | Add `"build:bump": "bun scripts/bump.ts"`. |

`scripts/` does not exist yet and is created by this change.

### Structure of `scripts/bump.ts`

Four units, each independently understandable:

- **`nextVersions(current: string): { patch, minor, major }`** — pure. Parses
  `MAJOR.MINOR.PATCH` and returns the three candidate versions. No IO. This is
  the only piece with real logic, and it is the only piece worth testing.
- **`assertBranchAndTree(): void`** — instant `git` checks: current branch is
  `main`, working tree is clean.
- **`assertTagFree(version: string): void`** — instant. Aborts if `v<version>`
  already exists. Deliberately checks only the **chosen** version, not all three
  candidates: an existing `v0.1.1` must not block a `minor` bump to `v0.2.0`.
- **`promptLevel(current, candidates): "patch" | "minor" | "major" | null`** —
  writes the menu to stdout and reads a line from stdin. Returns `null` when the
  user cancels. Zero dependencies — Bun reads stdin directly.
- **`main()`** — reads the current version from `package.json` and sequences
  everything, then shells out to `bun pm version`.

### Execution order

```
1. read version from package.json + nextVersions()
2. assertBranchAndTree()            instant — fail before the user invests time
3. promptLevel()                    user answers immediately, no waiting
4. assertTagFree(chosen)            instant
5. bun run typecheck                ~10-20s
6. bun run lint
7. bun pm version <level> -m "chore(release): %s"
8. print the push command as the suggested next step
```

The expensive checks run **after** the prompt on purpose: the user is not made
to wait before being asked, and because nothing is written to disk until step 7,
a failure at step 5 or 6 costs only the answer, not a partial release.

### Terminal output

```
$ bun run build:bump
▸ branch ........... main ✓
▸ working tree ..... clean ✓

  current: 0.1.0
  ? เลือกระดับ bump
    1) patch  → 0.1.1
    2) minor  → 0.2.0
    3) major  → 1.0.0
    q) ยกเลิก
  > 1

▸ typecheck ........ ✓
▸ lint ............. ✓
✓ v0.1.1
  commit  chore(release): v0.1.1
  tag     v0.1.1 (annotated)

→ ขั้นต่อไป: git push origin main && git push origin v0.1.1
```

Prompt text is Thai, matching the operator-facing language used elsewhere in
this tool.

### Non-interactive form

```
bun run build:bump patch
bun run build:bump minor
bun run build:bump major
```

When a valid level is passed as an argument, step 2 is skipped; every guard and
gate still runs. This exists so the script can be exercised without a TTY —
required for verification here, and for CI later.

### Error handling

Every failure exits non-zero **before** anything is written:

| Condition | Behaviour |
| --- | --- |
| Not on `main` | `✗ build:bump ต้องรันบน main (ตอนนี้อยู่ <branch>)`, exit 1 |
| Dirty working tree | print `git status --short`, exit 1 |
| Tag for the chosen version exists | `✗ tag v0.1.1 มีอยู่แล้ว`, exit 1 |
| `typecheck` or `lint` fails | forward the tool's raw output, exit with its code |
| Invalid level argument | `✗ ระดับต้องเป็น patch\|minor\|major`, exit 1 |
| Unparseable current version | `✗ อ่านเวอร์ชันจาก package.json ไม่ได้: <value>`, exit 1 |
| `q` or EOF at the prompt | exit 0, nothing done |

Subprocess output is forwarded, never swallowed — a failing `typecheck` must
show which file failed.

The tag-exists check duplicates what `git tag` would eventually reject, but doing
it up front means the script never fails *after* `package.json` has been
rewritten, which would leave the working tree dirty.

### Out of scope

- Pushing, `gh release create`, CHANGELOG generation.
- Running the test suite or `next build` as part of the gate.
- Displaying the version anywhere in the app UI.
- Prerelease / `--preid` support — `bun pm version prerelease --preid beta` is
  available directly if it is ever wanted.

## Verification

- `bun run typecheck` and `bun run lint` clean (the repo's lint is clean
  repo-wide and must stay that way).
- Exercise the non-interactive path (`bun run build:bump patch`) in a **throwaway
  git repo under the scratchpad** and confirm the resulting commit message, the
  annotated tag, and the rewritten `package.json`. The real repo is not tagged
  until the operator asks for it.
- Manually exercise each guard: run on a non-`main` branch, run with a dirty
  tree, run with the target tag already present.

Per the operator's standing preference, no `*.test.ts` is written unless
requested in the same turn; `nextVersions()` is nonetheless kept pure so it can
be covered later without restructuring.
