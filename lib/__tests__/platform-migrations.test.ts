import { expect, test } from "vitest";
import {
  CATALOG, findOp, validateBuCode, validateOnlyPrefix, buildArgv, canRun, validateSchemaName,
} from "@/lib/platform-migrations";

test("catalog exposes the expected operation ids across groups", () => {
  const ids = CATALOG.map((o) => o.id);
  expect(ids).toEqual(expect.arrayContaining([
    "prisma-status", "prisma-deploy",
    "tenant-apply", "tenant-revert",
    "seed", "seed-permission", "seed-platform-super-admin",
    "migrate-reset", "seed-reset", "mock-reset",
  ]));
  expect(findOp("prisma-status")?.readonly).toBe(true);
  expect(findOp("prisma-deploy")?.writes).toBe(true);
  expect(findOp("migrate-reset")?.destructive).toBe(true);
});

test("findOp returns undefined for unknown ids", () => {
  expect(findOp("nope")).toBeUndefined();
});

test("validateBuCode requires a known active code and a safe charset", () => {
  expect(validateBuCode("T03", ["T03", "T04"])).toBe(true);
  expect(validateBuCode("T99", ["T03"])).toBe(false);          // not active
  expect(validateBuCode("T03; DROP", ["T03; DROP"])).toBe(false); // bad charset
});

test("validateOnlyPrefix requires a matching existing file and a safe charset", () => {
  const files = ["001_v_operational_product_list.up.sql"];
  expect(validateOnlyPrefix("001_v_operational", files)).toBe(true);
  expect(validateOnlyPrefix("999_nope", files)).toBe(false);
  expect(validateOnlyPrefix("001 rm -rf", files)).toBe(false);
});

test("buildArgv builds bun argv for script and bin ops, with -- separated args", () => {
  expect(buildArgv(findOp("prisma-status")!, {})).toEqual(["x", "prisma", "migrate", "status"]);
  expect(buildArgv(findOp("prisma-deploy")!, {})).toEqual(["run", "db:deploy"]);
  expect(buildArgv(findOp("tenant-apply")!, { bu: "T03" }))
    .toEqual(["run", "db:tenant-views:apply", "--", "--bu", "T03"]);
  expect(buildArgv(findOp("tenant-apply")!, { only: "001_v" }))
    .toEqual(["run", "db:tenant-views:apply", "--", "--only", "001_v"]);
});

test("buildArgv ignores bu/only on ops that do not accept them", () => {
  expect(buildArgv(findOp("seed")!, { bu: "T03", only: "x" })).toEqual(["run", "db:seed"]);
});

test("every catalog op satisfies the gate invariants", () => {
  for (const op of CATALOG) {
    if (op.destructive) expect(op.writes).toBe(true);
    if (op.readonly) expect(op.writes).toBe(false);
  }
});

test("validateSchemaName classifies known / new / invalid names", () => {
  const existing = ["CARMEN_SYSTEM", "public"];
  expect(validateSchemaName("CARMEN_SYSTEM", existing)).toBe("known");
  expect(validateSchemaName("NEW_ENV", existing)).toBe("new");
  expect(validateSchemaName("bad;name", existing)).toBe("invalid");
  expect(validateSchemaName("1leading", existing)).toBe("invalid");
  expect(validateSchemaName("", existing)).toBe("invalid");
});

test("canRun gates writes on the schema phrase, destructive checkbox, and new-schema checkbox", () => {
  const status = findOp("prisma-status")!;
  const deploy = findOp("prisma-deploy")!;
  const reset = findOp("migrate-reset")!;
  const known = ["CARMEN_SYSTEM"];
  const base = { schema: "CARMEN_SYSTEM", knownSchemas: known, destroyChecked: false, createChecked: false };

  // read-only: runs as long as the schema is a valid name
  expect(canRun(status, { ...base, confirm: "" })).toBe(true);
  expect(canRun(status, { ...base, schema: "bad;name", confirm: "" })).toBe(false);

  // write: confirm must equal the schema
  expect(canRun(deploy, { ...base, confirm: "wrong" })).toBe(false);
  expect(canRun(deploy, { ...base, confirm: "CARMEN_SYSTEM" })).toBe(true);

  // destructive: also needs the destroy checkbox
  expect(canRun(reset, { ...base, confirm: "CARMEN_SYSTEM" })).toBe(false);
  expect(canRun(reset, { ...base, confirm: "CARMEN_SYSTEM", destroyChecked: true })).toBe(true);

  // new schema on a write: needs the create checkbox
  expect(canRun(deploy, { ...base, schema: "NEW_ENV", confirm: "NEW_ENV" })).toBe(false);
  expect(canRun(deploy, { ...base, schema: "NEW_ENV", confirm: "NEW_ENV", createChecked: true })).toBe(true);
});
