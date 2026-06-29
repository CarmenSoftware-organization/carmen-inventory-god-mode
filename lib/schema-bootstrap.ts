import postgres from "postgres";
import { env } from "@/lib/env";
import { ident } from "@/lib/sql-guard";

/** Create `schema` if it does not exist, over a one-off non-pooled connection
 *  (DDL through the pooled URL is unreliable). Idempotent. */
export async function ensureSchemaExists(schema: string): Promise<void> {
  const sql = postgres(env().systemDirectUrl, { prepare: false, max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS ${ident(schema)}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
