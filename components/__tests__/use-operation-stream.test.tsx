import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const push = vi.fn(); const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

import { useOperationStream } from "@/components/use-operation-stream";

function Harness() {
  const { state, start } = useOperationStream();
  return (
    <div>
      <button onClick={() => start("/api/ops/x", { a: 1 })}>go</button>
      <span data-testid="phase">{state.phase}</span>
      <span data-testid="summary">{state.summary}</span>
      <span data-testid="error">{state.error}</span>
    </div>
  );
}

function streamingResponse(lines: string[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) { for (const l of lines) c.enqueue(enc.encode(l + "\n")); c.close(); },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test("drives to done and triggers router navigation on redirect", async () => {
  vi.stubGlobal("fetch", vi.fn(async () =>
    streamingResponse([
      JSON.stringify({ type: "total", total: 1 }),
      JSON.stringify({ type: "step", label: "A", done: 1 }),
      JSON.stringify({ type: "done", summary: "ok", redirect: "/clusters" }),
    ])));
  render(<Harness />);
  fireEvent.click(screen.getByText("go"));
  await waitFor(() => expect(screen.getByTestId("phase")).toHaveTextContent("done"));
  expect(screen.getByTestId("summary")).toHaveTextContent("ok");
  expect(push).toHaveBeenCalledWith("/clusters");
});

test("non-200 response surfaces the JSON error", async () => {
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(JSON.stringify({ error: "bad phrase" }), { status: 400 })));
  render(<Harness />);
  fireEvent.click(screen.getByText("go"));
  await waitFor(() => expect(screen.getByTestId("phase")).toHaveTextContent("error"));
  expect(screen.getByTestId("error")).toHaveTextContent("bad phrase");
});

test("mid-stream error surfaces as error state and clears the re-entrancy guard", async () => {
  const enc = new TextEncoder();
  const broken = (): Response => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode(JSON.stringify({ type: "step", label: "A", done: 1 }) + "\n"));
        c.error(new Error("stream broke"));
      },
    });
    return new Response(body, { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
  };
  const fetchMock = vi.fn(async () => broken());
  vi.stubGlobal("fetch", fetchMock);
  render(<Harness />);

  fireEvent.click(screen.getByText("go"));
  await waitFor(() => expect(screen.getByTestId("phase")).toHaveTextContent("error"));
  expect(screen.getByTestId("error")).toHaveTextContent("stream broke");
  expect(fetchMock).toHaveBeenCalledTimes(1);

  // Guard must have been cleared: a second start is accepted and calls fetch again.
  fireEvent.click(screen.getByText("go"));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
});
