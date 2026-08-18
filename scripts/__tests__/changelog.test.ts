import { expect, test } from "vitest";
import {
  classify,
  collectEntries,
  hasEntries,
  promote,
  renderDraft,
  unreleasedBody,
  withDraft,
  withUnreleasedBody,
  type Entry,
} from "@/scripts/changelog";

const HEADER = `# Changelog

รูปแบบตาม [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]
`;

function doc(unreleased: string, tail = "## [0.3.0] — 2026-08-18\n\n### Fixed\n\n- เดิม (#23)\n"): string {
  return `${HEADER}${unreleased}\n${tail}`;
}

test("classify maps feat to Added and strips the type prefix", () => {
  expect(classify("feat: surface a pool mismatch")).toEqual({
    section: "Added",
    text: "surface a pool mismatch",
    breaking: false,
  });
});

test("classify maps fix to Fixed and drops the scope", () => {
  expect(classify("fix(e2e): repair the streaming-delete spec")).toEqual({
    section: "Fixed",
    text: "repair the streaming-delete spec",
    breaking: false,
  });
});

test("classify maps security to Security and perf/refactor to Changed", () => {
  expect(classify("security: escape rendered html")?.section).toBe("Security");
  expect(classify("perf: batch the registry reads")?.section).toBe("Changed");
  expect(classify("refactor: split the guard module")?.section).toBe("Changed");
});

test("classify skips housekeeping types", () => {
  expect(classify("chore: add graft config")).toBeNull();
  expect(classify("docs: require a PR for every change")).toBeNull();
  expect(classify("test: cover the pool guard")).toBeNull();
  expect(classify("ci: pin the runner image")).toBeNull();
  expect(classify("chore(release): v0.3.0")).toBeNull();
});

test("classify marks a bang as breaking", () => {
  expect(classify("feat!: drop the legacy column")).toEqual({
    section: "Added",
    text: "drop the legacy column",
    breaking: true,
  });
  expect(classify("fix(api)!: reject unscoped tokens")?.breaking).toBe(true);
});

test("classify files a non-conventional subject under Changed rather than dropping it", () => {
  expect(classify("Bump the platform package")).toEqual({
    section: "Changed",
    text: "Bump the platform package",
    breaking: false,
  });
});

test("renderDraft groups entries in Keep a Changelog order with their refs", () => {
  const entries: Entry[] = [
    { section: "Fixed", text: "stop an abandoned run", breaking: false, ref: "#23" },
    { section: "Added", text: "surface a pool mismatch", breaking: false, ref: "#19" },
    { section: "Fixed", text: "resolve tenant schema", breaking: false, ref: "ca3b066" },
  ];

  expect(renderDraft(entries)).toBe(
    [
      "### Added",
      "",
      "- surface a pool mismatch (#19)",
      "",
      "### Fixed",
      "",
      "- stop an abandoned run (#23)",
      "- resolve tenant schema (ca3b066)",
      "",
    ].join("\n"),
  );
});

test("renderDraft flags breaking entries", () => {
  const entries: Entry[] = [
    { section: "Changed", text: "drop the legacy column", breaking: true, ref: "#42" },
  ];
  expect(renderDraft(entries)).toContain("- **BREAKING** drop the legacy column (#42)");
});

test("unreleasedBody returns only the text under the Unreleased heading", () => {
  const md = doc("\n### Fixed\n\n- ยังไม่ปล่อย (#30)\n");
  expect(unreleasedBody(md)).toBe("\n### Fixed\n\n- ยังไม่ปล่อย (#30)\n\n");
});

test("unreleasedBody throws when the heading is missing", () => {
  expect(() => unreleasedBody("# Changelog\n\n## [0.3.0] — 2026-08-18\n")).toThrow(/Unreleased/);
});

test("hasEntries sees bullets but not blank space or comments", () => {
  expect(hasEntries("\n\n")).toBe(false);
  expect(hasEntries("\n<!-- เขียนรายการของรุ่นถัดไปที่นี่ -->\n")).toBe(false);
  expect(hasEntries("\n### Fixed\n\n")).toBe(false);
  expect(hasEntries("\n### Fixed\n\n- อะไรสักอย่าง (#30)\n")).toBe(true);
});

test("withUnreleasedBody swaps the section and leaves the rest of the file alone", () => {
  const md = doc("\n");
  const next = withUnreleasedBody(md, "\n### Added\n\n- ใหม่ (#31)\n\n");

  expect(unreleasedBody(next)).toBe("\n### Added\n\n- ใหม่ (#31)\n\n");
  expect(next.startsWith("# Changelog\n")).toBe(true);
  expect(next).toContain("## [0.3.0] — 2026-08-18");
  expect(next).toContain("- เดิม (#23)");
});

