import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import "@testing-library/jest-dom/vitest";
import { OperationProgress } from "@/components/operation-progress";

afterEach(cleanup);

test("renders nothing when idle", () => {
  const { container } = render(<OperationProgress state={{ phase: "idle", done: 0 }} />);
  expect(container).toBeEmptyDOMElement();
});

test("shows percent + label when determinate and running", () => {
  render(<OperationProgress state={{ phase: "running", done: 3, total: 4, label: "Deleting x…" }} />);
  expect(screen.getByText(/75% · Deleting x…/)).toBeInTheDocument();
});

test("error state spells out the rollback", () => {
  render(<OperationProgress state={{ phase: "error", done: 0, error: "boom" }} />);
  expect(screen.getByText("boom")).toBeInTheDocument();
  expect(screen.getByText(/No changes were applied — the operation was rolled back\./)).toBeInTheDocument();
});
