import { getSql } from "@/lib/db";
import { env } from "@/lib/env";
import { qualified } from "@/lib/sql-guard";

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