test("promote moves the Unreleased entries under a dated version heading", () => {
  const md = doc("\n### Fixed\n\n- พร้อมปล่อย (#30)\n");
  const next = promote(md, "0.4.0", "2026-08-19");

  expect(next).toContain("## [0.4.0] — 2026-08-19\n\n### Fixed\n\n- พร้อมปล่อย (#30)\n");
  expect(next).toContain("## [0.3.0] — 2026-08-18");
  expect(next.indexOf("## [0.4.0]")).toBeLessThan(next.indexOf("## [0.3.0]"));
});

test("promote leaves an empty Unreleased heading behind", () => {
  const md = doc("\n### Fixed\n\n- พร้อมปล่อย (#30)\n");
  const next = promote(md, "0.4.0", "2026-08-19");

  expect(hasEntries(unreleasedBody(next))).toBe(false);
});

test("promote leaves the placeholder comment in Unreleased instead of shipping it", () => {
  const md = doc("\n<!-- เขียนร่างตรงนี้ -->\n\n### Fixed\n\n- พร้อมปล่อย (#30)\n");
  const next = promote(md, "0.4.0", "2026-08-19");

  expect(next).toContain("## [0.4.0] — 2026-08-19\n\n### Fixed\n\n- พร้อมปล่อย (#30)\n");
  expect(unreleasedBody(next)).toContain("<!-- เขียนร่างตรงนี้ -->");
  expect(next.slice(next.indexOf("## [0.4.0]"))).not.toContain("เขียนร่างตรงนี้");
});

test("withDraft puts generated entries under the placeholder comment, replacing an older draft", () => {
  const md = doc("\n<!-- เขียนร่างตรงนี้ -->\n\n### Fixed\n\n- ร่างเก่า (#29)\n");
  const next = withDraft(md, "### Added\n\n- ร่างใหม่ (#31)\n");

  expect(unreleasedBody(next)).toBe("\n<!-- เขียนร่างตรงนี้ -->\n\n### Added\n\n- ร่างใหม่ (#31)\n\n");
  expect(next).toContain("- เดิม (#23)");
});

test("promote refuses a version that is already in the file", () => {
  const md = doc("\n### Fixed\n\n- พร้อมปล่อย (#30)\n");
  expect(() => promote(md, "0.3.0", "2026-08-19")).toThrow(/0\.3\.0/);
});

/** A `git` stand-in that answers from a fixed table keyed by the joined args. */
function fakeGit(answers: Record<string, string>): (...args: string[]) => string {
  return (...args: string[]) => {
    const key = args.join(" ");
    if (!(key in answers)) throw new Error(`fakeGit ไม่รู้จักคำสั่ง: git ${key}`);
    return answers[key];
  };
}

const WALK = "log --first-parent --reverse --pretty=%h%x00%P%x00%s v0.3.0..HEAD";

test("collectEntries credits each commit of a merged PR to that PR number", () => {
  const git = fakeGit({
    [WALK]: "aaa1111\0par1 side1\0Merge pull request #25 from org/feature/thing",
    "log --no-merges --reverse --pretty=%h%x00%s par1..side1":
      "bbb2222\0feat: add the thing\nccc3333\0fix: unbreak the thing",
  });

  expect(collectEntries("v0.3.0..HEAD", git)).toEqual({
    entries: [
      { section: "Added", text: "add the thing", breaking: false, ref: "#25" },
      { section: "Fixed", text: "unbreak the thing", breaking: false, ref: "#25" },
    ],
    skipped: 0,
  });
});

test("collectEntries falls back to the short hash for a commit landed straight on main", () => {
  const git = fakeGit({
    [WALK]: "ddd4444\0par1\0fix: land it directly",
  });

  expect(collectEntries("v0.3.0..HEAD", git)).toEqual({
    entries: [{ section: "Fixed", text: "land it directly", breaking: false, ref: "ddd4444" }],
    skipped: 0,
  });
});

test("collectEntries drops housekeeping commits and counts them as skipped", () => {
  const git = fakeGit({
    [WALK]: "eee5555\0par1\0chore: tidy up",
  });

  expect(collectEntries("v0.3.0..HEAD", git)).toEqual({ entries: [], skipped: 1 });
});

test("collectEntries returns nothing for an empty range", () => {
  expect(collectEntries("v0.3.0..HEAD", fakeGit({ [WALK]: "" }))).toEqual({
    entries: [],
    skipped: 0,
  });
});

test("collectEntries walks a merge that is not a PR and refs it by the merge hash", () => {
  const git = fakeGit({
    [WALK]: "fff6666\0par1 side2\0Merge branch 'UAT'",
    "log --no-merges --reverse --pretty=%h%x00%s par1..side2": "999aaaa\0fix: patch from UAT",
  });

  expect(collectEntries("v0.3.0..HEAD", git)).toEqual({
    entries: [{ section: "Fixed", text: "patch from UAT", breaking: false, ref: "fff6666" }],
    skipped: 0,
  });
});
