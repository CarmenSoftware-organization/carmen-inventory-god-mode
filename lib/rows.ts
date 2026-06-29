import { getSql } from "@/lib/db";
import { describeTable, type ColumnInfo } from "@/lib/introspect";
import { ident, qualified } from "@/lib/sql-guard";

export type RowPage = { columns: ColumnInfo[]; primaryKey: string[]; rows: Record<string, unknown>[]; nextCursor: string | null };

function encodeCursor(v: unknown[]): string { return Buffer.from(JSON.stringify(v)).toString("base64url"); }
function decodeCursor(c: string): unknown[] { return JSON.parse(Buffer.from(c, "base64url").toString("utf8")); }

export function rowPk(row: Record<string, unknown>, primaryKey: string[]): Record<string, unknown> {
  return Object.fromEntries(primaryKey.map((k) => [k, row[k]]));
}

export async function readRows(
  schema: string, table: string, opts: { limit?: number; cursor?: string | null } = {},
): Promise<RowPage> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const shape = await describeTable(schema, table);
  const rel = qualified(schema, table);
  const orderCols = shape.primaryKey.length ? shape.primaryKey : null;

  if (!orderCols) {
    const rows = (await getSql().unsafe(`SELECT * FROM ${rel} ORDER BY ctid LIMIT $1`, [limit])) as unknown as Record<string, unknown>[];
    return { columns: shape.columns, primaryKey: [], rows, nextCursor: null };
  }

  const orderBy = orderCols.map((c) => `${ident(c)} ASC`).join(", ");
  let where = "";
  const args: (string | number | boolean | null)[] = [];
  if (opts.cursor) {
    const vals = decodeCursor(opts.cursor) as (string | number | boolean | null)[];
    // row-wise comparison: (c1,c2,...) > ($1,$2,...)
    const lhs = `(${orderCols.map(ident).join(", ")})`;
    const rhs = `(${orderCols.map((_, i) => `$${i + 1}`).join(", ")})`;
    where = `WHERE ${lhs} > ${rhs}`;
    args.push(...vals);
  }
  args.push(limit + 1);
  const rows = (await getSql().unsafe(
    `SELECT * FROM ${rel} ${where} ORDER BY ${orderBy} LIMIT $${args.length}`, args,
  )) as Record<string, unknown>[];

  let nextCursor: string | null = null;
  if (rows.length > limit) {
    rows.pop();
    const last = rows[rows.length - 1];
    nextCursor = encodeCursor(orderCols.map((c) => last[c]));
  }
  return { columns: shape.columns, primaryKey: shape.primaryKey, rows, nextCursor };
}
