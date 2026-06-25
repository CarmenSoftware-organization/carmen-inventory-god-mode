"use client";
import Link from "next/link";
import type { RowPage } from "@/lib/rows";

export function RowGrid({ schema, table, page }: { schema: string; table: string; page: RowPage }) {
  const readOnly = page.primaryKey.length === 0;
  return (
    <div className="overflow-x-auto">
      {readOnly && <p className="mb-2 rounded bg-yellow-100 p-2 text-sm">No primary key — this table is read-only in god mode.</p>}
      <table className="min-w-full text-sm">
        <thead><tr className="border-b text-left">
          {page.columns.map((c) => <th key={c.name} className="px-2 py-1 font-mono">{c.name}</th>)}
          {!readOnly && <th className="px-2">actions</th>}
        </tr></thead>
        <tbody>
          {page.rows.map((row, i) => (
            <tr key={i} className="border-b">
              {page.columns.map((c) => <td key={c.name} className="max-w-xs truncate px-2 py-1">{format(row[c.name])}</td>)}
              {!readOnly && <td className="whitespace-nowrap px-2">
                <Link className="text-blue-600" href={`/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/edit?pk=${encodeURIComponent(JSON.stringify(pk(row, page.primaryKey)))}`}>edit</Link>
                {" · "}
                <Link className="text-red-600" href={`/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/delete?pk=${encodeURIComponent(JSON.stringify(pk(row, page.primaryKey)))}`}>delete</Link>
              </td>}
            </tr>
          ))}
        </tbody>
      </table>
      {page.nextCursor && (
        <Link className="mt-3 inline-block text-blue-600" href={`/${encodeURIComponent(schema)}/${encodeURIComponent(table)}?cursor=${encodeURIComponent(page.nextCursor)}`}>next →</Link>
      )}
    </div>
  );
}

function pk(row: Record<string, unknown>, keys: string[]) { return Object.fromEntries(keys.map((k) => [k, row[k]])); }
function format(v: unknown): string {
  if (v === null || v === undefined) return "∅";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
