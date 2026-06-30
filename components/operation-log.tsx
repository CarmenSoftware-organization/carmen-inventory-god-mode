"use client";
import type { OperationState } from "@/lib/operation-stream";

/**
 * Streaming log viewer. Renders as a dark terminal panel (theme-safe tokens).
 */
export function OperationLog({ state }: { state: OperationState }) {
  if (!state.logs?.length) return null;

  return (
    <pre
      className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-surface-muted p-3 font-mono text-xs text-foreground"
      role="log"
      aria-live="polite"
    >
      {state.logs.join("\n")}
    </pre>
  );
}
