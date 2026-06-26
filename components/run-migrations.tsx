"use client";
import { useOperationStream } from "@/components/use-operation-stream";
import { OperationProgress } from "@/components/operation-progress";

export function RunMigrations() {
  const { state, start } = useOperationStream();
  const running = state.phase === "running";
  return (
    <div className="space-y-3">
      <button disabled={running} onClick={() => start("/api/ops/migrate", {})}
        className="rounded bg-black px-4 py-2 font-semibold text-white disabled:opacity-50">
        {running ? "Running…" : "Run migrations"}
      </button>
      {/* rolledBackOnError intentionally omitted — migrations self-commit per task and are not wrapped in a single transaction */}
      <OperationProgress state={state} />
    </div>
  );
}
