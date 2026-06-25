import type { ColumnInfo } from "@/lib/introspect";

export function coerceValue(col: ColumnInfo, raw: string, isNull: boolean): unknown {
  if (isNull) return null;
  const t = col.udtName.toLowerCase();
  if (["int2", "int4", "int8", "numeric", "float4", "float8"].includes(t)) {
    if (raw.trim() === "") return null;
    const n = Number(raw);
    if (Number.isNaN(n)) throw new Error(`Invalid number for ${col.name}: ${raw}`);
    return n;
  }
  if (t === "bool") return raw === "true" || raw === "on" || raw === "t";
  if (t === "json" || t === "jsonb") {
    try { return JSON.parse(raw); } catch { throw new Error(`Invalid JSON for ${col.name}`); }
  }
  return raw;
}
