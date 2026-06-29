import { expect, test } from "vitest";
import { streamOperation } from "@/lib/progress";

async function collect(res: Response): Promise<unknown[]> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
  }
  return buf.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
}

test("emits step/total in order then a final done carrying the resolved summary", async () => {
  const res = streamOperation(async (onProgress) => {
    onProgress({ type: "step", label: "Computing…" });
    onProgress({ type: "total", total: 2 });
    onProgress({ type: "step", label: "A", done: 1 });
    return { summary: "ok", redirect: "/x" };
  });
  expect(res.headers.get("Content-Type")).toBe("application/x-ndjson");
  expect(await collect(res)).toEqual([
    { type: "step", label: "Computing…" },
    { type: "total", total: 2 },
    { type: "step", label: "A", done: 1 },
    { type: "done", summary: "ok", redirect: "/x" },
  ]);
});

test("emits a single error event when run throws, and no done", async () => {
  const res = streamOperation(async () => { throw new Error("boom"); });
  expect(await collect(res)).toEqual([{ type: "error", message: "boom" }]);
});

test("passes log events through the stream verbatim", async () => {
  const res = streamOperation(async (onProgress) => {
    onProgress({ type: "log", line: "hello", stream: "out" });
    onProgress({ type: "log", line: "oops", stream: "err" });
    return { summary: "done" };
  });
  expect(await collect(res)).toEqual([
    { type: "log", line: "hello", stream: "out" },
    { type: "log", line: "oops", stream: "err" },
    { type: "done", summary: "done", redirect: undefined },
  ]);
});
