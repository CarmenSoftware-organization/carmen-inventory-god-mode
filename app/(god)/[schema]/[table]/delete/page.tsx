import { notFound } from "next/navigation";
import { env } from "@/lib/env";
import { computeBlastRadius } from "@/lib/cascade";
import { resolveTenantSchema, resolveTenantSchemasForCluster } from "@/lib/registry";
import { requiredPhrase } from "@/lib/delete-confirm";
import { confirmDelete } from "@/server/delete";
import { ConfirmDelete } from "@/components/confirm-delete";
import { SchemaBanner } from "@/components/schema-banner";

export const dynamic = "force-dynamic";

export default async function DeletePage({
  params, searchParams,
}: { params: Promise<{ schema: string; table: string }>; searchParams: Promise<{ pk?: string }> }) {
  const { schema, table } = await params;
  const { pk: pkParam } = await searchParams;
  if (!pkParam) notFound();
  const pk = JSON.parse(pkParam) as Record<string, unknown>;
  const isBusinessUnit = schema === env().systemSchemaName && table === "tb_business_unit";
  const tenantSchema = isBusinessUnit ? await resolveTenantSchema(String(pk.id)) : null;
  const isCluster = schema === env().systemSchemaName && table === "tb_cluster";
  const orphanSchemas = isCluster ? await resolveTenantSchemasForCluster(String(pk.id)) : undefined;
  const radius = await computeBlastRadius(schema, table, pk);
  const action = confirmDelete.bind(null, schema, table, JSON.stringify(pk));
  return (
    <div>
      <SchemaBanner schema={schema} />
      <h1 className="my-3 text-lg font-semibold font-mono">Delete from {schema}.{table}</h1>
      <ConfirmDelete schema={schema} table={table} pkJson={JSON.stringify(pk)} radius={radius}
        action={action} isBusinessUnit={isBusinessUnit} tenantSchema={tenantSchema}
        orphanSchemas={orphanSchemas}
        requiredPhrase={requiredPhrase({ isBusinessUnit, dropSchema: null })} />
    </div>
  );
}
