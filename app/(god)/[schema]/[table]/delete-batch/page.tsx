import { notFound } from "next/navigation";
import { env } from "@/lib/env";
import { computeBlastRadiusMany } from "@/lib/cascade";
import { requiredPhrase, radiusTouchesBusinessUnits } from "@/lib/delete-confirm";
import { ConfirmDelete } from "@/components/confirm-delete";
import { SchemaBanner } from "@/components/schema-banner";
import { Alert } from "@/components/ui/alert";

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
  const orphanWarning = radiusTouchesBusinessUnits(radius.byTable, env().systemSchemaName);
  return (
    <div className="space-y-4">
      <SchemaBanner schema={schema} />
      <h1 className="text-base font-semibold tracking-tight">
        Delete {pks.length} selected row(s) from <span className="font-mono">{schema}.{table}</span>
      </h1>
      {orphanWarning && (
        <Alert variant="warning" title="Tenant schemas will be left orphaned.">
          <p>
            This cascade deletes <strong>business-unit registry rows</strong>, but their tenant Postgres
            schemas are not linked by a foreign key and will <strong>not</strong> be dropped. They will be
            left orphaned. To drop a tenant schema, delete that business unit individually from the
            registry.
          </p>
        </Alert>
      )}
      <ConfirmDelete schema={schema} table={table} pkJson={JSON.stringify(pks)} radius={radius}
        isBusinessUnit={false} tenantSchema={null}
        requiredPhrase={requiredPhrase({ isBusinessUnit: false, dropSchema: null })} />
    </div>
  );
}
