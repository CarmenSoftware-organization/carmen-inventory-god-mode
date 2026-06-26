import Link from "next/link";
import { BusinessUnitsTable } from "@/components/business-units-table";
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
        <BusinessUnitsTable bus={bus} system={sel.system} />
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
