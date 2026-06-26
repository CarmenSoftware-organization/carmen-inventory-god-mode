import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("@/server/auth", () => ({
  login: async () => ({}),
  gatewayLogin: async () => ({}),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("shows both tabs and the gateway form by default when gateway is enabled", async () => {
  const { LoginTabs } = await import("@/app/login/login-tabs");
  render(<LoginTabs gatewayEnabled={true} />);
  expect(screen.getByRole("button", { name: /gateway login/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /shared secret/i })).toBeInTheDocument();
  expect(screen.getByPlaceholderText(/email or username/i)).toBeInTheDocument();
});

test("switches to the shared-secret form when its tab is clicked", async () => {
  const { LoginTabs } = await import("@/app/login/login-tabs");
  render(<LoginTabs gatewayEnabled={true} />);
  fireEvent.click(screen.getByRole("button", { name: /shared secret/i }));
  expect(screen.getByPlaceholderText(/shared secret/i)).toBeInTheDocument();
  expect(screen.queryByPlaceholderText(/email or username/i)).not.toBeInTheDocument();
});

test("hides the gateway tab and shows only the secret form when gateway is disabled", async () => {
  const { LoginTabs } = await import("@/app/login/login-tabs");
  render(<LoginTabs gatewayEnabled={false} />);
  expect(screen.queryByRole("button", { name: /gateway login/i })).not.toBeInTheDocument();
  expect(screen.getByPlaceholderText(/shared secret/i)).toBeInTheDocument();
});
