import { getSql } from "@/lib/db";
import { qualified } from "@/lib/sql-guard";

export type ColumnInfo = { name: string; dataType: string; udtName: string; isNullable: boolean; default: string | null; isPrimaryKey: boolean };
export type TableInfo = { schema: string; name: string; estimatedRows: number };
export type OnDelete = "NO ACTION" | "RESTRICT" | "CASCADE" | "SET NULL" | "SET DEFAULT";
export type ForeignKey = { childSchema: string; childTable: string; childColumns: string[]; parentSchema: string; parentTable: string; parentColumns: string[]; onDelete: OnDelete };
export type TableShape = { columns: ColumnInfo[]; primaryKey: string[] };

const ON_DELETE: Record<string, OnDelete> = { a: "NO ACTION", r: "RESTRICT", c: "CASCADE", n: "SET NULL", d: "SET DEFAULT" };

export async function listSchemaNames(): Promise<string[]> {
  const rows = await getSql().unsafe(
    `SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema' ORDER BY nspname`,
  );
  return rows.map((r: any) => r.nspname as string);
}

export async function listTables(schema: string): Promise<TableInfo[]> {
  const rows = await getSql().unsafe(
    `SELECT c.relname AS name, GREATEST(c.reltuples, 0)::bigint AS estimated_rows
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = $1 AND c.relkind = 'r' ORDER BY c.relname`,
    [schema],
  );
  return rows.map((r: any) => ({ schema, name: r.name, estimatedRows: Number(r.estimated_rows) }));
}

export async function describeTable(schema: string, table: string): Promise<TableShape> {
  const reg = qualified(schema, table);
  const cols = await getSql().unsafe(
    `SELECT a.attname AS name,
            format_type(a.atttypid, a.atttypmod) AS data_type,
            t.typname AS udt_name,
            NOT a.attnotnull AS is_nullable,
            pg_get_expr(d.adbin, d.adrelid) AS "default",
            COALESCE(pk.is_pk, false) AS is_primary_key
     FROM pg_attribute a
     JOIN pg_type t ON t.oid = a.atttypid
     LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     LEFT JOIN (
       SELECT a2.attname, true AS is_pk
       FROM pg_index i JOIN pg_attribute a2 ON a2.attrelid = i.indrelid AND a2.attnum = ANY(i.indkey)
       WHERE i.indrelid = $1::regclass AND i.indisprimary
     ) pk ON pk.attname = a.attname
     WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY a.attnum`,
    [reg],
  );
  const columns: ColumnInfo[] = cols.map((c: any) => ({
    name: c.name, dataType: c.data_type, udtName: c.udt_name,
    isNullable: c.is_nullable, default: c.default ?? null, isPrimaryKey: c.is_primary_key,
  }));
  const pkRows = await getSql().unsafe(
    `SELECT a.attname FROM pg_index i
     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
     WHERE i.indrelid = $1::regclass AND i.indisprimary
     ORDER BY array_position(i.indkey::smallint[], a.attnum)`,
    [reg],
  );
  return { columns, primaryKey: pkRows.map((r: any) => r.attname as string) };
}

export async function listForeignKeys(schema: string): Promise<ForeignKey[]> {
  const rows = await getSql().unsafe(
    `SELECT nc.nspname AS child_schema, child.relname AS child_table,
            array_agg(ac.attname ORDER BY k.ord) AS child_columns,
            np.nspname AS parent_schema, parent.relname AS parent_table,
            array_agg(ap.attname ORDER BY k.ord) AS parent_columns,
            con.confdeltype AS on_delete
     FROM pg_constraint con
     JOIN pg_class child ON child.oid = con.conrelid
     JOIN pg_namespace nc ON nc.oid = child.relnamespace
     JOIN pg_class parent ON parent.oid = con.confrelid
     JOIN pg_namespace np ON np.oid = parent.relnamespace
     JOIN LATERAL unnest(con.conkey, con.confkey) WITH ORDINALITY AS k(child_attnum, parent_attnum, ord) ON true
     JOIN pg_attribute ac ON ac.attrelid = con.conrelid AND ac.attnum = k.child_attnum
     JOIN pg_attribute ap ON ap.attrelid = con.confrelid AND ap.attnum = k.parent_attnum
     WHERE con.contype = 'f' AND ($1 IN (nc.nspname, np.nspname))
     GROUP BY nc.nspname, child.relname, np.nspname, parent.relname, con.oid, con.confdeltype
     ORDER BY nc.nspname, child.relname, con.oid`,
    [schema],
  );
  return rows.map((r: any) => ({
    childSchema: r.child_schema, childTable: r.child_table, childColumns: r.child_columns,
    parentSchema: r.parent_schema, parentTable: r.parent_table, parentColumns: r.parent_columns,
    onDelete: ON_DELETE[r.on_delete] ?? "NO ACTION",
  }));
}
