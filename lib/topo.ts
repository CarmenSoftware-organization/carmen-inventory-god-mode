import type { ForeignKey } from "@/lib/introspect";

export type TableRef = { schema: string; table: string };
export function tableKey(t: TableRef): string { return `${t.schema}.${t.table}`; }

export function orderTablesForDeletion(tables: TableRef[], fks: ForeignKey[]): { order: TableRef[]; cycles: string[][] } {
  const byKey = new Map<string, TableRef>();
  for (const t of tables) byKey.set(tableKey(t), t);

  // edge child -> parent (child must be deleted first). Ignore self-edges.
  const parents = new Map<string, Set<string>>(); // key -> set of parent keys it depends on
  for (const k of byKey.keys()) parents.set(k, new Set());
  for (const f of fks) {
    const c = `${f.childSchema}.${f.childTable}`;
    const p = `${f.parentSchema}.${f.parentTable}`;
    if (c === p) continue;
    if (!byKey.has(c) || !byKey.has(p)) continue;
    parents.get(c)!.add(p);
  }

  // Kahn: emit a table once all its parents (that it depends on) are already emitted? No —
  // child must come BEFORE parent. So emit a table when nothing it depends-on-being-after remains.
  // Reframe: we want order where child precedes parent. Build indegree on edge parent<-child meaning
  // "parent waits for child". A parent can be emitted only after all its children are emitted.
  const childrenOf = new Map<string, Set<string>>(); // parentKey -> child keys
  for (const k of byKey.keys()) childrenOf.set(k, new Set());
  for (const [child, ps] of parents) for (const p of ps) childrenOf.get(p)!.add(child);

  const remainingChildren = new Map<string, number>();
  for (const [k, kids] of childrenOf) remainingChildren.set(k, kids.size);

  const ready: string[] = [...remainingChildren].filter(([, n]) => n === 0).map(([k]) => k).sort();
  const order: TableRef[] = [];
  const emitted = new Set<string>();
  while (ready.length) {
    const k = ready.shift()!;
    if (emitted.has(k)) continue;
    emitted.add(k);
    order.push(byKey.get(k)!);
    for (const p of parents.get(k)!) {
      remainingChildren.set(p, remainingChildren.get(p)! - 1);
      if (remainingChildren.get(p) === 0) { ready.push(p); ready.sort(); }
    }
  }

  const cycles: string[][] = [];
  if (emitted.size < byKey.size) {
    const stuck = [...byKey.keys()].filter((k) => !emitted.has(k));
    cycles.push(stuck);
    for (const k of stuck) order.push(byKey.get(k)!); // best-effort
  }
  return { order, cycles };
}
