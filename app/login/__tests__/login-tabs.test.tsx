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
  expect(screen.getByRole("tab", { name: /gateway login/i })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: /shared secret/i })).toBeInTheDocument();
  expect(screen.getByLabelText(/email or username/i)).toBeInTheDocument();
});

test("switches to the shared-secret form when its tab is clicked", async () => {
  const { LoginTabs } = await import("@/app/login/login-tabs");
  render(<LoginTabs gatewayEnabled={true} />);
  fireEvent.click(screen.getByRole("tab", { name: /shared secret/i }));
  expect(screen.getByLabelText(/shared secret/i)).toBeInTheDocument();
  expect(screen.queryByLabelText(/email or username/i)).not.toBeInTheDocument();
});

test("hides the gateway tab and shows only the secret form when gateway is disabled", async () => {
  const { LoginTabs } = await import("@/app/login/login-tabs");
  render(<LoginTabs gatewayEnabled={false} />);
  expect(screen.queryByRole("tab", { name: /gateway login/i })).not.toBeInTheDocument();
  expect(screen.getByLabelText(/shared secret/i)).toBeInTheDocument();
});
