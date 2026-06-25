import { z } from "zod";

const schema = z.object({
  SYSTEM_DATABASE_URL: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  SYSTEM_SCHEMA_NAME: z.string().min(1).default("CARMEN_SYSTEM"),
  GOD_MODE_PASSWORD: z.string().min(1),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be >= 32 chars"),
  CASCADE_MAX_ROWS: z.coerce.number().int().positive().default(5000),
  CASCADE_MAX_DEPTH: z.coerce.number().int().positive().default(20),
});

export type Env = {
  systemDatabaseUrl: string;
  databaseUrl: string;
  systemSchemaName: string;
  godModePassword: string;
  sessionSecret: string;
  cascadeMaxRows: number;
  cascadeMaxDepth: number;
};

export function loadEnv(raw: Record<string, string | undefined>): Env {
  const p = schema.parse(raw);
  return {
    systemDatabaseUrl: p.SYSTEM_DATABASE_URL,
    databaseUrl: p.DATABASE_URL,
    systemSchemaName: p.SYSTEM_SCHEMA_NAME,
    godModePassword: p.GOD_MODE_PASSWORD,
    sessionSecret: p.SESSION_SECRET,
    cascadeMaxRows: p.CASCADE_MAX_ROWS,
    cascadeMaxDepth: p.CASCADE_MAX_DEPTH,
  };
}

let cached: Env | null = null;
export function env(): Env {
  if (!cached) cached = loadEnv(process.env);
  return cached;
}
