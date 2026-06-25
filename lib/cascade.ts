import { getSql, withTransaction } from "@/lib/db";
import { listForeignKeys, describeTable, type ForeignKey } from "@/lib/introspect";
import { orderTablesForDeletion, type TableRef } from "@/lib/topo";
import { ident, qualified } from "@/lib/sql-guard";
import { env } from "@/lib/env";
import { writeAudit } from "@/lib/audit";
import { currentActor } from "@/lib/write";

export type CascadeRow = { schema: string; table: string; pk: Record<string, unknown>; depth: number };
export type BlastRadius = { rows: CascadeRow[]; byTable: Array<{ schema: string; table: string; count: number }>; maxDepth: number; truncated: boolean };

function rowKey(schema: string, table: string, pk: Record<string, unknown>): string {
  return `${schema}.${table}:${JSON.stringify(pk)}`;
}

// children whose FK points at (schema.table)
function childrenFks(fks: ForeignKey[], schema: string, table: string): ForeignKey[] {
  return fks.filter((f) => f.parentSchema === schema && f.parentTable === table);
}

export async function computeBlastRadius(schema: string, table: string, pk: Record<string, unknown>): Promise<BlastRadius> {
  const maxRows = env().cascadeMaxRows, maxDepth = env().cascadeMaxDepth;
  const fkCache = new Map<string, ForeignKey[]>();
  async function fksFor(s: string): Promise<ForeignKey[]> {
    if (!fkCache.has(s)) fkCache.set(s, await listForeignKeys(s));
    return fkCache.get(s)!;
  }
  const pkColsCache = new Map<string, string[]>();
  async function pkCols(s: string, t: string): Promise<string[]> {
    const k = `${s}.${t}`;
    if (!pkColsCache.has(k)) pkColsCache.set(k, (await describeTable(s, t)).primaryKey);
    return pkColsCache.get(k)!;
  }

  const seen = new Set<string>();
  const rows: CascadeRow[] = [];
  let truncated = false;
  const queue: CascadeRow[] = [{ schema, table, pk, depth: 0 }];
  seen.add(rowKey(schema, table, pk));
  rows.push(queue[0]);

  while (queue.length) {
    const node = queue.shift()!;
    if (node.depth >= maxDepth) { truncated = true; continue; }
    const fks = await fksFor(node.schema);
    for (const f of childrenFks(fks, node.schema, node.table)) {
      const childPk = await pkCols(f.childSchema, f.childTable);
      if (childPk.length === 0) continue; // can't address rows without a pk
      const whereParts = f.childColumns.map((c, i) => `${ident(c)} = $${i + 1}`);
      const args = f.parentColumns.map((pc) => node.pk[pc]);
      const selectPk = childPk.map(ident).join(", ");
      const found = await getSql().unsafe(
        `SELECT ${selectPk} FROM ${qualified(f.childSchema, f.childTable)} WHERE ${whereParts.join(" AND ")}`, args as any[],
      ) as Record<string, unknown>[];
      for (const r of found) {
        const cpk = Object.fromEntries(childPk.map((c) => [c, r[c]]));
        const key = rowKey(f.childSchema, f.childTable, cpk);
        if (seen.has(key)) continue;
        seen.add(key);
        const childRow: CascadeRow = { schema: f.childSchema, table: f.childTable, pk: cpk, depth: node.depth + 1 };
        rows.push(childRow);
        queue.push(childRow);
        if (rows.length >= maxRows) { truncated = true; queue.length = 0; break; }
      }
      if (truncated) break;
    }
  }

  const counts = new Map<string, number>();
  let maxDepthSeen = 0;
  for (const r of rows) {
    counts.set(`${r.schema}.${r.table}`, (counts.get(`${r.schema}.${r.table}`) ?? 0) + 1);
    if (r.depth > maxDepthSeen) maxDepthSeen = r.depth;
  }
  const byTable = [...counts].map(([k, count]) => { const [s, t] = k.split("."); return { schema: s, table: t, count }; });
  return { rows, byTable, maxDepth: maxDepthSeen, truncated };
}

export async function executeCascade(
  schema: string, table: string, pk: Record<string, unknown>, opts: { dropTenantSchema?: string | null },
): Promise<{ deleted: number; droppedSchema: string | null }> {
  const actor = await currentActor();
  const radius = await computeBlastRadius(schema, table, pk);
  if (radius.truncated) throw new Error("Blast radius exceeds configured caps; refusing to cascade. Raise CASCADE_MAX_ROWS/DEPTH or narrow the target.");

  const involvedTables: TableRef[] = [...new Set(radius.rows.map((r) => `${r.schema}.${r.table}`))]
    .map((k) => { const [s, t] = k.split("."); return { schema: s, table: t }; });
  const allFks: ForeignKey[] = [];
  for (const s of new Set(involvedTables.map((t) => t.schema))) allFks.push(...await listForeignKeys(s));
  const { order } = orderTablesForDeletion(involvedTables, allFks);

  const rowsByTable = new Map<string, CascadeRow[]>();
  for (const r of radius.rows) {
    const k = `${r.schema}.${r.table}`;
    if (!rowsByTable.has(k)) rowsByTable.set(k, []);
    rowsByTable.get(k)!.push(r);
  }

  return withTransaction(null, async (tx) => {
    let deleted = 0;
    for (const t of order) {
      const list = rowsByTable.get(`${t.schema}.${t.table}`) ?? [];
      for (const r of list) {
        const keys = Object.keys(r.pk);
        const clause = keys.map((k, i) => `${ident(k)} = $${i + 1}`).join(" AND ");
        const args = keys.map((k) => r.pk[k]);
        const oldRows = await tx.unsafe(`SELECT * FROM ${qualified(t.schema, t.table)} WHERE ${clause}`, args as any[]);
        await tx.unsafe(`DELETE FROM ${qualified(t.schema, t.table)} WHERE ${clause}`, args as any[]);
        await writeAudit(tx, { actor, schemaName: t.schema, tableName: t.table, operation: "CASCADE_DELETE",
          pk: r.pk, oldValues: oldRows[0] ?? null, newValues: null, statement: `DELETE FROM ${qualified(t.schema, t.table)}` });
        deleted += 1;
      }
    }
    let droppedSchema: string | null = null;
    if (opts.dropTenantSchema) {
      await tx.unsafe(`DROP SCHEMA ${ident(opts.dropTenantSchema)} CASCADE`);
      droppedSchema = opts.dropTenantSchema;
      await writeAudit(tx, { actor, schemaName: opts.dropTenantSchema, tableName: null, operation: "DROP_SCHEMA",
        pk: null, oldValues: null, newValues: null, statement: `DROP SCHEMA ${ident(opts.dropTenantSchema)} CASCADE` });
    }
    return { deleted, droppedSchema };
  });
}
