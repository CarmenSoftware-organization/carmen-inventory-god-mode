"use client";
import type { OperationState } from "@/lib/operation-stream";

export function OperationLog({ state }: { state: OperationState }) {
  if (!state.logs?.length) return null;
  return (
    <pre
      className="max-h-96 overflow-auto whitespace-pre-wrap rounded bg-gray-900 p-3 text-xs text-gray-100"
      role="log"
      aria-live="polite"
    >
      {state.logs.join("\n")}
    </pre>
  );
}
