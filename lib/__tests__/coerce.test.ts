import { expect, test } from "vitest";
import { coerceValue } from "@/lib/coerce";
import type { ColumnInfo } from "@/lib/introspect";

const col = (over: Partial<ColumnInfo>): ColumnInfo => ({ name: "c", dataType: "text", udtName: "text", isNullable: true, default: null, isPrimaryKey: false, ...over });

test("null toggle wins", () => { expect(coerceValue(col({}), "ignored", true)).toBeNull(); });
test("int4 parses to number", () => { expect(coerceValue(col({ udtName: "int4" }), "42", false)).toBe(42); });
test("bool parses", () => { expect(coerceValue(col({ udtName: "bool" }), "true", false)).toBe(true); });
test("jsonb parses", () => { expect(coerceValue(col({ udtName: "jsonb" }), '{"a":1}', false)).toEqual({ a: 1 }); });
test("bad number throws", () => { expect(() => coerceValue(col({ udtName: "int4" }), "abc", false)).toThrow(); });
test("bad json throws", () => { expect(() => coerceValue(col({ udtName: "jsonb" }), "{", false)).toThrow(); });
