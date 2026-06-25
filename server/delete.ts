"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { env } from "@/lib/env";
import { executeCascade, executeCascadeMany } from "@/lib/cascade";
import { requiredPhrase, phraseMatches } from "@/lib/delete-confirm";
import { resolveTenantSchema } from "@/lib/registry";
import { requireAuth } from "@/lib/session";

export async function confirmDelete(schema: string, table: string, pkJson: string, formData: FormData): Promise<void> {
  await requireAuth();
  const pk = JSON.parse(pkJson) as Record<string, unknown>;
  const isBusinessUnit = schema === env().systemSchemaName && table === "tb_business_unit";
  let dropSchema: string | null = null;
  if (isBusinessUnit && formData.get("drop_schema") === "on") {
    dropSchema = await resolveTenantSchema(String(pk.id));
  }
  const phrase = requiredPhrase({ isBusinessUnit, dropSchema });
  if (!phraseMatches(String(formData.get("confirm") ?? ""), phrase)) {
    throw new Error(`Confirmation text must equal "${phrase}"`);
  }
  await executeCascade(schema, table, pk, { dropTenantSchema: dropSchema });
  if (isBusinessUnit) {
    revalidatePath("/schemas");
    redirect("/schemas");
  }
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
  revalidatePath(`/${schema}/${table}`);
  redirect(`/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`);
}
