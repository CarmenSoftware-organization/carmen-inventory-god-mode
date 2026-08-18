/**
 * CHANGELOG.md helpers for `build:bump`.
 *
 * Everything here is pure except `collectEntries`, which takes its `git` as a
 * parameter so it can be driven by a stand-in in tests.
 */

/** Keep a Changelog sections, in the order they are rendered. */
export const SECTIONS = ["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"] as const;
export type Section = (typeof SECTIONS)[number];

export type Entry = { section: Section; text: string; breaking: boolean; ref: string };
export type GitRunner = (...args: string[]) => string;

export const UNRELEASED_HEADING = "## [Unreleased]";

/** Conventional-commit types that map onto a section. */
const TYPE_SECTIONS: Record<string, Section> = {
  feat: "Added",
  fix: "Fixed",
  perf: "Changed",
  refactor: "Changed",
  revert: "Changed",
  security: "Security",
};

/**
 * Types that never reach a changelog: they describe the repo, not the tool.
 * `chore(release)` lives here too, which keeps the previous release commit out
 * of the next release's draft.
 */
const SKIPPED_TYPES = new Set(["chore", "docs", "test", "ci", "build", "style"]);

const CONVENTIONAL = /^([a-z]+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/;

/**
 * `null` means "leave this commit out of the draft". A subject that is not
 * conventional at all is filed under Changed rather than dropped — a silent
 * omission is worse than a line the author has to move.
 */
export function classify(subject: string): Omit<Entry, "ref"> | null {
  const trimmed = subject.trim();
  const match = CONVENTIONAL.exec(trimmed);
  if (!match) return { section: "Changed", text: trimmed, breaking: false };

  const type = match[1];
  if (SKIPPED_TYPES.has(type)) return null;

  return {
    section: TYPE_SECTIONS[type] ?? "Changed",
    text: match[4].trim(),
    breaking: match[3] === "!",
  };
}

/** Renders the body of an `## [Unreleased]` section — headings included. */
export function renderDraft(entries: Entry[]): string {
  const lines: string[] = [];
  for (const section of SECTIONS) {
    const rows = entries.filter((entry) => entry.section === section);
    if (rows.length === 0) continue;
    lines.push(`### ${section}`, "");
    for (const row of rows) {
      lines.push(`- ${row.breaking ? "**BREAKING** " : ""}${row.text} (${row.ref})`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** Character offsets of the `## [Unreleased]` body — from just after its heading to the next `## `. */
function unreleasedBounds(markdown: string): { start: number; end: number } {
  const heading = markdown.indexOf(`${UNRELEASED_HEADING}\n`);
  if (heading === -1) throw new Error(`CHANGELOG.md ไม่มีหัวข้อ ${UNRELEASED_HEADING}`);

  const start = heading + UNRELEASED_HEADING.length + 1;
  const next = markdown.indexOf("\n## ", start);
  return { start, end: next === -1 ? markdown.length : next + 1 };
}

export function unreleasedBody(markdown: string): string {
  const { start, end } = unreleasedBounds(markdown);
  return markdown.slice(start, end);
}

export function withUnreleasedBody(markdown: string, body: string): string {
  const { start, end } = unreleasedBounds(markdown);
  return markdown.slice(0, start) + body + markdown.slice(end);
}

const HEADING_LINE = /^\s*#{1,6}\s/;

/**
 * Flags each line that holds nothing but an HTML comment, carrying comment
 * state across lines so a `<!--` that closes further down still covers the
 * lines between. Done by scanning for the two delimiters rather than matching a
 * comment per line with a regex: a per-line pattern reads the middle of a
 * multi-line comment as prose, which would both block a redraft and carry the
 * placeholder down into a released version.
 */
function commentLines(lines: string[]): boolean[] {
  const flags: boolean[] = [];
  let open = false;

  for (const line of lines) {
    let rest = line;
    let outside = "";
    let touched = open;

    while (rest !== "") {
      if (open) {
        const close = rest.indexOf("-->");
        if (close === -1) break;
        open = false;
        rest = rest.slice(close + 3);
        continue;
      }

      const start = rest.indexOf("<!--");
      if (start === -1) {
        outside += rest;
        break;
      }
      outside += rest.slice(0, start);
      open = true;
      touched = true;
      rest = rest.slice(start + 4);
    }

    flags.push(touched && outside.trim() === "");
  }

  return flags;
}

/**
 * Whether a section body says anything yet: any line that is not blank, not a
 * comment and not a bare heading. Bullets do not get to be the test — this
 * repo's release notes are written as bold titles followed by prose, and
 * treating those as empty would let a redraft overwrite finished notes.
 */
export function hasEntries(body: string): boolean {
  const lines = body.split("\n");
  const comments = commentLines(lines);
  return lines.some(
    (line, index) => line.trim() !== "" && !comments[index] && !HEADING_LINE.test(line),
  );
}

/**
 * Separates the HTML comments in a section body — the "write the draft here"
 * placeholder — from the entries around them. The placeholder belongs to the
 * Unreleased heading itself and must survive both a redraft and a release
 * instead of being shipped inside a version's notes.
 */
function splitComments(body: string): { comments: string[]; rest: string } {
  const lines = body.split("\n");
  const flags = commentLines(lines);
  return {
    comments: lines.filter((_, index) => flags[index]),
    rest: lines.filter((_, index) => !flags[index]).join("\n"),
  };
}

/** Normalises a section body to one leading blank line, no repeated blanks, one trailing. */
function tidy(body: string): string {
  const trimmed = body.replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "").replace(/\n+$/, "");
  return trimmed === "" ? "\n" : `\n${trimmed}\n\n`;
}

/** Replaces whatever draft is under `## [Unreleased]`, keeping its placeholder comment. */
export function withDraft(markdown: string, draft: string): string {
  const { comments } = splitComments(unreleasedBody(markdown));
  const kept = comments.length === 0 ? "" : `\n${comments.join("\n")}\n`;
  return withUnreleasedBody(markdown, `${kept}${tidy(draft)}`);
}

/**
 * Moves the entries under `## [Unreleased]` down into a dated version heading,
 * leaving the Unreleased heading in place, empty, and still carrying its
 * placeholder comment.
 */
export function promote(markdown: string, version: string, date: string): string {
  const heading = `## [${version}]`;
  if (markdown.includes(heading)) throw new Error(`CHANGELOG.md มี ${heading} อยู่แล้ว`);

  const { comments, rest } = splitComments(unreleasedBody(markdown));
  const kept = comments.length === 0 ? "" : `\n${comments.join("\n")}\n`;
  return withUnreleasedBody(markdown, `${kept}\n${heading} — ${date}\n${tidy(rest)}`);
}

function splitLines(output: string): string[] {
  return output.split("\n").filter((line) => line !== "");
}

/**
 * Reads `range` as a list of draft entries.
 *
 * The walk is `--first-parent`, so a merged PR is one step: its commits are
 * read from the side of the merge and all credited to the PR number, which is
 * the reference this repo's release notes actually cite. A commit that landed
 * straight on the branch is referenced by its short hash instead.
 */
export function collectEntries(
  range: string,
  git: GitRunner,
): { entries: Entry[]; skipped: number } {
  const entries: Entry[] = [];
  let skipped = 0;

  const push = (subject: string, ref: string): void => {
    const change = classify(subject);
    if (!change) {
      skipped += 1;
      return;
    }
    entries.push({ ...change, ref });
  };

  for (const line of splitLines(
    git("log", "--first-parent", "--reverse", "--pretty=%h%x00%P%x00%s", range),
  )) {
    const [short, parents, subject] = line.split("\0");
    const parentList = parents.split(" ");

    if (parentList.length < 2) {
      push(subject, short);
      continue;
    }

    const pr = /^Merge pull request #(\d+)/.exec(subject);
    const ref = pr ? `#${pr[1]}` : short;
    const merged = git(
      "log",
      "--no-merges",
      "--reverse",
      "--pretty=%h%x00%s",
      `${parentList[0]}..${parentList[1]}`,
    );
    for (const row of splitLines(merged)) push(row.split("\0")[1], ref);
  }

  return { entries, skipped };
}
