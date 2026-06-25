import { env } from "@/lib/env";

export function SchemaBanner({ schema }: { schema: string | null }) {
  if (!schema) return null;
  const isSystem = schema === env().systemSchemaName;
  const cls = isSystem ? "bg-red-600 text-white" : "bg-amber-500 text-black";
  return (
    <div className={`flex items-center gap-2 px-4 py-1 text-sm font-semibold ${cls}`}>
      <span className="rounded bg-black/20 px-2 py-0.5">{isSystem ? "SYSTEM" : "TENANT"}</span>
      {!isSystem && <span>Operating in: {schema}</span>}
      <span className="ml-auto opacity-80">GOD MODE — changes are permanent</span>
    </div>
  );
}
