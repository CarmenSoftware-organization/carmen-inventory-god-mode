// @vitest-environment jsdom
import { render, screen, cleanup } from "@testing-library/react";
import { vi, test, expect, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";

const mockTarget = vi.fn();
vi.mock("@/lib/db-target", () => ({ dbTarget: () => mockTarget() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function mount() {
  const { TargetBar } = await import("@/components/target-bar");
  render(<TargetBar />);
}

test("LIVE target shows the permanent-writes warning", async () => {
  mockTarget.mockReturnValue({ host: "db.prod:5432", isLocal: false, label: "LIVE" });
  await mount();
  expect(screen.getByText((content, element) =>
    content === "Every write is permanent" && (element?.classList.contains("sm:inline") ?? false)
  )).toBeInTheDocument();
  expect(screen.getByText("db.prod:5432")).toBeInTheDocument();
  expect(screen.getByText("LIVE")).toBeInTheDocument();
});

test("LOCAL target is calm — no permanent warning", async () => {
  mockTarget.mockReturnValue({ host: "localhost:5432", isLocal: true, label: "LOCAL" });
  await mount();
  expect(screen.queryByText(/every write is permanent/i)).not.toBeInTheDocument();
  expect(screen.getByText("LOCAL")).toBeInTheDocument();
});
