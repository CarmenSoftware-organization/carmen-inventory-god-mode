import { expect, test, beforeAll } from "vitest";
beforeAll(() => {
  process.env.GOD_MODE_PASSWORD = "hunter2";
  process.env.SESSION_SECRET = "x".repeat(32);
  process.env.DATABASE_URL = "postgresql://u:p@h:6432/postgres";
  process.env.SYSTEM_DATABASE_URL = "postgresql://u:p@h:6432/postgres";
});

test("verifyPassword is correct and length-safe", async () => {
  const { verifyPassword } = await import("@/lib/session");
  expect(verifyPassword("hunter2")).toBe(true);
  expect(verifyPassword("wrong")).toBe(false);
  expect(verifyPassword("")).toBe(false);
});
