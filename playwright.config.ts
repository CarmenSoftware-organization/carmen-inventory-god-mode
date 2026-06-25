import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  webServer: { command: "bun run dev", url: "http://localhost:3305/login", reuseExistingServer: true, timeout: 60_000 },
  use: { baseURL: "http://localhost:3305" },
});
