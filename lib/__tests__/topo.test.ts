import { expect, test } from "vitest";
import { orderTablesForDeletion, type TableRef } from "@/lib/topo";
import type { ForeignKey } from "@/lib/introspect";

const t = (table: string): TableRef => ({ schema: "app", table });
const fk = (child: string, parent: string): ForeignKey => ({
  childSchema: "app", childTable: child, childColumns: ["x"],
  parentSchema: "app", parentTable: parent, parentColumns: ["id"], onDelete: "NO ACTION",
});

test("children come before parents", () => {
  const { order } = orderTablesForDeletion([t("parent"), t("child")], [fk("child", "parent")]);
  expect(order.map((o) => o.table)).toEqual(["child", "parent"]);
});

test("multi-level ordering", () => {
  const { order } = orderTablesForDeletion(
    [t("a"), t("b"), t("c")], [fk("c", "b"), fk("b", "a")]);
  expect(order.map((o) => o.table)).toEqual(["c", "b", "a"]);
});

test("self reference does not deadlock", () => {
  const { order, cycles } = orderTablesForDeletion([t("node")], [fk("node", "node")]);
  expect(order.map((o) => o.table)).toEqual(["node"]);
  expect(cycles).toEqual([]);
});

test("genuine cycle is reported", () => {
  const { cycles } = orderTablesForDeletion([t("a"), t("b")], [fk("a", "b"), fk("b", "a")]);
  expect(cycles.length).toBeGreaterThan(0);
});
