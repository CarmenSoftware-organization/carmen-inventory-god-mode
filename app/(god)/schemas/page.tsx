import Link from "next/link";
import { listBusinessUnits, listSelectableSchemas } from "@/lib/registry";

export const dynamic = "force-dynamic";

export default async function SchemasPage() {
  const [bus, sel] = await Promise.all([listBusinessUnits(), listSelectableSchemas()]);
  return (
    <div className="space-y-6">
      <section>
        <h1 className="mb-2 text-lg font-semibold">System</h1>
        <Link href={`/${encodeURIComponent(sel.system)}/tables`} className="inline-block rounded border border-red-300 bg-red-50 px-3 py-2 text-red-800">
          Manage {sel.system} (registry, users, business units)
        </Link>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Business Units</h2>
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left"><th>Code</th><th>Name</th><th>Active</th><th>Tenant schema</th><th></th></tr></thead>
          <tbody>
            {bus.map((b) => (
              <tr key={b.id} className="border-b">
                <td className="py-1 font-mono">{b.code}</td>
                <td>{b.name}</td>
                <td>{b.isActive ? "yes" : "no"}</td>
                <td>{b.tenantSchema ?? <span className="rounded bg-gray-200 px-2 text-xs">no schema</span>}</td>
                <td className="space-x-3 text-right">
                  {b.tenantSchema && <Link href={`/${encodeURIComponent(b.tenantSchema)}/tables`} className="text-blue-600">open →</Link>}
                  <Link
                    href={`/${encodeURIComponent(sel.system)}/tb_business_unit/delete?pk=${encodeURIComponent(JSON.stringify({ id: b.id }))}`}
                    className="text-red-600"
                  >
                    delete
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">All schemas</h2>
        <ul className="flex flex-wrap gap-2">
          {sel.allSchemas.map((s) => (
            <li key={s}><Link href={`/${encodeURIComponent(s)}/tables`} className="rounded border px-2 py-1 text-sm">{s}</Link></li>
          ))}
        </ul>
      </section>
    </div>
  );
}
