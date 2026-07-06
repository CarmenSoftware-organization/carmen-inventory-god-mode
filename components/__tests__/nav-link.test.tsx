// @vitest-environment jsdom
import { render, screen, cleanup } from "@testing-library/react";
import { vi, test, expect, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { Database } from "lucide-react";

vi.mock("next/navigation", () => ({ usePathname: () => "/schemas/public" }));

afterEach(() => {
  cleanup();
});

test("marks the row active when the pathname is under its href", async () => {
  const { NavLink } = await import("@/components/nav-link");
  render(<NavLink href="/schemas" label="Schemas" icon={Database} />);
  expect(screen.getByRole("link", { name: /schemas/i })).toHaveAttribute("aria-current", "page");
});

test("is not active for an unrelated href", async () => {
  const { NavLink } = await import("@/components/nav-link");
  render(<NavLink href="/clusters" label="Clusters" icon={Database} />);
  expect(screen.getByRole("link", { name: /clusters/i })).not.toHaveAttribute("aria-current");
});
