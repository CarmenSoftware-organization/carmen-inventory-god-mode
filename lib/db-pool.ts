import { getSql } from "@/lib/db";
import { env } from "@/lib/env";
import { qualified } from "@/lib/sql-guard";

/**
 * god-mode holds a single connection (DATABASE_URL) but the platform registry can
 * assign each business unit its own database pool. Resolving a tenant schema by name
 * alone would let a destructive op land on a same-named schema of the wrong host, so
 * every drop is checked against the pool the registry actually points at.
 */
export type ConnectionIdentity = { host: string; port: number; database: string };

export type BusinessUnitPool = {
  id: string;
  code: string;
  dbSchema: string | null;
  /** null when the business unit has no database_pool_id, or the pool row is gone. */
  pool: ConnectionIdentity | null;
};

export function parseConnectionIdentity(url: string): ConnectionIdentity {
  const u = new URL(url);
  return {
    host: u.hostname.toLowerCase(),
    port: u.port ? Number(u.port) : 5432,
    database: u.pathname.replace(/^\//, ""),
  };
}

export function poolMatches(pool: ConnectionIdentity | null, target: ConnectionIdentity): boolean {
  if (!pool) return false;
  return pool.host.toLowerCase() === target.host.toLowerCase()
    && pool.port === target.port
    && pool.database === target.database;
}

export function describeIdentity(id: ConnectionIdentity): string {
  return `${id.host}:${id.port}/${id.database}`;
}

/**
 * Returns null when every business unit that owns a tenant schema sits on `target`,
 * or an operator-facing message naming the ones that do not. Hostnames are compared
 * literally — an alias that resolves to the same server still reads as a mismatch,
 * which errs toward refusing a drop rather than guessing two names are one host.
 */
export function poolGuardError(rows: BusinessUnitPool[], target: ConnectionIdentity): string | null {
  const offenders = rows.filter((r) => r.dbSchema && !poolMatches(r.pool, target));
  if (offenders.length === 0) return null;
  const detail = offenders
    .map((r) => `${r.code} (${r.dbSchema}) → ${r.pool ? describeIdentity(r.pool) : "no database pool assigned"}`)
    .join("; ");
  return `Refusing to drop tenant schemas: ${detail}. This god-mode instance is connected to `
    + `${describeIdentity(target)}, so the drop would target the wrong database.`;
}

type PoolRow = {
  id: string; code: string; db_schema: string | null;
  host: string | null; port: number | null; database: string | null;
};

function toBusinessUnitPools(rows: PoolRow[]): BusinessUnitPool[] {
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    dbSchema: r.db_schema ?? null,
    pool: r.host && r.port !== null && r.database
      ? { host: r.host, port: r.port, database: r.database }
      : null,
  }));
}

/**
 * Reads the pool behind each business unit. Returns null when the registry predates the
 * pool split (no tb_database_pool table) — such a database cannot host more than one
 * pool, so there is nothing to guard against and callers should proceed.
 */
async function loadPools(where: string, params: (string | number | boolean | null)[]): Promise<BusinessUnitPool[] | null> {
  const bu = qualified(env().systemSchemaName, "tb_business_unit");
  const pool = qualified(env().systemSchemaName, "tb_database_pool");
  try {
    const rows = (await getSql().unsafe(
      `SELECT bu.id::text, bu.code, bu.db_schema, p.host, p.port, p.database
       FROM ${bu} bu LEFT JOIN ${pool} p ON p.id = bu.database_pool_id
       ${where} ORDER BY bu.code`,
      params,
    )) as unknown as PoolRow[];
    return toBusinessUnitPools(rows);
  } catch (err: unknown) {
    // Only a missing tb_database_pool means "this registry predates pools". A missing
    // column is drift the guard cannot read past, and a guard that cannot read its
    // inputs must not wave the drop through.
    if ((err as { code?: string })?.code === "42P01") return null;
    throw err;
  }
}

export async function loadPoolsForBusinessUnits(ids: string[]): Promise<BusinessUnitPool[] | null> {
  if (ids.length === 0) return [];
  return loadPools(`WHERE bu.id = ANY($1::uuid[])`, [`{${ids.join(",")}}`]);
}

export async function loadPoolsForCluster(clusterId: string): Promise<BusinessUnitPool[] | null> {
  return loadPools(`WHERE bu.cluster_id = $1::uuid`, [clusterId]);
}

export async function loadAllPools(): Promise<BusinessUnitPool[] | null> {
  return loadPools("", []);
}

/** Convenience for call sites that only need "is this drop safe?" against the live connection. */
export function tenantDropBlockReason(rows: BusinessUnitPool[] | null): string | null {
  if (rows === null) return null;
  return poolGuardError(rows, parseConnectionIdentity(env().databaseUrl));
}
