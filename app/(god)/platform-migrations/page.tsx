import { PlatformMigrations } from "@/components/platform-migrations";
import { CATALOG } from "@/lib/platform-migrations";
import { listBusinessUnits } from "@/lib/registry";
import { listSchemaNames } from "@/lib/introspect";
import { listTenantFiles, targetDbInfo } from "@/lib/platform-package";

export const dynamic = "force-dynamic";

export default async function PlatformMigrationsPage() {
  const [bus, tenantFiles, schemas] = await Promise.all([
    listBusinessUnits(), listTenantFiles(), listSchemaNames(),
  ]);
  const buCodes = bus.filter((b) => b.isActive).map((b) => b.code);
  const target = targetDbInfo();
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-base font-semibold tracking-tight">Platform migrations</h1>
        <p className="max-w-2xl text-sm text-foreground-muted">
          Runs migration scripts of <code className="font-mono">@repo/prisma-shared-schema-platform</code>{" "}
          against the database this instance manages, by spawning the package&apos;s own commands. Pick
          the target schema below. Output streams live.
        </p>
      </div>
      <PlatformMigrations
        target={target} catalog={CATALOG} buCodes={buCodes} tenantFiles={tenantFiles}
        schemas={schemas} defaultSchema={target.schema}
      />
    </div>
  );
}
