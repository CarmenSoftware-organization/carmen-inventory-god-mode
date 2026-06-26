import { getSql, withTransaction } from "@/lib/db";
import { listForeignKeys, describeTable, type ForeignKey } from "@/lib/introspect";
import { orderTablesForDeletion, type TableRef } from "@/lib/topo";
import { ident, qualified } from "@/lib/sql-guard";
import { env } from "@/lib/env";
import { writeAudit } from "@/lib/audit";
import { currentActor, whereFromPk } from "@/lib/write";
import type { OnProgress } from "@/lib/progress";

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
  return computeBlastRadiusMany(schema, table, [pk]);
}

export async function computeBlastRadiusMany(schema: string, table: string, pks: Record<string, unknown>[]): Promise<BlastRadius> {
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
  const queue: CascadeRow[] = [];
  for (const pk of pks) {
    const key = rowKey(schema, table, pk);
    if (seen.has(key)) continue;
    seen.add(key);
    const seed: CascadeRow = { schema, table, pk, depth: 0 };
    rows.push(seed);
    queue.push(seed);
  }

  while (queue.length) {
    const node = queue.shift()!;
    if (node.depth >= maxDepth) { truncated = true; continue; }
    const fks = await fksFor(node.schema);
    for (const f of childrenFks(fks, node.schema, node.table)) {
      const childPk = await pkCols(f.childSchema, f.childTable);
      if (childPk.length === 0) continue; // can't address rows without a pk
      const whereParts = f.childColumns.map((c, i) => `${ident(c)} = $${i + 1}`);
      // C1 fix: if the FK references a non-PK unique column, node.pk won't have those values.
      // Fast path: all parentColumns are present in node.pk.
      let refValues: unknown[];
      const allInPk = f.parentColumns.every((pc) => pc in node.pk);
      if (allInPk) {
        refValues = f.parentColumns.map((pc) => node.pk[pc]);
      } else {
        // Slow path: SELECT the referenced columns from the parent row using the PK.
        const { clause: pkClause, args: pkArgs } = whereFromPk(node.pk, 1);
        const selectCols = f.parentColumns.map(ident).join(", ");
        const refRows = await getSql().unsafe(
          `SELECT ${selectCols} FROM ${qualified(node.schema, node.table)} WHERE ${pkClause} LIMIT 1`,
          pkArgs as any[],
        ) as Record<string, unknown>[];
        if (refRows.length === 0) continue; // parent row doesn't exist, skip
        refValues = f.parentColumns.map((pc) => refRows[0][pc]);
      }
      const args = refValues;
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

async function deleteRadius(
  actor: string, radius: BlastRadius, opts: { dropTenantSchemas?: string[]; onProgress?: OnProgress },
): Promise<{ deleted: number; droppedSchemas: string[] }> {
  if (radius.truncated) throw new Error("Blast radius exceeds configured caps; refusing to cascade. Raise CASCADE_MAX_ROWS/DEPTH or narrow the target.");

  const involvedTables: TableRef[] = [...new Set(radius.rows.map((r) => `${r.schema}.${r.table}`))]
    .map((k) => { const [s, t] = k.split("."); return { schema: s, table: t }; });
  const allFks: ForeignKey[] = [];
  for (const s of new Set(involvedTables.map((t) => t.schema))) allFks.push(...await listForeignKeys(s));
  const { order, cycles } = orderTablesForDeletion(involvedTables, allFks);

  // If a genuine multi-table FK cycle exists, refuse to proceed (fail-safe).
  if (cycles.length > 0) {
    throw new Error(
      "Cannot cascade: foreign-key cycle among tables " +
      cycles.flat().join(", ") +
      " (NO ACTION FKs cannot be deleted in any order). Resolve manually.",
    );
  }

  const rowsByTable = new Map<string, CascadeRow[]>();
  for (const r of radius.rows) {
    const k = `${r.schema}.${r.table}`;
    if (!rowsByTable.has(k)) rowsByTable.set(k, []);
    rowsByTable.get(k)!.push(r);
  }

  const onProgress = opts.onProgress;
  const dropSchemas = opts.dropTenantSchemas ?? [];
  onProgress?.({ type: "total", total: radius.rows.length + dropSchemas.length });

  return withTransaction(null, async (tx) => {
    let deleted = 0;
    for (const t of order) {
      const list = rowsByTable.get(`${t.schema}.${t.table}`) ?? [];
      if (list.length > 0) {
        onProgress?.({ type: "step", label: `Deleting ${t.schema}.${t.table} (${list.length} rows)…`, done: deleted });
      }
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
    const droppedSchemas: string[] = [];
    for (const s of dropSchemas) {
      onProgress?.({ type: "step", label: `Dropping schema ${s}…`, done: deleted + droppedSchemas.length });
      await tx.unsafe(`DROP SCHEMA ${ident(s)} CASCADE`);
      droppedSchemas.push(s);
      await writeAudit(tx, { actor, schemaName: s, tableName: null, operation: "DROP_SCHEMA",
        pk: null, oldValues: null, newValues: null, statement: `DROP SCHEMA ${ident(s)} CASCADE` });
    }
    return { deleted, droppedSchemas };
  });
}

export async function executeCascade(
  schema: string, table: string, pk: Record<string, unknown>,
  opts: { dropTenantSchemas?: string[]; onProgress?: OnProgress },
): Promise<{ deleted: number; droppedSchemas: string[] }> {
  const actor = await currentActor();
  opts.onProgress?.({ type: "step", label: "Computing blast radius…" });
  const radius = await computeBlastRadius(schema, table, pk);
  return deleteRadius(actor, radius, opts);
}

export async function executeCascadeMany(
  schema: string, table: string, pks: Record<string, unknown>[],
  opts: { onProgress?: OnProgress } = {},
): Promise<{ deleted: number }> {
  const actor = await currentActor();
  opts.onProgress?.({ type: "step", label: "Computing blast radius…" });
  const radius = await computeBlastRadiusMany(schema, table, pks);
  const { deleted } = await deleteRadius(actor, radius, { dropTenantSchemas: [], onProgress: opts.onProgress });
  return { deleted };
}
