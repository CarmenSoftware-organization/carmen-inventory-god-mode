import { expect, test } from "vitest";
import {
  CATALOG, findOp, validateBuCode, validateOnlyPrefix, buildArgv, canRun,
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

test("canRun gates writes on the DB-name phrase and destructive on the checkbox", () => {
  const status = findOp("prisma-status")!;
  const deploy = findOp("prisma-deploy")!;
  const reset = findOp("migrate-reset")!;
  expect(canRun(status, { confirm: "", dbName: "carmen", destroyChecked: false })).toBe(true);
  expect(canRun(deploy, { confirm: "wrong", dbName: "carmen", destroyChecked: false })).toBe(false);
  expect(canRun(deploy, { confirm: "carmen", dbName: "carmen", destroyChecked: false })).toBe(true);
  expect(canRun(reset, { confirm: "carmen", dbName: "carmen", destroyChecked: false })).toBe(false);
  expect(canRun(reset, { confirm: "carmen", dbName: "carmen", destroyChecked: true })).toBe(true);
});
