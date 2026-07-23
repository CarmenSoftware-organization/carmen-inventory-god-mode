import { expect, test } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { CATALOG } from "@/lib/platform-migrations";
import { DEFAULT_REL } from "@/lib/platform-package";

// Import DEFAULT_REL to keep path in sync; module import has no env() side effect.
function readRealScripts(): Record<string, string> | null {
  const dir = process.env.PLATFORM_PACKAGE_DIR ?? path.resolve(process.cwd(), DEFAULT_REL);
  try {
    const raw = fs.readFileSync(path.join(dir, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
    return parsed.scripts ?? null;
  } catch {
    return null;
  }
}

const scripts = readRealScripts();

// Skip when the backend package isn't present (e.g. CI without the sibling repo).
test.skipIf(!scripts)(
  "every script-kind catalog op maps to a real package script",
  () => {
    // Sanity: we actually read a populated scripts map, so the assertions below
    // are not vacuously true against an empty/misread object.
    expect(scripts!["db:seed.permission"]).toBeTypeOf("string");

    const missing = CATALOG.filter((o) => o.kind === "script" && scripts![o.run] === undefined);
    expect(missing.map((o) => `${o.id} → ${o.run}`)).toEqual([]);
  },
);

// Reverse direction: catch a new upstream operator-facing script that nobody
// wired into the catalog. Scoped to db:seed.* / db:check.* so intentionally
// unsurfaced scripts (db:generate, db:migrate, db:deploy, db:migrate:reset,
// build) stay out of scope.
test.skipIf(!scripts)(
  "every db:seed.* and db:check.* package script is surfaced in the catalog",
  () => {
    const catalogRuns = new Set(CATALOG.map((o) => o.run));
    const unsurfaced = Object.keys(scripts!)
      .filter((name) => /^db:(seed|check)\./.test(name) && !catalogRuns.has(name))
      .sort();
    expect(unsurfaced).toEqual([]);
  },
);
