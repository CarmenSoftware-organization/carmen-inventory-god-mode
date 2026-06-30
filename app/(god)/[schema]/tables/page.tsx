import Link from "next/link";
import { CaretRight } from "@phosphor-icons/react/dist/ssr";
import { listTables } from "@/lib/introspect";
import { SchemaBanner } from "@/components/schema-banner";
import { Table, THead, TBody, TR, Th, Td } from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default async function TablesPage({ params }: { params: Promise<{ schema: string }> }) {
  const { schema } = await params;
  const tables = await listTables(schema);
  return (
    <div className="space-y-4">
      <SchemaBanner schema={schema} />
      <h1 className="text-base font-semibold tracking-tight">
        Tables in <span className="font-mono">{schema}</span>
      </h1>
      <Table>
        <THead>
          <TR>
            <Th>Table</Th>
            <Th className="text-right">~rows</Th>
          </TR>
        </THead>
        <TBody>
          {tables.map((t) => (
            <TR key={t.name}>
              <Td>
                <Link
                  href={`/${encodeURIComponent(schema)}/${encodeURIComponent(t.name)}`}
                  className="inline-flex items-center gap-1 font-mono text-xs text-link hover:text-link-hover"
                >
                  {t.name}
                  <CaretRight className="h-3 w-3" aria-hidden="true" />
                </Link>
              </Td>
              <Td className="text-right tabular-nums text-xs">
                {t.estimatedRows.toLocaleString()}
              </Td>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
