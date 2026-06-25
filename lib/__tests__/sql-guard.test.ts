import { expect, test } from "vitest";
import { ident, qualified, classifyStatement } from "@/lib/sql-guard";

test("ident quotes a normal name", () => {
  expect(ident("tb_user")).toBe('"tb_user"');
});

test("ident preserves case and escapes embedded quotes", () => {
  expect(ident("CARMEN_SYSTEM")).toBe('"CARMEN_SYSTEM"');
  expect(ident('we"ird')).toBe('"we""ird"');
});

test("ident rejects dangerous names", () => {
  expect(() => ident("")).toThrow();
  expect(() => ident("a".repeat(64))).toThrow();
  expect(() => ident("a\0b")).toThrow();
});

test("qualified joins schema and table", () => {
  expect(qualified("CARMEN_SYSTEM", "tb_business_unit")).toBe('"CARMEN_SYSTEM"."tb_business_unit"');
});

test("classifyStatement detects reads", () => {
  expect(classifyStatement("SELECT * FROM t")).toBe("read");
  expect(classifyStatement("  -- c\n  select 1")).toBe("read");
  expect(classifyStatement("WITH x AS (SELECT 1) SELECT * FROM x")).toBe("read");
  expect(classifyStatement("EXPLAIN SELECT 1")).toBe("read");
});

test("classifyStatement detects writes", () => {
  expect(classifyStatement("UPDATE t SET a=1")).toBe("write");
  expect(classifyStatement("DELETE FROM t")).toBe("write");
  expect(classifyStatement("DROP TABLE t")).toBe("write");
  expect(classifyStatement("EXPLAIN ANALYZE DELETE FROM t")).toBe("write");
  expect(classifyStatement("WITH x AS (DELETE FROM t RETURNING *) SELECT * FROM x")).toBe("write");
});
