import { notFound } from "next/navigation";
import { env } from "@/lib/env";
import { computeBlastRadiusMany } from "@/lib/cascade";
import { requiredPhrase, radiusTouchesBusinessUnits } from "@/lib/delete-confirm";
import { confirmBatchDelete } from "@/server/delete";
import { ConfirmDelete } from "@/components/confirm-delete";
import { SchemaBanner } from "@/components/schema-banner";

export const dynamic = "force-dynamic";

export default async function DeleteBatchPage({
  params, searchParams,
}: { params: Promise<{ schema: string; table: string }>; searchParams: Promise<{ pks?: string }> }) {
  const { schema, table } = await params;
  const { pks: pksParam } = await searchParams;
  if (!pksParam) notFound();
  const pks = JSON.parse(pksParam) as Record<string, unknown>[];
  if (!Array.isArray(pks) || pks.length === 0) notFound();
  const radius = await computeBlastRadiusMany(schema, table, pks);
  const action = confirmBatchDelete.bind(null, schema, table, JSON.stringify(pks));
  const orphanWarning = radiusTouchesBusinessUnits(radius.byTable, env().systemSchemaName);
  return (
    <div>
      <SchemaBanner schema={schema} />
      <h1 className="my-3 text-lg font-semibold font-mono">Delete {pks.length} selected row(s) from {schema}.{table}</h1>
      {orphanWarning && (
        <p className="mb-3 rounded border border-amber-400 bg-amber-50 p-2 text-sm text-amber-900">
          ⚠ This cascade deletes <strong>business-unit registry rows</strong>, but their tenant Postgres schemas are not
          linked by a foreign key and will <strong>not</strong> be dropped — they will be left orphaned. To drop a tenant
          schema, delete that business unit individually from the registry.
        </p>
      )}
      <ConfirmDelete schema={schema} table={table} pkJson={JSON.stringify(pks)} radius={radius}
        action={action} isBusinessUnit={false} tenantSchema={null}
        requiredPhrase={requiredPhrase({ isBusinessUnit: false, dropSchema: null })} />
    </div>
  );
}
