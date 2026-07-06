// @vitest-environment jsdom
import { renderHook, act, cleanup } from "@testing-library/react";
import { beforeEach, afterEach, test, expect } from "vitest";
import { useTheme } from "@/lib/use-theme";

// Node 22+ defines a lazy `globalThis.localStorage` getter of its own; vitest's
// jsdom environment only installs window globals that aren't already present
// on `global`, so that native (non-functional without --localstorage-file)
// getter shadows jsdom's real, working localStorage. Point the global back at
// jsdom's implementation, exposed by vitest as the ambient `jsdom` instance.
// (No `import type { JSDOM }` here — the repo has no `@types/jsdom`; a minimal
// local shape avoids adding a dependency just for this cast.)
const dom = (globalThis as unknown as { jsdom?: { window: { localStorage: Storage } } }).jsdom;
if (dom) {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get: () => dom.window.localStorage,
  });
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});

afterEach(() => {
  cleanup();
});

test("setPref('dark') stores the choice and adds the dark class", () => {
  const { result } = renderHook(() => useTheme());
  act(() => result.current.setPref("dark"));
  expect(localStorage.getItem("theme")).toBe("dark");
  expect(document.documentElement.classList.contains("dark")).toBe(true);
});

test("setPref('light') removes the dark class", () => {
  document.documentElement.classList.add("dark");
  const { result } = renderHook(() => useTheme());
  act(() => result.current.setPref("light"));
  expect(localStorage.getItem("theme")).toBe("light");
  expect(document.documentElement.classList.contains("dark")).toBe(false);
});
