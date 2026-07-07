export type OpGroup = "prisma" | "tenant" | "seed" | "danger";

export type CatalogOp = {
  id: string;
  group: OpGroup;
  label: string;
  kind: "script" | "bin";
  run: string;
  baseArgs?: string[];
  acceptsBu?: boolean;
  acceptsOnly?: boolean;
  writes: boolean;
  destructive: boolean;
  requiresPsql?: boolean;
  readonly?: boolean;
};

const seed = (id: string, run: string, label: string): CatalogOp => ({
  id, group: "seed", label, kind: "script", run, writes: true, destructive: false,
});

export const CATALOG: CatalogOp[] = [
  { id: "prisma-status", group: "prisma", label: "Prisma: migration status (read-only)",
    kind: "bin", run: "prisma migrate status", baseArgs: ["x", "prisma", "migrate", "status"],
    writes: false, destructive: false, readonly: true },
  { id: "prisma-deploy", group: "prisma", label: "Prisma: apply pending migrations (deploy)",
    kind: "script", run: "db:deploy", writes: true, destructive: false },

  { id: "tenant-apply", group: "tenant", label: "Tenant views: apply",
    kind: "script", run: "db:tenant-views:apply", acceptsBu: true, acceptsOnly: true,
    writes: true, destructive: false, requiresPsql: true },
  { id: "tenant-revert", group: "tenant", label: "Tenant views: revert (down)",
    kind: "script", run: "db:tenant-views:revert", acceptsBu: true, acceptsOnly: true,
    writes: true, destructive: true, requiresPsql: true },

  seed("seed", "db:seed", "Seed: baseline"),
  seed("seed-permission", "db:seed.permission", "Seed: permission catalog"),
  seed("seed-platform-permission", "db:seed.platform-permission", "Seed: platform permissions"),
  seed("seed-application", "db:seed.application", "Seed: applications"),
  seed("seed-role-permission", "db:seed.role-permission", "Seed: role permissions"),
  seed("seed-platform-role-permission", "db:seed.platform-role-permission", "Seed: platform role permissions"),
  seed("seed-platform-super-admin", "db:seed.platform-super-admin", "Seed: platform super admin"),
  seed("seed-report-template", "db:seed.report-template", "Seed: report templates"),

  { id: "migrate-reset", group: "danger", label: "DANGER: prisma migrate reset (drops & recreates)",
    kind: "script", run: "db:migrate:reset", writes: true, destructive: true },
  { id: "seed-reset", group: "danger", label: "DANGER: seed reset (migrate reset + seed)",
    kind: "script", run: "db:seed:reset", writes: true, destructive: true },
  { id: "mock-reset", group: "danger", label: "DANGER: mock reset (reset + seed + mock)",
    kind: "script", run: "db:mock:reset", writes: true, destructive: true },
];

for (const op of CATALOG) {
  if (op.destructive && !op.writes) throw new Error(`Invalid catalog op ${op.id}: destructive must imply writes`);
  if (op.readonly && op.writes) throw new Error(`Invalid catalog op ${op.id}: readonly must not also write`);
}

export function findOp(id: string): CatalogOp | undefined {
  return CATALOG.find((o) => o.id === id);
}

export type ScriptInfo = {
  script: string;
  file: string | null;
  missing: boolean;
};

export function extractTsFile(command: string): string | null {
  const matches = command.match(/\S+\.ts\b/g);
  if (!matches) return null;
  const bases = [...new Set(matches.map((m) => m.split("/").pop()!))];
  return bases.length === 1 ? bases[0] : null;
}

export function resolveScriptInfo(
  op: CatalogOp,
  scripts: Record<string, string> | null,
): ScriptInfo {
  if (op.kind === "bin") return { script: op.run, file: null, missing: false };
  if (!scripts) return { script: op.run, file: null, missing: false };
  const command = scripts[op.run];
  if (command === undefined) return { script: op.run, file: null, missing: true };
  return { script: op.run, file: extractTsFile(command), missing: false };
}

const BU_RE = /^[A-Za-z0-9_-]+$/;
const PREFIX_RE = /^[A-Za-z0-9_.-]+$/;

export function validateBuCode(code: string, activeCodes: string[]): boolean {
  return BU_RE.test(code) && activeCodes.includes(code);
}

export function validateOnlyPrefix(prefix: string, fileNames: string[]): boolean {
  return PREFIX_RE.test(prefix) && fileNames.some((f) => f.startsWith(prefix));
}

export function buildArgv(op: CatalogOp, args: { bu?: string; only?: string }): string[] {
  if (op.kind === "bin") return [...(op.baseArgs ?? [])];
  const extra: string[] = [];
  if (op.acceptsBu && args.bu) extra.push("--bu", args.bu);
  if (op.acceptsOnly && args.only) extra.push("--only", args.only);
  return ["run", op.run, ...(extra.length ? ["--", ...extra] : [])];
}

export function validateSchemaName(name: string, existing: string[]): "known" | "new" | "invalid" {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return "invalid";
  return existing.includes(name) ? "known" : "new";
}

export function canRun(
  op: CatalogOp,
  opts: { confirm: string; schema: string; knownSchemas: string[]; destroyChecked: boolean; createChecked: boolean },
): boolean {
  if (validateSchemaName(opts.schema, opts.knownSchemas) === "invalid") return false;
  if (op.readonly || !op.writes) return true;
  if (opts.confirm !== opts.schema) return false;
  if (op.destructive && !opts.destroyChecked) return false;
  if (validateSchemaName(opts.schema, opts.knownSchemas) === "new" && !opts.createChecked) return false;
  return true;
}
