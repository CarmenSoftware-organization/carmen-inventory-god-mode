import { notFound } from "next/navigation";
import { describeTable } from "@/lib/introspect";
import { getSql } from "@/lib/db";
import { qualified } from "@/lib/sql-guard";
import { whereFromPk } from "@/lib/write";
import { RowForm } from "@/components/row-form";
import { submitUpdate } from "@/server/rows";
import { SchemaBanner } from "@/components/schema-banner";

export const dynamic = "force-dynamic";

export default async function EditPage({
  params, searchParams,
}: { params: Promise<{ schema: string; table: string }>; searchParams: Promise<{ pk?: string }> }) {
  const { schema, table } = await params;
  const { pk: pkParam } = await searchParams;
  if (!pkParam) notFound();
  const pk = JSON.parse(pkParam) as Record<string, unknown>;
  const shape = await describeTable(schema, table);
  const { clause, args } = whereFromPk(pk, 1);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await getSql().unsafe(`SELECT * FROM ${qualified(schema, table)} WHERE ${clause} LIMIT 1`, args as any[]);
  if (!rows[0]) notFound();
  const action = submitUpdate.bind(null, schema, table, JSON.stringify(pk));
  return (
    <div>
      <SchemaBanner schema={schema} />
      <h1 className="my-3 text-lg font-semibold font-mono">Edit {schema}.{table}</h1>
      <RowForm columns={shape.columns} initial={rows[0] as Record<string, unknown>} action={action} submitLabel="Save changes" />
    </div>
  );
}
