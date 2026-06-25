import Link from "next/link";
import { listTables } from "@/lib/introspect";
import { SchemaBanner } from "@/components/schema-banner";

export const dynamic = "force-dynamic";

export default async function TablesPage({ params }: { params: Promise<{ schema: string }> }) {
  const { schema } = await params;
  const tables = await listTables(schema);
  return (
    <div>
      <SchemaBanner schema={schema} />
      <h1 className="my-3 text-lg font-semibold">Tables in {schema}</h1>
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left"><th>Table</th><th className="text-right">~rows</th></tr></thead>
        <tbody>
          {tables.map((t) => (
            <tr key={t.name} className="border-b">
              <td className="py-1"><Link href={`/${encodeURIComponent(schema)}/${encodeURIComponent(t.name)}`} className="text-blue-600 font-mono">{t.name}</Link></td>
              <td className="text-right tabular-nums">{t.estimatedRows.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
