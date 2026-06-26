import { withTransaction } from "@/lib/db";
import { ident, qualified } from "@/lib/sql-guard";
import { writeAudit, type Operation } from "@/lib/audit";
import { currentActor, whereFromPk } from "@/lib/write";

type Opts = {
  deletedAtColumn?: string;
  // When set, the helper also writes a "deleted by" column: to deletedById on
  // soft delete (NULL if not provided), and back to NULL on restore. Opt-in so
  // tables without such a column are unaffected.
  deletedByColumn?: string;
  deletedById?: string | null;
};

async function setDeletedAt(
  schema: string, table: string, pks: Record<string, unknown>[],
  mode: "delete" | "restore", operation: Operation, opts: Opts,
): Promise<{ affected: number }> {
  if (!Array.isArray(pks) || pks.length === 0) throw new Error("No rows selected");
  const col = opts.deletedAtColumn ?? "deleted_at";
  const byCol = opts.deletedByColumn;
  const deletedAtSql = mode === "delete" ? "now()" : "NULL";
  const actor = await currentActor();
  return withTransaction(null, async (tx) => {
    let affected = 0;
    for (const pk of pks) {
      const setParts = [`${ident(col)} = ${deletedAtSql}`];
      const leadingArgs: unknown[] = [];
      if (byCol) {
        if (mode === "delete") {
          leadingArgs.push(opts.deletedById ?? null);
          setParts.push(`${ident(byCol)} = $${leadingArgs.length}::uuid`);
        } else {
          setParts.push(`${ident(byCol)} = NULL`);
        }
      }
      const setSql = setParts.join(", ");
      const { clause, args: pkArgs } = whereFromPk(pk, leadingArgs.length + 1);
      const rows = await tx.unsafe(
        `UPDATE ${qualified(schema, table)} SET ${setSql} WHERE ${clause} RETURNING *`,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [...leadingArgs, ...pkArgs] as any[],
      );
      if (rows.length > 0) {
        await writeAudit(tx, {
          actor, schemaName: schema, tableName: table, operation, pk,
          oldValues: null, newValues: rows[0] ?? null,
          statement: `UPDATE ${qualified(schema, table)} SET ${setSql}`,
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
  return setDeletedAt(schema, table, pks, "delete", "SOFT_DELETE", opts);
}

export async function restoreRows(
  schema: string, table: string, pks: Record<string, unknown>[], opts: Opts = {},
): Promise<{ affected: number }> {
  return setDeletedAt(schema, table, pks, "restore", "RESTORE", opts);
}
