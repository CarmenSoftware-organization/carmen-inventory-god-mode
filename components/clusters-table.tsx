"use client";
import { useState } from "react";
import Link from "next/link";
import type { Cluster } from "@/lib/registry";

type Tab = "active" | "deleted";

export function ClustersTable({
  clusters, system, softDeleteAction, restoreAction,
}: {
  clusters: Cluster[]; system: string;
  softDeleteAction: (formData: FormData) => void;
  restoreAction: (formData: FormData) => void;
}) {
  const [tab, setTab] = useState<Tab>("active");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const active = clusters.filter((c) => c.deletedAt === null);
  const deleted = clusters.filter((c) => c.deletedAt !== null);
  const rows = tab === "active" ? active : deleted;

  const key = (c: Cluster) => JSON.stringify({ id: c.id });
  function switchTab(next: Tab) { setTab(next); setSelected(new Set()); }
  function toggle(k: string) {
    setSelected((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  }
  function toggleAll() {
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map(key))));
  }

  const selectedPks = [...selected].map((k) => JSON.parse(k) as { id: string });
  const allSelected = rows.length > 0 && selected.size === rows.length;
  const batchDeleteHref = `/${encodeURIComponent(system)}/tb_cluster/delete-batch?pks=${encodeURIComponent(JSON.stringify(selectedPks))}`;

  return (
    <div className="overflow-x-auto">
      <div className="mb-3 flex gap-2">
        <button onClick={() => switchTab("active")}
          className={`rounded px-3 py-1 text-sm ${tab === "active" ? "bg-black text-white" : "border"}`}>
          Active ({active.length})
        </button>
        <button onClick={() => switchTab("deleted")}
          className={`rounded px-3 py-1 text-sm ${tab === "deleted" ? "bg-black text-white" : "border"}`}>
          Deleted ({deleted.length})
        </button>
      </div>

      {tab === "active" && (
        <div className="mb-2 flex items-center gap-3">
          <Link href="/clusters/new" className="rounded bg-black px-3 py-1 text-sm font-semibold text-white">+ Add cluster</Link>
          {selected.size > 0 && (
            <form action={softDeleteAction}>
              <input type="hidden" name="pks" value={JSON.stringify(selectedPks)} />
              <button className="rounded bg-amber-600 px-3 py-1 text-sm font-semibold text-white">Soft delete {selected.size} selected</button>
            </form>
          )}
        </div>
      )}

      {tab === "deleted" && selected.size > 0 && (
        <div className="mb-2 flex items-center gap-3">
          <form action={restoreAction}>
            <input type="hidden" name="pks" value={JSON.stringify(selectedPks)} />
            <button className="rounded bg-green-700 px-3 py-1 text-sm font-semibold text-white">Restore {selected.size} selected</button>
          </form>
          <Link href={batchDeleteHref} className="rounded bg-red-600 px-3 py-1 text-sm font-semibold text-white">Hard delete {selected.size} selected</Link>
        </div>
      )}

      <table className="w-full text-sm">
        <thead><tr className="border-b text-left">
          <th className="px-2"><input type="checkbox" aria-label="select all" checked={allSelected} onChange={toggleAll} /></th>
          <th>Code</th><th>Name</th>
          {tab === "active" ? <th># Business Units</th> : <th>Deleted at</th>}
          <th></th>
        </tr></thead>
        <tbody>
          {rows.map((c, i) => {
            const k = key(c);
            return (
              <tr key={c.id} className={`border-b ${tab === "deleted" ? "text-gray-400 line-through" : ""}`}>
                <td className="px-2"><input type="checkbox" aria-label={`select row ${i}`} checked={selected.has(k)} onChange={() => toggle(k)} /></td>
                <td className="py-1 font-mono">{c.code}</td>
                <td>{c.name}</td>
                {tab === "active" ? <td>{c.businessUnitCount}</td> : <td>{c.deletedAt}</td>}
                <td className="space-x-3 text-right">
                  {tab === "active" ? (
                    <>
                      <Link href={`/clusters/${encodeURIComponent(c.id)}/edit`} className="text-blue-600">Edit</Link>
                      <form action={softDeleteAction} className="inline">
                        <input type="hidden" name="pks" value={JSON.stringify([{ id: c.id }])} />
                        <button className="text-amber-700">Soft delete</button>
                      </form>
                    </>
                  ) : (
                    <>
                      <form action={restoreAction} className="inline">
                        <input type="hidden" name="pks" value={JSON.stringify([{ id: c.id }])} />
                        <button className="text-green-700">Restore</button>
                      </form>
                      <Link href={`/${encodeURIComponent(system)}/tb_cluster/delete?pk=${encodeURIComponent(JSON.stringify({ id: c.id }))}`} className="text-red-600">Hard delete</Link>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
