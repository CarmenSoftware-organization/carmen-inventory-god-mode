"use client";
import { useState } from "react";
import Link from "next/link";
import type { BusinessUnit } from "@/lib/registry";

export function BusinessUnitsTable({ bus, system }: { bus: BusinessUnit[]; system: string }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function buKey(b: BusinessUnit): string {
    return JSON.stringify({ id: b.id });
  }
  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) => (prev.size === bus.length ? new Set() : new Set(bus.map(buKey))));
  }

  const selectedPks = [...selected].map((k) => JSON.parse(k) as { id: string });
  const batchHref = `/${encodeURIComponent(system)}/tb_business_unit/delete-batch?pks=${encodeURIComponent(JSON.stringify(selectedPks))}`;
  const allSelected = bus.length > 0 && selected.size === bus.length;

  return (
    <div className="overflow-x-auto">
      {selected.size > 0 && (
        <div className="mb-2 flex items-center gap-3">
          <span className="text-sm">{selected.size} selected</span>
          <Link href={batchHref} className="rounded bg-red-600 px-3 py-1 text-sm font-semibold text-white">
            Delete {selected.size} selected
          </Link>
        </div>
      )}
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left">
          <th className="px-2"><input type="checkbox" aria-label="select all" checked={allSelected} onChange={toggleAll} /></th>
          <th>Code</th><th>Name</th><th>Active</th><th>Tenant schema</th><th></th>
        </tr></thead>
        <tbody>
          {bus.map((b, i) => {
            const key = buKey(b);
            return (
              <tr key={b.id} className="border-b">
                <td className="px-2"><input type="checkbox" aria-label={`select row ${i}`} checked={selected.has(key)} onChange={() => toggle(key)} /></td>
                <td className="py-1 font-mono">{b.code}</td>
                <td>{b.name}</td>
                <td>{b.isActive ? "yes" : "no"}</td>
                <td>{b.tenantSchema ?? <span className="rounded bg-gray-200 px-2 text-xs">no schema</span>}</td>
                <td className="space-x-3 text-right">
                  {b.tenantSchema && <Link href={`/${encodeURIComponent(b.tenantSchema)}/tables`} className="text-blue-600">open →</Link>}
                  <Link
                    href={`/${encodeURIComponent(system)}/tb_business_unit/delete?pk=${encodeURIComponent(JSON.stringify({ id: b.id }))}`}
                    className="text-red-600"
                  >
                    delete
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
