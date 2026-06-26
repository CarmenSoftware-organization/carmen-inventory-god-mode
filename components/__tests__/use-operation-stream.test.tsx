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
});
