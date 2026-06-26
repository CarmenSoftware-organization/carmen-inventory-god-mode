import { withTransaction } from "@/lib/db";
import { ident, qualified } from "@/lib/sql-guard";
import { writeAudit, type Operation } from "@/lib/audit";
import { currentActor, whereFromPk } from "@/lib/write";

type Opts = { deletedAtColumn?: string };

async function setDeletedAt(
  schema: string, table: string, pks: Record<string, unknown>[],
  valueSql: "now()" | "NULL", operation: Operation, col: string,
): Promise<{ affected: number }> {
  if (!Array.isArray(pks) || pks.length === 0) throw new Error("No rows selected");
  const actor = await currentActor();
  return withTransaction(null, async (tx) => {
    let affected = 0;
    for (const pk of pks) {
      const { clause, args } = whereFromPk(pk, 1);
      const rows = await tx.unsafe(
        `UPDATE ${qualified(schema, table)} SET ${ident(col)} = ${valueSql} WHERE ${clause} RETURNING *`,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        args as any[],
      );
      if (rows.length > 0) {
        await writeAudit(tx, {
          actor, schemaName: schema, tableName: table, operation, pk,
          oldValues: null, newValues: rows[0] ?? null,
          statement: `UPDATE ${qualified(schema, table)} SET ${ident(col)} = ${valueSql}`,
        });
        affected += rows.length;
      }
    }
    return { affected };
  });
}

export async function softDeleteRows(
  schema: string, table: string, pks: Record<string, unknown>[], opts: Opts = {},
): Promise<{ affected: number }> {
  return setDeletedAt(schema, table, pks, "now()", "SOFT_DELETE", opts.deletedAtColumn ?? "deleted_at");
}

export async function restoreRows(
  schema: string, table: string, pks: Record<string, unknown>[], opts: Opts = {},
): Promise<{ affected: number }> {
  return setDeletedAt(schema, table, pks, "NULL", "RESTORE", opts.deletedAtColumn ?? "deleted_at");
}
