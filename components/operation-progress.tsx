"use client";
import type { OperationState } from "@/lib/operation-stream";

export function OperationProgress({ state }: { state: OperationState }) {
  if (state.phase === "idle") return null;
  const determinate = state.total != null && state.total > 0;
  const pct = determinate ? Math.min(100, Math.round((state.done / state.total!) * 100)) : null;
  return (
    <div className="space-y-1" role="status" aria-live="polite">
      <div className="h-2 w-full overflow-hidden rounded bg-gray-200">
        {state.phase === "done" ? (
          <div className="h-full bg-green-600" style={{ width: "100%" }} />
        ) : state.phase === "error" ? (
          <div className="h-full bg-red-600" style={{ width: "100%" }} />
        ) : determinate ? (
          <div className="h-full bg-black transition-all" style={{ width: `${pct}%` }} />
        ) : (
          <div className="h-full w-1/3 animate-pulse bg-black" />
        )}
      </div>
      {state.phase === "running" && (
        <p className="text-sm text-gray-600">{pct != null ? `${pct}% · ` : ""}{state.label}</p>
      )}
      {state.phase === "done" && <p className="text-sm text-green-700">{state.summary}</p>}
      {state.phase === "error" && (
        <div className="text-sm text-red-700">
          <p>{state.error}</p>
          <p className="text-xs text-red-600">No changes were applied — the operation was rolled back.</p>
        </div>
      )}
    </div>
  );
}
