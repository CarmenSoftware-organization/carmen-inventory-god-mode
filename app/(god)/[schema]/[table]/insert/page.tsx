import { describeTable } from "@/lib/introspect";
import { RowForm } from "@/components/row-form";
import { submitInsert } from "@/server/rows";
import { SchemaBanner } from "@/components/schema-banner";

export const dynamic = "force-dynamic";

export default async function InsertPage({ params }: { params: Promise<{ schema: string; table: string }> }) {
  const { schema, table } = await params;
  const shape = await describeTable(schema, table);
  const action = submitInsert.bind(null, schema, table);
  return (
    <div>
      <SchemaBanner schema={schema} />
      <h1 className="my-3 text-lg font-semibold font-mono">Insert into {schema}.{table}</h1>
      <RowForm columns={shape.columns} action={action} submitLabel="Insert" />
    </div>
  );
}
