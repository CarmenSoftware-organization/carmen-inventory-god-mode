import { revalidatePath } from "next/cache";
import { env } from "@/lib/env";
import { requireAuth } from "@/lib/session";
import { executeCascade, executeCascadeMany } from "@/lib/cascade";
import { requiredPhrase, phraseMatches } from "@/lib/delete-confirm";
import { resolveTenantSchema, resolveTenantSchemasForCluster } from "@/lib/registry";
import { streamOperation } from "@/lib/progress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  schema: string; table: string;
  pks: Record<string, unknown>[]; dropSchema?: boolean; confirm: string;
};

export async function POST(request: Request): Promise<Response> {
  try {
    await requireAuth();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { schema, table, pks, dropSchema, confirm } = (await request.json()) as Body;
  if (!Array.isArray(pks) || pks.length === 0) {
    return Response.json({ error: "No rows selected" }, { status: 400 });
  }

  const isBusinessUnit = schema === env().systemSchemaName && table === "tb_business_unit";
  const isCluster = schema === env().systemSchemaName && table === "tb_cluster";
  const isSingle = pks.length === 1;

  // Only single-row delete may drop tenant schemas (batch never drops).
  let dropSchemas: string[] = [];
  if (isSingle && dropSchema) {
    if (isBusinessUnit) { const s = await resolveTenantSchema(String(pks[0].id)); if (s) dropSchemas = [s]; }
    else if (isCluster) { dropSchemas = await resolveTenantSchemasForCluster(String(pks[0].id)); }
  }

  // BU + single + drop → phrase is the schema name; everything else → "DELETE".
  const phrase = requiredPhrase({
    isBusinessUnit,
    dropSchema: isBusinessUnit && isSingle ? (dropSchemas[0] ?? null) : null,
  });
  if (!phraseMatches(confirm ?? "", phrase)) {
    return Response.json({ error: `Confirmation text must equal "${phrase}"` }, { status: 400 });
  }

  const redirect = isBusinessUnit
    ? "/schemas"
    : isCluster
    ? "/clusters"
    : `/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`;

  return streamOperation(async (onProgress) => {
    let summary: string;
    if (isSingle) {
      const res = await executeCascade(schema, table, pks[0], { dropTenantSchemas: dropSchemas, onProgress });
      summary = `Deleted ${res.deleted} row(s)` +
        (res.droppedSchemas.length ? `, dropped ${res.droppedSchemas.length} schema(s)` : "");
    } else {
      const res = await executeCascadeMany(schema, table, pks, { onProgress });
      summary = `Deleted ${res.deleted} row(s)`;
    }
    // mirror the prior server-action revalidation
    if (isBusinessUnit) revalidatePath("/schemas");
    if (isCluster) revalidatePath("/clusters");
    revalidatePath(`/${schema}/${table}`);
    return { summary, redirect };
  });
}
