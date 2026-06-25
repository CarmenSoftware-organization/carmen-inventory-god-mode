import type { BlastRadius } from "@/lib/cascade";

export function ConfirmDelete({
  schema, table, pkJson, radius, action, isBusinessUnit, tenantSchema, requiredPhrase,
}: {
  schema: string; table: string; pkJson: string; radius: BlastRadius;
  action: (fd: FormData) => void; isBusinessUnit: boolean; tenantSchema: string | null; requiredPhrase: string;
}) {
  return (
    <form action={action} className="max-w-2xl space-y-4">
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
          <input type="checkbox" name="drop_schema" />
          Also <strong>DROP SCHEMA &quot;{tenantSchema}&quot; CASCADE</strong> (wipes the entire tenant database for this BU)
        </label>
      )}

      <div className="space-y-1">
        <label className="block text-sm">Type <code className="rounded bg-gray-200 px-1">{requiredPhrase}</code> to confirm:</label>
        <input name="confirm" autoComplete="off" className="w-full rounded border p-2" />
        <p className="text-xs text-gray-500">If you check the schema-drop box, the required phrase becomes the schema name.</p>
      </div>

      <button type="submit" className="rounded bg-red-600 px-4 py-2 font-semibold text-white" disabled={radius.truncated}>Permanently delete</button>
    </form>
  );
}
