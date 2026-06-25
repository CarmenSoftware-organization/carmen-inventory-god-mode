"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { describeTable } from "@/lib/introspect";
import { coerceValue } from "@/lib/coerce";
import { applyInsert, applyUpdate } from "@/lib/write";
import { requireAuth } from "@/lib/session";

async function valuesFromForm(schema: string, table: string, formData: FormData, includeAllColumns: boolean) {
  const shape = await describeTable(schema, table);
  const values: Record<string, unknown> = {};
  for (const col of shape.columns) {
    const present = formData.has(`f_${col.name}`);
    if (!includeAllColumns && !present && !formData.has(`null_${col.name}`)) continue;
    const isNull = formData.get(`null_${col.name}`) === "on";
    const raw = String(formData.get(`f_${col.name}`) ?? "");
    if (col.isPrimaryKey && col.default && raw.trim() === "" && !isNull) continue; // let DB default fire
    values[col.name] = coerceValue(col, raw, isNull);
  }
  return values;
}

export async function submitInsert(schema: string, table: string, formData: FormData): Promise<void> {
  await requireAuth();
  const values = await valuesFromForm(schema, table, formData, false);
  await applyInsert(schema, table, values);
  revalidatePath(`/${schema}/${table}`);
  redirect(`/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`);
}

export async function submitUpdate(schema: string, table: string, pkJson: string, formData: FormData): Promise<void> {
  await requireAuth();
  const pk = JSON.parse(pkJson) as Record<string, unknown>;
  const values = await valuesFromForm(schema, table, formData, true);
  for (const k of Object.keys(pk)) delete values[k]; // never update pk columns
  await applyUpdate(schema, table, pk, values);
  revalidatePath(`/${schema}/${table}`);
  redirect(`/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`);
}
