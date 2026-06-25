"use client";
import { useState } from "react";
import Link from "next/link";
import type { RowPage } from "@/lib/rows";

export function RowGrid({ schema, table, page }: { schema: string; table: string; page: RowPage }) {
  const readOnly = page.primaryKey.length === 0;
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function pkKey(row: Record<string, unknown>): string {
    return JSON.stringify(pk(row, page.primaryKey));
  }
  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) => (prev.size === page.rows.length ? new Set() : new Set(page.rows.map(pkKey))));
  }

  const selectedPks = [...selected].map((k) => JSON.parse(k) as Record<string, unknown>);
  const batchHref = `/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/delete-batch?pks=${encodeURIComponent(JSON.stringify(selectedPks))}`;
  const allSelected = page.rows.length > 0 && selected.size === page.rows.length;

  return (
    <div className="overflow-x-auto">
      {readOnly && <p className="mb-2 rounded bg-yellow-100 p-2 text-sm">No primary key — this table is read-only in god mode.</p>}
      {!readOnly && selected.size > 0 && (
        <div className="mb-2 flex items-center gap-3">
          <span className="text-sm">{selected.size} selected</span>
          <Link href={batchHref} className="rounded bg-red-600 px-3 py-1 text-sm font-semibold text-white">
            Delete {selected.size} selected
          </Link>
        </div>
      )}
      <table className="min-w-full text-sm">
        <thead><tr className="border-b text-left">
          {!readOnly && <th className="px-2"><input type="checkbox" aria-label="select all" checked={allSelected} onChange={toggleAll} /></th>}
          {page.columns.map((c) => <th key={c.name} className="px-2 py-1 font-mono">{c.name}</th>)}
          {!readOnly && <th className="px-2">actions</th>}
        </tr></thead>
        <tbody>
          {page.rows.map((row, i) => {
            const key = readOnly ? String(i) : pkKey(row);
            return (
              <tr key={i} className="border-b">
                {!readOnly && <td className="px-2"><input type="checkbox" aria-label={`select row ${i}`} checked={selected.has(key)} onChange={() => toggle(key)} /></td>}
                {page.columns.map((c) => <td key={c.name} className="max-w-xs truncate px-2 py-1">{format(row[c.name])}</td>)}
                {!readOnly && <td className="whitespace-nowrap px-2">
                  <Link className="text-blue-600" href={`/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/edit?pk=${encodeURIComponent(JSON.stringify(pk(row, page.primaryKey)))}`}>edit</Link>
                  {" · "}
                  <Link className="text-red-600" href={`/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/delete?pk=${encodeURIComponent(JSON.stringify(pk(row, page.primaryKey)))}`}>delete</Link>
                </td>}
              </tr>
            );
          })}
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
