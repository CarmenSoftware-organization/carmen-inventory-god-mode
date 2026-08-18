import { expect, test } from "vitest";
import {
  parseConnectionIdentity, poolMatches, describeIdentity, poolGuardError,
} from "@/lib/db-pool";

const target = { host: "dev.blueledgers.com", port: 6432, database: "postgres" };

test("parseConnectionIdentity reads host/port/database and lowercases the host", () => {
  expect(parseConnectionIdentity("postgresql://u:p@Dev.BlueLedgers.com:6432/postgres?sslmode=require"))
    .toEqual(target);
});

test("parseConnectionIdentity defaults the port to 5432", () => {
  expect(parseConnectionIdentity("postgres://u:p@localhost/mydb"))
    .toEqual({ host: "localhost", port: 5432, database: "mydb" });
});

test("parseConnectionIdentity rejects a url it cannot read", () => {
  expect(() => parseConnectionIdentity("not-a-url")).toThrow();
});

test("poolMatches compares host, port and database", () => {
  expect(poolMatches({ host: "DEV.BlueLedgers.com", port: 6432, database: "postgres" }, target)).toBe(true);
  expect(poolMatches({ host: "other.host", port: 6432, database: "postgres" }, target)).toBe(false);
  expect(poolMatches({ host: "dev.blueledgers.com", port: 5432, database: "postgres" }, target)).toBe(false);
  expect(poolMatches({ host: "dev.blueledgers.com", port: 6432, database: "other" }, target)).toBe(false);
});

test("poolMatches treats an unknown pool as a non-match", () => {
  expect(poolMatches(null, target)).toBe(false);
});

test("describeIdentity renders host:port/database", () => {
  expect(describeIdentity(target)).toBe("dev.blueledgers.com:6432/postgres");
});

test("poolGuardError passes when every business unit sits on the connected host", () => {
  const rows = [
    { id: "1", code: "BLAVG", dbSchema: "BL_AVG", pool: target },
    { id: "2", code: "BLFIFO", dbSchema: "BL_FIFO", pool: { ...target } },
  ];
  expect(poolGuardError(rows, target)).toBeNull();
});

test("poolGuardError names the business unit whose pool points elsewhere", () => {
  const rows = [
    { id: "1", code: "BLAVG", dbSchema: "BL_AVG", pool: target },
    { id: "2", code: "T02", dbSchema: "ZEBRA_AVG", pool: { host: "prod.example.com", port: 5432, database: "carmen" } },
  ];
  const msg = poolGuardError(rows, target);
  expect(msg).toContain("T02");
  expect(msg).toContain("prod.example.com:5432/carmen");
  expect(msg).toContain(describeIdentity(target));
});

test("poolGuardError refuses a business unit with a tenant schema but no pool", () => {
  const rows = [{ id: "1", code: "MOCK1", dbSchema: "mock_schema", pool: null }];
  expect(poolGuardError(rows, target)).toContain("MOCK1");
});

test("poolGuardError ignores business units that have no tenant schema to drop", () => {
  const rows = [{ id: "1", code: "MOCK1", dbSchema: null, pool: null }];
  expect(poolGuardError(rows, target)).toBeNull();
});
