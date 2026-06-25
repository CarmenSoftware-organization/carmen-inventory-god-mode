import Link from "next/link";
import { readRows } from "@/lib/rows";
import { RowGrid } from "@/components/row-grid";
import { SchemaBanner } from "@/components/schema-banner";

export const dynamic = "force-dynamic";

export default async function TablePage({
  params, searchParams,
}: { params: Promise<{ schema: string; table: string }>; searchParams: Promise<{ cursor?: string }> }) {
  const { schema, table } = await params;
  const { cursor } = await searchParams;
  const page = await readRows(schema, table, { cursor: cursor ?? null });
  return (
    <div>
      <SchemaBanner schema={schema} />
      <div className="my-3 flex items-center gap-3">
        <h1 className="text-lg font-semibold font-mono">{schema}.{table}</h1>
        {page.primaryKey.length > 0 && (
          <Link href={`/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/insert`} className="rounded bg-green-600 px-2 py-1 text-sm text-white">+ Insert</Link>
        )}
        <Link href={`/${encodeURIComponent(schema)}/sql`} className="ml-auto text-sm text-gray-600">SQL console</Link>
      </div>
      <RowGrid schema={schema} table={table} page={page} />
    </div>
  );
}
