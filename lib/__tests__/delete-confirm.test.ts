import { expect, test } from "vitest";
import { requiredPhrase, phraseMatches, radiusTouchesBusinessUnits } from "@/lib/delete-confirm";

test("plain delete requires DELETE", () => {
  expect(requiredPhrase({ isBusinessUnit: false, dropSchema: null })).toBe("DELETE");
});
test("schema drop requires the schema name", () => {
  expect(requiredPhrase({ isBusinessUnit: true, dropSchema: "BL_FIFO" })).toBe("BL_FIFO");
});
test("phraseMatches is exact", () => {
  expect(phraseMatches("DELETE", "DELETE")).toBe(true);
  expect(phraseMatches(" delete ", "DELETE")).toBe(false);
});

test("radiusTouchesBusinessUnits is true when system tb_business_unit is present", () => {
  const byTable = [
    { schema: "CARMEN_SYSTEM", table: "tb_cluster" },
    { schema: "CARMEN_SYSTEM", table: "tb_business_unit" },
  ];
  expect(radiusTouchesBusinessUnits(byTable, "CARMEN_SYSTEM")).toBe(true);
});

test("radiusTouchesBusinessUnits is false for other tables or a different schema", () => {
  expect(radiusTouchesBusinessUnits([{ schema: "CARMEN_SYSTEM", table: "tb_cluster" }], "CARMEN_SYSTEM")).toBe(false);
  expect(radiusTouchesBusinessUnits([{ schema: "app", table: "tb_business_unit" }], "CARMEN_SYSTEM")).toBe(false);
});
