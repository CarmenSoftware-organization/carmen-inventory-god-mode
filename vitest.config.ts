import { defineConfig } from "vitest/config";
import path from "node:path";

// Vitest 3: per-environment splits use `test.projects` (the old
// `environmentMatchGlobs` is deprecated). Shared settings (resolve alias,
// timeout, no file parallelism) live at the root and are inherited via
// `extends: true`. `*.test.tsx` → jsdom; everything else (incl. `*.int.test.ts`)
// → node.
export default defineConfig({
  test: {
    testTimeout: 60_000,
    fileParallelism: false,
    projects: [
      {
        extends: true,
        test: { name: "node", environment: "node", include: ["**/*.test.ts"] },
      },
      {
        extends: true,
        test: { name: "jsdom", environment: "jsdom", include: ["**/*.test.tsx"] },
      },
    ],
  },
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
});
