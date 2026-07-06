import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function mount(props: Partial<React.ComponentProps<typeof import("@/components/seal-confirm")["SealConfirm"]>> = {}) {
  const { SealConfirm } = await import("@/components/seal-confirm");
  const onStamp = vi.fn();
  render(<SealConfirm requiredPhrase="DELETE" onStamp={onStamp} holdMs={40} {...props} />);
  return { onStamp };
}

test("the seal stays disabled until the exact phrase is typed", async () => {
  await mount();
  const seal = screen.getByRole("button", { name: /confirm/i });
  expect(seal).toHaveAttribute("aria-disabled", "true");
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "delete" } });
  expect(seal).toHaveAttribute("aria-disabled", "true");
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "DELETE" } });
  expect(seal).toHaveAttribute("aria-disabled", "false");
});

test("holding the armed seal for holdMs fires onStamp once", async () => {
  const { onStamp } = await mount();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "DELETE" } });
  fireEvent.mouseDown(screen.getByRole("button", { name: /confirm/i }));
  await waitFor(() => expect(onStamp).toHaveBeenCalledTimes(1));
});

test("releasing before holdMs cancels the stamp", async () => {
  const { onStamp } = await mount();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "DELETE" } });
  const seal = screen.getByRole("button", { name: /confirm/i });
  fireEvent.mouseDown(seal);
  fireEvent.mouseUp(seal);
  await new Promise((r) => setTimeout(r, 120));
  expect(onStamp).not.toHaveBeenCalled();
});

test("keyboard hold (Space) also stamps", async () => {
  const { onStamp } = await mount();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "DELETE" } });
  fireEvent.keyDown(screen.getByRole("button", { name: /confirm/i }), { key: " " });
  await waitFor(() => expect(onStamp).toHaveBeenCalledTimes(1));
});

test("disabling mid-hold cancels the stamp", async () => {
  const { SealConfirm } = await import("@/components/seal-confirm");
  const onStamp = vi.fn();
  const { rerender } = render(<SealConfirm requiredPhrase="DELETE" onStamp={onStamp} holdMs={60} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "DELETE" } });
  fireEvent.mouseDown(screen.getByRole("button", { name: /confirm/i }));
  rerender(<SealConfirm requiredPhrase="DELETE" onStamp={onStamp} holdMs={60} disabled />);
  await new Promise((r) => setTimeout(r, 140));
  expect(onStamp).not.toHaveBeenCalled();
});

test("unmounting mid-hold fires nothing (timer cleared)", async () => {
  const { SealConfirm } = await import("@/components/seal-confirm");
  const onStamp = vi.fn();
  const { unmount } = render(<SealConfirm requiredPhrase="DELETE" onStamp={onStamp} holdMs={60} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "DELETE" } });
  fireEvent.mouseDown(screen.getByRole("button", { name: /confirm/i }));
  unmount();
  await new Promise((r) => setTimeout(r, 140));
  expect(onStamp).not.toHaveBeenCalled();
});
