import { env } from "@/lib/env";
import { requireAuth } from "@/lib/session";
import { streamOperation } from "@/lib/progress";
import { withTransaction } from "@/lib/db";
import { ensureAuditTable, writeAudit } from "@/lib/audit";
import { listBusinessUnits } from "@/lib/registry";
import { runProcess } from "@/lib/run-process";
import {
  findOp, validateBuCode, validateOnlyPrefix, buildArgv, type CatalogOp,
} from "@/lib/platform-migrations";
import {
  assertPackageDir, assertPsql, buildSubprocessEnv, targetDbInfo, packageDir,
  listTenantFiles,
} from "@/lib/platform-package";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let running = false;

type Body = { opId: string; bu?: string; only?: string; confirm?: string; confirmDestroy?: boolean };

const bad = (error: string, status: number) => Response.json({ error }, { status });

async function auditRun(
  op: CatalogOp,
  args: { bu?: string; only?: string },
  code: number,
  actor: string,
): Promise<void> {
  await ensureAuditTable();
  await withTransaction(null, (tx) =>
    writeAudit(tx, {
      actor,
      schemaName: env().systemSchemaName,
      tableName: null,
      operation: "MIGRATION",
      pk: null,
      oldValues: null,
      newValues: { opId: op.id, bu: args.bu ?? null, only: args.only ?? null, exitCode: code },
      statement: `bun ${buildArgv(op, args).join(" ")}`,
    }),
  );
}

export async function POST(request: Request): Promise<Response> {
  let session: Awaited<ReturnType<typeof requireAuth>>;
  try {
    session = await requireAuth();
  } catch {
    return bad("Unauthorized", 401);
  }

  const { opId, bu, only, confirm, confirmDestroy } = (await request.json()) as Body;
  const op = findOp(opId);
  if (!op) return bad(`Unknown operation: ${opId}`, 404);

  // Validate optional args against allow-lists.
  if (bu) {
    if (!op.acceptsBu) return bad("This operation does not accept --bu", 400);
    const active = (await listBusinessUnits()).filter((b) => b.isActive).map((b) => b.code);
    if (!validateBuCode(bu, active)) return bad(`Unknown or invalid business unit: ${bu}`, 400);
  }
  if (only) {
    if (!op.acceptsOnly) return bad("This operation does not accept --only", 400);
    if (!validateOnlyPrefix(only, await listTenantFiles())) return bad(`No tenant migration matches: ${only}`, 400);
  }

  // Confirmation gates for write operations.
  if (op.writes && !op.readonly) {
    const db = targetDbInfo().database;
    if ((confirm ?? "") !== db) return bad(`Confirmation text must equal "${db}"`, 400);
    if (op.destructive && confirmDestroy !== true) {
      return bad("Destructive operations require confirmDestroy: true", 400);
    }
  }

  // Preflight (clear errors before streaming begins).
  try {
    await assertPackageDir();
    if (op.requiresPsql) await assertPsql();
  } catch (e) {
    return bad(e instanceof Error ? e.message : String(e), 400);
  }

  const args = buildArgv(op, { bu, only });
  const cwd = packageDir();
  const spawnEnv = buildSubprocessEnv();
  const masked = targetDbInfo().masked;
  const actor = session.actor ?? "god";

  if (running) return bad("A platform migration is already running", 409);
  running = true;

  return streamOperation(async (onProgress) => {
    try {
      onProgress({ type: "log", line: `$ bun ${args.join(" ")}  (cwd=${cwd}, target=${masked})`, stream: "out" });
      const { code } = await runProcess({
        command: "bun",
        args,
        cwd,
        env: spawnEnv,
        onLine: (line, stream) => onProgress({ type: "log", line, stream }),
      });
      await auditRun(op, { bu, only }, code, actor);
      if (code !== 0) throw new Error(`${op.label} failed (exit code ${code})`);
      return { summary: `${op.label} completed (exit 0)` };
    } finally {
      running = false;
    }
  });
}
