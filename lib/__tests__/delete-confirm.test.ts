import { expect, test } from "vitest";
import { requiredPhrase, phraseMatches } from "@/lib/delete-confirm";

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
