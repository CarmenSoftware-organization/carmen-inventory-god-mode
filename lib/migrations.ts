import { getSql } from "@/lib/db";
import { env } from "@/lib/env";
import { qualified } from "@/lib/sql-guard";
import { ensureAuditTable } from "@/lib/audit";
import type { OnProgress } from "@/lib/progress";

/** Ensure tb_cluster has a deleted_at column for soft delete. Idempotent; no-op if the table is absent. */
export async function ensureClusterDeletedAt(): Promise<void> {
  const rel = qualified(env().systemSchemaName, "tb_cluster");
  try {
    await getSql().unsafe(`ALTER TABLE ${rel} ADD COLUMN IF NOT EXISTS deleted_at timestamptz`);
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === "42P01") return; // table absent — nothing to migrate
    throw err;
  }
}

export type MigrationTask = { name: string; run: () => Promise<void> };

export function migrationTasks(): MigrationTask[] {
  return [
    { name: "Ensure audit table", run: ensureAuditTable },
    { name: "Add tb_cluster.deleted_at", run: ensureClusterDeletedAt },
  ];
}

export async function runMigrations(onProgress?: OnProgress): Promise<{ count: number }> {
  const tasks = migrationTasks();
  onProgress?.({ type: "total", total: tasks.length });
  let done = 0;
  for (const t of tasks) {
    onProgress?.({ type: "step", label: `${t.name}…`, done });
    await t.run();
    done += 1;
  }
  return { count: tasks.length };
}
