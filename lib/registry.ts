import { getSql } from "@/lib/db";
import { env } from "@/lib/env";
import { qualified } from "@/lib/sql-guard";
import { listSchemaNames } from "@/lib/introspect";

export type BusinessUnit = { id: string; code: string; name: string; clusterId: string | null; isActive: boolean; tenantSchema: string | null };

export async function listBusinessUnits(): Promise<BusinessUnit[]> {
  const reg = qualified(env().systemSchemaName, "tb_business_unit");
  try {
    const rows = await getSql().unsafe(
      `SELECT id::text, cluster_id::text AS cluster_id, code, name,
              COALESCE(is_active, true) AS is_active,
              db_connection->>'schema' AS tenant_schema
       FROM ${reg} ORDER BY code`,
    );
    return rows.map((r: any) => ({
      id: r.id, code: r.code, name: r.name, clusterId: r.cluster_id ?? null,
      isActive: r.is_active, tenantSchema: r.tenant_schema ?? null,
    }));
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === "42P01") return [];
    throw err;
  }
}

export async function resolveTenantSchema(businessUnitId: string): Promise<string | null> {
  const reg = qualified(env().systemSchemaName, "tb_business_unit");
  const rows = await getSql().unsafe(
    `SELECT db_connection->>'schema' AS tenant_schema FROM ${reg} WHERE id = $1::uuid`,
    [businessUnitId],
  );
  return rows[0]?.tenant_schema ?? null;
}

export async function listSelectableSchemas(): Promise<{ system: string; tenantSchemas: string[]; allSchemas: string[] }> {
  const system = env().systemSchemaName;
  const bus = await listBusinessUnits();
  const tenantSchemas = [...new Set(bus.map((b) => b.tenantSchema).filter((s): s is string => !!s))].sort();
  const allSchemas = await listSchemaNames();
  return { system, tenantSchemas, allSchemas };
}
