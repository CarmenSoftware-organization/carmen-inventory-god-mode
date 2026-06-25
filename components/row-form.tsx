import type { ColumnInfo } from "@/lib/introspect";

export function RowForm({
  columns, initial, action, submitLabel,
}: { columns: ColumnInfo[]; initial?: Record<string, unknown>; action: (fd: FormData) => void; submitLabel: string }) {
  return (
    <form action={action} className="max-w-xl space-y-3">
      {columns.map((c) => {
        const v = initial?.[c.name];
        const text = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v, null, 2) : String(v);
        const isJson = c.udtName === "json" || c.udtName === "jsonb";
        return (
          <div key={c.name} className="space-y-1">
            <label className="block text-sm font-mono">{c.name} <span className="text-gray-400">{c.dataType}{c.isNullable ? "" : " NOT NULL"}</span></label>
            {isJson
              ? <textarea name={`f_${c.name}`} defaultValue={text} rows={4} className="w-full rounded border p-2 font-mono text-xs" />
              : <input name={`f_${c.name}`} defaultValue={text} className="w-full rounded border p-2" />}
            {c.isNullable && (
              <label className="text-xs text-gray-600"><input type="checkbox" name={`null_${c.name}`} defaultChecked={v === null} /> set NULL</label>
            )}
          </div>
        );
      })}
      <button type="submit" className="rounded bg-black px-4 py-2 text-white">{submitLabel}</button>
    </form>
  );
}
