import type { ProgressEvent } from "@/lib/progress";

export type OperationState = {
  phase: "idle" | "running" | "done" | "error";
  title?: string;
  total?: number;
  done: number;
  label?: string;
  summary?: string;
  error?: string;
};

export const initialOperationState: OperationState = { phase: "idle", done: 0 };

export function reduceOperation(prev: OperationState, event: ProgressEvent): OperationState {
  switch (event.type) {
    case "total":
      return { ...prev, phase: "running", total: event.total, title: event.title ?? prev.title };
    case "step":
      return { ...prev, phase: "running", label: event.label, done: event.done ?? prev.done, total: prev.total };
    case "done":
      return { ...prev, phase: "done", summary: event.summary, done: prev.total ?? prev.done };
    case "error":
      return { ...prev, phase: "error", error: event.message };
  }
}

export async function* readNdjson(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<ProgressEvent> {
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) yield JSON.parse(line) as ProgressEvent;
    }
  }
  const last = buffer.trim();
  if (last) yield JSON.parse(last) as ProgressEvent;
}
