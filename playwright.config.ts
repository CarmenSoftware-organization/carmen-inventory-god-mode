import { defineConfig } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Load .env.local into process.env so e2e specs can reach the DB + god-mode
// secret the same way `next dev` does. Existing env vars are not overridden.
try {
  for (const line of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val;
  }
} catch { /* .env.local is optional */ }

export default defineConfig({
  testDir: "./e2e",
  webServer: { command: "bun run dev", url: "http://localhost:3305/login", reuseExistingServer: true, timeout: 60_000 },
  use: { baseURL: "http://localhost:3305" },
});
