import type { Parameter, TransactionSql } from "postgres";
import { getSql } from "@/lib/db";
import { env } from "@/lib/env";
import { qualified } from "@/lib/sql-guard";

export type Operation = "INSERT" | "UPDATE" | "DELETE" | "CASCADE_DELETE" | "CREATE_SCHEMA" | "DROP_SCHEMA" | "RAW_SQL" | "SOFT_DELETE" | "RESTORE" | "MIGRATION";
export type AuditEntry = { actor: string; schemaName: string; tableName: string | null; operation: Operation; pk: unknown; oldValues: unknown; newValues: unknown; statement: string | null };

export type AuditRow = {
  id: string; at: string; actor: string; schemaName: string;
  tableName: string | null; operation: Operation;
  pk: unknown; oldValues: unknown; newValues: unknown; statement: string | null;
};

function encodeCursor(v: [string, string]): string {
  return Buffer.from(JSON.stringify(v)).toString("base64url");
}
function decodeCursor(c: string): [string, string] {
  return JSON.parse(Buffer.from(c, "base64url").toString("utf8")) as [string, string];
}

function auditRel(): string { return qualified(env().systemSchemaName, "tb_god_mode_audit"); }

export async function ensureAuditTable(): Promise<void> {
  await getSql().unsafe(`
    CREATE TABLE IF NOT EXISTS ${auditRel()} (
      id uuid primary key default gen_random_uuid(),
      at timestamptz not null default now(),
      actor text not null,
      schema_name text not null,
      table_name text,
      operation text not null,
      pk jsonb, old_values jsonb, new_values jsonb, statement text
    )`);
}

export async function writeAudit(tx: TransactionSql, e: AuditEntry): Promise<void> {
  await tx.unsafe(
    `INSERT INTO ${auditRel()} (actor, schema_name, table_name, operation, pk, old_values, new_values, statement)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [e.actor, e.schemaName, e.tableName, e.operation,
     e.pk == null ? null : JSON.stringify(e.pk),
     e.oldValues == null ? null : JSON.stringify(e.oldValues),
     e.newValues == null ? null : JSON.stringify(e.newValues),
     e.statement],
  );
}

export async function listAuditPage(
  filter: { schema?: string; table?: string; operation?: Operation; limit?: number; cursor?: string | null } = {},
): Promise<{ entries: AuditRow[]; nextCursor: string | null }> {
  const conds: string[] = []; const args: (string | number | Parameter<string>)[] = [];
  if (filter.schema) { args.push(filter.schema); conds.push(`schema_name = $${args.length}`); }
  if (filter.table) { args.push(filter.table); conds.push(`table_name = $${args.length}`); }
  if (filter.operation) { args.push(filter.operation); conds.push(`operation = $${args.length}`); }
  if (filter.cursor) {
    const [curAt, curId] = decodeCursor(filter.cursor);
    // postgres.js infers this placeholder's wire type as timestamptz (from the `::timestamptz`
    // cast below) and, once it learns that, re-serializes the value via `new Date(x).toISOString()`,
    // which silently truncates microseconds to milliseconds — corrupting keyset comparisons
    // whenever rows share a timestamp to sub-millisecond resolution (e.g. many audit rows
    // written in one transaction, which all share the same `now()`). Forcing the wire type to
    // text (OID 25) makes postgres.js send the value verbatim; Postgres then parses the text
    // itself with full microsecond precision via the explicit `::timestamptz` cast.
    args.push(getSql().typed(curAt, 25)); const atIdx = args.length;
    args.push(curId); const idIdx = args.length;
    // Keyset for ORDER BY at DESC, id DESC: next page is strictly "less than" the cursor row.
    conds.push(`(at, id) < ($${atIdx}::timestamptz, $${idIdx}::uuid)`);
  }
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 500);
  args.push(limit + 1);
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const rows = (await getSql().unsafe(
    `SELECT id::text, at::text, actor, schema_name, table_name, operation, pk, old_values, new_values, statement
     FROM ${auditRel()} ${where} ORDER BY at DESC, id DESC LIMIT $${args.length}`, args)) as unknown as {
    id: string; at: string; actor: string; schema_name: string; table_name: string | null;
    operation: string; pk: unknown; old_values: unknown; new_values: unknown; statement: string | null;
  }[];

  let nextCursor: string | null = null;
  if (rows.length > limit) {
    rows.pop();
    const last = rows[rows.length - 1];
    nextCursor = encodeCursor([last.at, last.id]);
  }

  const parseJson = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);
  const entries: AuditRow[] = rows.map((r) => ({
    id: r.id, at: r.at, actor: r.actor, schemaName: r.schema_name, tableName: r.table_name,
    operation: r.operation as Operation,
    pk: r.pk == null ? null : parseJson(r.pk),
    oldValues: r.old_values == null ? null : parseJson(r.old_values),
    newValues: r.new_values == null ? null : parseJson(r.new_values),
    statement: r.statement,
  }));
  return { entries, nextCursor };
}

export async function listAudit(
  filter: { schema?: string; table?: string; operation?: Operation; limit?: number } = {},
): Promise<AuditRow[]> {
  return (await listAuditPage(filter)).entries;
}
