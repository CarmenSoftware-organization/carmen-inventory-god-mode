// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { test, expect, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { AuditRow } from "@/lib/audit";

afterEach(() => {
  cleanup();
});

const entry: AuditRow = {
  id: "1",
  at: "2026-07-06 10:00:00+00",
  actor: "tester",
  schemaName: "app",
  tableName: "item",
  operation: "UPDATE",
  pk: { id: 1 },
  oldValues: { name: "old" },
  newValues: { name: "new" },
  statement: "UPDATE app.item SET name='new'",
};

test("changes open in a sheet on view, showing old/new/sql", async () => {
  const { AuditChanges } = await import("@/components/audit-changes");
  render(<AuditChanges entry={entry} />);

  // Closed initially — no dialog in the tree.
  expect(screen.queryByRole("dialog")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "view" }));

  const dialog = screen.getByRole("dialog");
  expect(dialog).toBeInTheDocument();
  // Row metadata + both value snapshots + the statement are all present.
  expect(screen.getByText("tester")).toBeInTheDocument();
  expect(screen.getByText(/"name": "old"/)).toBeInTheDocument();
  expect(screen.getByText(/"name": "new"/)).toBeInTheDocument();
  expect(screen.getByText(/UPDATE app\.item SET name='new'/)).toBeInTheDocument();
});

test("Escape closes the sheet", async () => {
  const { AuditChanges } = await import("@/components/audit-changes");
  render(<AuditChanges entry={entry} />);

  fireEvent.click(screen.getByRole("button", { name: "view" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();

  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("the close button closes the sheet", async () => {
  const { AuditChanges } = await import("@/components/audit-changes");
  render(<AuditChanges entry={entry} />);

  fireEvent.click(screen.getByRole("button", { name: "view" }));
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});
