import { expect, test } from "vitest";
import { readNdjson, reduceOperation, initialOperationState } from "@/lib/operation-stream";
import type { ProgressEvent } from "@/lib/progress";

function readerFrom(chunks: string[]): ReadableStreamDefaultReader<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return {
    read: async () =>
      i < chunks.length ? { value: enc.encode(chunks[i++]), done: false } : { value: undefined, done: true },
    releaseLock() {}, cancel: async () => {}, closed: Promise.resolve(undefined),
  } as unknown as ReadableStreamDefaultReader<Uint8Array>;
}

async function drain(chunks: string[]): Promise<ProgressEvent[]> {
  const out: ProgressEvent[] = [];
  for await (const e of readNdjson(readerFrom(chunks))) out.push(e);
  return out;
}

test("reassembles events split across chunk boundaries and skips blank/padding lines", async () => {
  const events = await drain([
    "   \n",                                    // padding preamble
    '{"type":"to',                              // split mid-line
    'tal","total":2}\n{"type":"st',             // end of one + start of next
    'ep","label":"A","done":1}\n',
    '{"type":"done","summary":"ok"}',           // trailing line, no newline before close
  ]);
  expect(events).toEqual([
    { type: "total", total: 2 },
    { type: "step", label: "A", done: 1 },
    { type: "done", summary: "ok" },
  ]);
});

test("reducer: total makes it determinate, step advances done, done snaps to total", () => {
  let s = initialOperationState;
  s = reduceOperation(s, { type: "step", label: "Computing…" });
  expect(s).toMatchObject({ phase: "running", label: "Computing…", total: undefined });
  s = reduceOperation(s, { type: "total", total: 4 });
  expect(s).toMatchObject({ total: 4 });
  s = reduceOperation(s, { type: "step", label: "B", done: 2 });
  expect(s).toMatchObject({ done: 2, label: "B" });
  s = reduceOperation(s, { type: "done", summary: "done" });
  expect(s).toMatchObject({ phase: "done", summary: "done", done: 4 });
});

test("reducer: error sets error phase", () => {
  const s = reduceOperation(initialOperationState, { type: "error", message: "boom" });
  expect(s).toMatchObject({ phase: "error", error: "boom" });
});
