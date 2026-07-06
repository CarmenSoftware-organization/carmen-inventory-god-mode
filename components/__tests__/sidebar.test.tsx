// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { vi, test, expect, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { Database } from "lucide-react";

vi.mock("next/navigation", () => ({ usePathname: () => "/schemas" }));
vi.mock("@/server/auth", () => ({ logout: vi.fn() }));

// Node 22+ defines a lazy `globalThis.localStorage` getter of its own; vitest's
// jsdom environment only installs window globals that aren't already present
// on `global`, so that native (non-functional without --localstorage-file)
// getter shadows jsdom's real, working localStorage. `Footer` renders
// `ThemeToggle`, which calls `useTheme()`, which reads `localStorage` on
// mount — point the global back at jsdom's implementation, exposed by vitest
// as the ambient `jsdom` instance (mirrors `components/__tests__/use-theme.test.tsx`).
const dom = (globalThis as unknown as { jsdom?: { window: { localStorage: Storage } } }).jsdom;
if (dom) {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get: () => dom.window.localStorage,
  });
}

afterEach(() => {
  cleanup();
});

const items = [{ href: "/schemas", label: "Schemas", icon: Database }];

test("logout button and nav rows stay reachable by accessible name after collapsing the sidebar", async () => {
  const { Sidebar } = await import("@/components/sidebar");
  render(<Sidebar items={items} />);

  fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));

  expect(screen.getByRole("link", { name: /schemas/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /log out/i })).toBeInTheDocument();
});
