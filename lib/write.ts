import { withTransaction, getSql } from "@/lib/db";
import { ident, qualified } from "@/lib/sql-guard";
import { writeAudit } from "@/lib/audit";
import { getSession } from "@/lib/session";

export async function currentActor(): Promise<string> {
  try { return (await getSession()).actor ?? "god"; } catch { return "god"; }
}

export function whereFromPk(pk: Record<string, unknown>, startIndex: number): { clause: string; args: unknown[] } {
  const keys = Object.keys(pk);
  const parts = keys.map((k, i) => `${ident(k)} = $${startIndex + i}`);
  return { clause: parts.join(" AND "), args: keys.map((k) => pk[k]) };
}

async function readOne(schema: string, table: string, pk: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const { clause, args } = whereFromPk(pk, 1);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await getSql().unsafe(`SELECT * FROM ${qualified(schema, table)} WHERE ${clause} LIMIT 1`, args as any[]);
  return (rows[0] as Record<string, unknown>) ?? null;
}

export async function applyInsert(schema: string, table: string, values: Record<string, unknown>): Promise<Record<string, unknown>> {
  const actor = await currentActor();
  const cols = Object.keys(values);
  const colSql = cols.map(ident).join(", ");
  const ph = cols.map((_, i) => `$${i + 1}`).join(", ");
  const args = cols.map((c) => values[c]);
  return withTransaction(null, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await tx.unsafe(`INSERT INTO ${qualified(schema, table)} (${colSql}) VALUES (${ph}) RETURNING *`, args as any[]);
    const row = rows[0] as Record<string, unknown>;
    await writeAudit(tx, { actor, schemaName: schema, tableName: table, operation: "INSERT", pk: null, oldValues: null, newValues: row, statement: `INSERT INTO ${qualified(schema, table)}` });
    return row;
  });
}

export async function applyUpdate(schema: string, table: string, pk: Record<string, unknown>, values: Record<string, unknown>) {
  const actor = await currentActor();
  const before = await readOne(schema, table, pk);
  if (!before) throw new Error("Row not found");
  const cols = Object.keys(values);
  const setSql = cols.map((c, i) => `${ident(c)} = $${i + 1}`).join(", ");
  const setArgs = cols.map((c) => values[c]);
  const { clause, args: pkArgs } = whereFromPk(pk, cols.length + 1);
  return withTransaction(null, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await tx.unsafe(`UPDATE ${qualified(schema, table)} SET ${setSql} WHERE ${clause} RETURNING *`, [...setArgs, ...pkArgs] as any[]);
    const after = rows[0] as Record<string, unknown>;
    await writeAudit(tx, { actor, schemaName: schema, tableName: table, operation: "UPDATE", pk, oldValues: before, newValues: after, statement: `UPDATE ${qualified(schema, table)}` });
    return { before, after };
  });
}

export async function applySingleDelete(schema: string, table: string, pk: Record<string, unknown>): Promise<Record<string, unknown>> {
  const actor = await currentActor();
  const before = await readOne(schema, table, pk);
  if (!before) throw new Error("Row not found");
  const { clause, args } = whereFromPk(pk, 1);
  return withTransaction(null, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await tx.unsafe(`DELETE FROM ${qualified(schema, table)} WHERE ${clause}`, args as any[]);
    await writeAudit(tx, { actor, schemaName: schema, tableName: table, operation: "DELETE", pk, oldValues: before, newValues: null, statement: `DELETE FROM ${qualified(schema, table)}` });
    return before;
  });
}
