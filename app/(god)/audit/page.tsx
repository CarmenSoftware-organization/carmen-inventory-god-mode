import { listAudit, type Operation } from "@/lib/audit";

export const dynamic = "force-dynamic";
const OPS: Operation[] = ["INSERT", "UPDATE", "DELETE", "CASCADE_DELETE", "DROP_SCHEMA", "RAW_SQL"];

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ schema?: string; table?: string; operation?: string }> }) {
  const sp = await searchParams;
  const entries = await listAudit({ schema: sp.schema, table: sp.table, operation: sp.operation as Operation | undefined, limit: 200 });
  return (
    <div>
      <h1 className="my-3 text-lg font-semibold">Audit log</h1>
      <form className="mb-3 flex gap-2 text-sm">
        <input name="schema" defaultValue={sp.schema ?? ""} placeholder="schema" className="rounded border p-1" />
        <input name="table" defaultValue={sp.table ?? ""} placeholder="table" className="rounded border p-1" />
        <select name="operation" defaultValue={sp.operation ?? ""} className="rounded border p-1">
          <option value="">any op</option>
          {OPS.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <button className="rounded bg-black px-3 text-white">Filter</button>
      </form>
      <table className="min-w-full text-sm">
        <thead><tr className="border-b text-left"><th>at</th><th>actor</th><th>target</th><th>op</th><th>pk</th><th>before→after</th></tr></thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-b align-top">
              <td className="whitespace-nowrap py-1">{e.at}</td>
              <td>{e.actor}</td>
              <td className="font-mono">{e.schemaName}{e.tableName ? `.${e.tableName}` : ""}</td>
              <td>{e.operation}</td>
              <td className="font-mono text-xs">{e.pk ? JSON.stringify(e.pk) : ""}</td>
              <td className="max-w-md">
                <details><summary className="cursor-pointer text-gray-500">view</summary>
                  <pre className="whitespace-pre-wrap text-xs">old: {JSON.stringify(e.oldValues, null, 2)}{"\n"}new: {JSON.stringify(e.newValues, null, 2)}{e.statement ? `\nsql: ${e.statement}` : ""}</pre>
                </details>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
