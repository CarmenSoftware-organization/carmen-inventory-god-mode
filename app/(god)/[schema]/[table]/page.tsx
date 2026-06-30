import Link from "next/link";
import { Plus, TerminalWindow } from "@phosphor-icons/react/dist/ssr";
import { readRows } from "@/lib/rows";
import { RowGrid } from "@/components/row-grid";
import { SchemaBanner } from "@/components/schema-banner";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function TablePage({
  params,
  searchParams,
}: {
  params: Promise<{ schema: string; table: string }>;
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { schema, table } = await params;
  const { cursor } = await searchParams;
  const page = await readRows(schema, table, { cursor: cursor ?? null });
  return (
    <div className="space-y-4">
      <SchemaBanner schema={schema} />
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-base font-semibold tracking-tight">
          {schema}.{table}
        </h1>
        {page.primaryKey.length > 0 && (
          <Link href={`/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/insert`}>
            <Button variant="primary" size="sm">
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Insert
            </Button>
          </Link>
        )}
        <Link href={`/${encodeURIComponent(schema)}/sql`} className="ml-auto">
          <Button variant="ghost" size="sm">
            <TerminalWindow className="h-3.5 w-3.5" aria-hidden="true" />
            SQL console
          </Button>
        </Link>
      </div>
      <RowGrid schema={schema} table={table} page={page} />
    </div>
  );
}
