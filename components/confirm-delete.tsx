// components/confirm-delete.tsx
"use client";
import { useState } from "react";
import type { BlastRadius } from "@/lib/cascade";
import { useOperationStream } from "@/components/use-operation-stream";
import { OperationProgress } from "@/components/operation-progress";

export function ConfirmDelete({
  schema, table, pkJson, radius, isBusinessUnit, tenantSchema, orphanSchemas, requiredPhrase,
}: {
  schema: string; table: string; pkJson: string; radius: BlastRadius;
  isBusinessUnit: boolean; tenantSchema: string | null;
  orphanSchemas?: string[]; requiredPhrase: string;
}) {
  const { state, start } = useOperationStream();
  const [confirm, setConfirm] = useState("");
  const [dropSchema, setDropSchema] = useState(false);

  const parsed = JSON.parse(pkJson);
  const pks: Record<string, unknown>[] = Array.isArray(parsed) ? parsed : [parsed];
  const running = state.phase === "running";

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    start("/api/ops/cascade-delete", { schema, table, pks, dropSchema, confirm });
  }

  return (
    <form onSubmit={onSubmit} className="max-w-2xl space-y-4">
      <div className="rounded border border-red-300 bg-red-50 p-3">
        <p className="font-semibold text-red-800">This permanently deletes {radius.rows.length} row(s) across {radius.byTable.length} table(s). Max depth {radius.maxDepth}.</p>
        {radius.truncated && <p className="mt-1 text-sm text-red-900">⚠ Blast radius hit the configured cap — execution will be refused until you narrow it or raise the caps.</p>}
      </div>
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left"><th>Table</th><th className="text-right">rows</th></tr></thead>
        <tbody>{radius.byTable.map((b) => (
          <tr key={`${b.schema}.${b.table}`} className="border-b"><td className="font-mono">{b.schema}.{b.table}</td><td className="text-right">{b.count}</td></tr>
        ))}</tbody>
      </table>

      {isBusinessUnit && tenantSchema && (
        <label className="flex items-center gap-2 rounded border border-amber-400 bg-amber-50 p-2 text-sm">
          <input type="checkbox" checked={dropSchema} onChange={(e) => setDropSchema(e.target.checked)} />
          Also <strong>DROP SCHEMA &quot;{tenantSchema}&quot; CASCADE</strong> (wipes the entire tenant database for this BU)
        </label>
      )}

      {orphanSchemas && orphanSchemas.length > 0 && (
        <div className="space-y-2">
          <label className="flex items-start gap-2 rounded border border-amber-400 bg-amber-50 p-2 text-sm">
            <input type="checkbox" checked={dropSchema} onChange={(e) => setDropSchema(e.target.checked)} />
            <span>Also <strong>DROP {orphanSchemas.length} tenant schema(s) CASCADE</strong>: <code>{orphanSchemas.join(", ")}</code> (wipes each tenant database)</span>
          </label>
          <span className="block text-xs text-gray-500">The confirmation phrase below stays DELETE.</span>
        </div>
      )}

      <div className="space-y-1">
        <label className="block text-sm">Type <code className="rounded bg-gray-200 px-1">{requiredPhrase}</code> to confirm:</label>
        <input name="confirm" autoComplete="off" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="w-full rounded border p-2" />
        {isBusinessUnit && tenantSchema && (
          <p className="text-xs text-gray-500">If you check the schema-drop box, the required phrase becomes the schema name.</p>
        )}
      </div>

      <button type="submit" className="rounded bg-red-600 px-4 py-2 font-semibold text-white disabled:opacity-50" disabled={radius.truncated || running}>
        {running ? "Deleting…" : "Permanently delete"}
      </button>

      <OperationProgress state={state} />
    </form>
  );
}
