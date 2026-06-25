import { expect, test } from "vitest";
import { loadEnv } from "@/lib/env";

const base = {
  SYSTEM_DATABASE_URL: "postgresql://u:p@h:6432/postgres",
  DATABASE_URL: "postgresql://u:p@h:6432/postgres",
  GOD_MODE_PASSWORD: "secret",
  SESSION_SECRET: "x".repeat(32),
};

test("parses with defaults", () => {
  const env = loadEnv(base);
  expect(env.systemSchemaName).toBe("CARMEN_SYSTEM");
  expect(env.cascadeMaxRows).toBe(5000);
  expect(env.cascadeMaxDepth).toBe(20);
});

test("throws when a required var is missing", () => {
  expect(() => loadEnv({ ...base, GOD_MODE_PASSWORD: undefined })).toThrow();
});

test("rejects a short session secret", () => {
  expect(() => loadEnv({ ...base, SESSION_SECRET: "short" })).toThrow();
});
