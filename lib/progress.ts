export type ProgressEvent =
  | { type: "step"; label: string; done?: number }
  | { type: "total"; total: number; title?: string }
  | { type: "log"; line: string; stream?: "out" | "err" }
  | { type: "done"; summary: string; redirect?: string }
  | { type: "error"; message: string };

export type OnProgress = (event: ProgressEvent) => void;

// ~1KB whitespace preamble defeats Safari's 1024-byte streaming buffer.
// The client NDJSON parser skips blank lines, so it is inert.
const PADDING = " ".repeat(1024) + "\n";

export function streamOperation(
  run: (onProgress: OnProgress) => Promise<{ summary: string; redirect?: string }>,
): Response {
  const encoder = new TextEncoder();
  // A consumer can leave (closed tab, navigation, aborted request) while the operation
  // is still running — it may be mid-transaction, so it is never cancelled with them.
  // Its progress calls then have nowhere to go, and enqueueing on a closed controller
  // throws. That throw used to travel back into the operation and skip whatever its
  // finally was holding, so reporting must be inert once nobody is listening.
  let live = true;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: ProgressEvent) => {
        if (!live) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {
          live = false;
        }
      };
      controller.enqueue(encoder.encode(PADDING));
      try {
        const result = await run(emit); // resolves only after COMMIT
        emit({ type: "done", summary: result.summary, redirect: result.redirect });
      } catch (err) {
        emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        live = false;
        try { controller.close(); } catch { /* the consumer already cancelled it */ }
      }
    },
    cancel() { live = false; },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
