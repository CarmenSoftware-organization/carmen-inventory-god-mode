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
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: ProgressEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      controller.enqueue(encoder.encode(PADDING));
      try {
        const result = await run(emit); // resolves only after COMMIT
        emit({ type: "done", summary: result.summary, redirect: result.redirect });
      } catch (err) {
        emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
