import { expect, test } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { CATALOG } from "@/lib/platform-migrations";

// Resolve the platform package the same way lib/platform-package.ts's
// packageDir() does, but WITHOUT going through env() (which validates the whole
// env schema and would throw when unrelated vars are unset in a bare test run).
const DEFAULT_REL = "../carmen-turborepo-backend-v2/packages/prisma-shared-schema-platform";

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
