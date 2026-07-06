import { withTransaction } from "@/lib/db";
import { ident } from "@/lib/sql-guard";
import { env } from "@/lib/env";
import { writeAudit, ensureAuditTable } from "@/lib/audit";
import { currentActor } from "@/lib/write";
import type { OnProgress } from "@/lib/progress";

/**
 * The system schema is this console's own backbone — the registry, auth, and
 * business-unit tables it depends on. Dropping it would brick the tool and the
 * platform, so it is the one schema this feature always refuses to touch.
 */
export function isSystemSchema(schema: string): boolean {
  return schema === env().systemSchemaName;
}

/**
 * Permanently `DROP SCHEMA <schema> CASCADE` and record a DROP_SCHEMA audit
 * entry in the same transaction. Refuses the system schema (fail-closed, before
 * any DB work). Presentation code must still gate on a typed-phrase +
 * press-and-hold confirmation; this is the committing primitive underneath.
 */
export async function executeDropSchema(
  schema: string,
  opts: { onProgress?: OnProgress } = {},
): Promise<{ droppedSchema: string }> {
  if (isSystemSchema(schema)) {
    throw new Error(`Refusing to drop the system schema "${schema}".`);
  }
  const actor = await currentActor();
  opts.onProgress?.({ type: "total", total: 1 });
  await ensureAuditTable();
  return withTransaction(null, async (tx) => {
    opts.onProgress?.({ type: "step", label: `Dropping schema ${schema}…`, done: 0 });
    await tx.unsafe(`DROP SCHEMA ${ident(schema)} CASCADE`);
    await writeAudit(tx, {
      actor,
      schemaName: schema,
      tableName: null,
      operation: "DROP_SCHEMA",
      pk: null,
      oldValues: null,
      newValues: null,
      statement: `DROP SCHEMA ${ident(schema)} CASCADE`,
    });
    opts.onProgress?.({ type: "step", label: `Dropped schema ${schema}`, done: 1 });
    return { droppedSchema: schema };
  });
}
