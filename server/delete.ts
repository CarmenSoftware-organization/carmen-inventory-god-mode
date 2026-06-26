"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { env } from "@/lib/env";
import { executeCascade, executeCascadeMany } from "@/lib/cascade";
import { requiredPhrase, phraseMatches } from "@/lib/delete-confirm";
import { resolveTenantSchema, resolveTenantSchemasForCluster } from "@/lib/registry";
import { requireAuth } from "@/lib/session";

export async function confirmDelete(schema: string, table: string, pkJson: string, formData: FormData): Promise<void> {
  await requireAuth();
  const pk = JSON.parse(pkJson) as Record<string, unknown>;
  const isBusinessUnit = schema === env().systemSchemaName && table === "tb_business_unit";
  const isCluster = schema === env().systemSchemaName && table === "tb_cluster";
  let dropSchemas: string[] = [];
  if (formData.get("drop_schema") === "on") {
    if (isBusinessUnit) {
      const s = await resolveTenantSchema(String(pk.id));
      if (s) dropSchemas = [s];
    } else if (isCluster) {
      dropSchemas = await resolveTenantSchemasForCluster(String(pk.id));
    }
  }
  // BU keeps the schema-name confirmation phrase when dropping its single schema;
  // cluster drops multiple schemas, so the phrase stays "DELETE".
  const phrase = requiredPhrase({ isBusinessUnit, dropSchema: isBusinessUnit ? (dropSchemas[0] ?? null) : null });
  if (!phraseMatches(String(formData.get("confirm") ?? ""), phrase)) {
    throw new Error(`Confirmation text must equal "${phrase}"`);
  }
  await executeCascade(schema, table, pk, { dropTenantSchemas: dropSchemas });
  if (isBusinessUnit) { revalidatePath("/schemas"); redirect("/schemas"); }
  if (isCluster) { revalidatePath("/clusters"); redirect("/clusters"); }
  revalidatePath(`/${schema}/${table}`);
  redirect(`/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`);
}

export async function confirmBatchDelete(schema: string, table: string, pksJson: string, formData: FormData): Promise<void> {
  await requireAuth();
  const pks = JSON.parse(pksJson) as Record<string, unknown>[];
  if (!Array.isArray(pks) || pks.length === 0) throw new Error("No rows selected");
  const phrase = requiredPhrase({ isBusinessUnit: false, dropSchema: null });
  if (!phraseMatches(String(formData.get("confirm") ?? ""), phrase)) {
    throw new Error(`Confirmation text must equal "${phrase}"`);
  }
  await executeCascadeMany(schema, table, pks);
  const isBusinessUnit = schema === env().systemSchemaName && table === "tb_business_unit";
  if (isBusinessUnit) {
    revalidatePath("/schemas");
    redirect("/schemas");
  }
  const isCluster = schema === env().systemSchemaName && table === "tb_cluster";
  if (isCluster) {
    revalidatePath("/clusters");
    redirect("/clusters");
  }
  revalidatePath(`/${schema}/${table}`);
  redirect(`/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`);
}
