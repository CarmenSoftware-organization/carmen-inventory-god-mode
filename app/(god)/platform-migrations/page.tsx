import { PlatformMigrations } from "@/components/platform-migrations";
import { CATALOG } from "@/lib/platform-migrations";
import { listBusinessUnits } from "@/lib/registry";
import { listTenantFiles, targetDbInfo } from "@/lib/platform-package";

export const dynamic = "force-dynamic";

export default async function PlatformMigrationsPage() {
  const [bus, tenantFiles] = await Promise.all([listBusinessUnits(), listTenantFiles()]);
  const buCodes = bus.filter((b) => b.isActive).map((b) => b.code);
  const target = targetDbInfo();
  return (
    <div>
      <h1 className="my-3 text-lg font-semibold">Platform migrations</h1>
      <p className="mb-3 text-sm text-gray-600">
        Runs migration scripts of <code>@repo/prisma-shared-schema-platform</code> against the database
        this instance manages, by spawning the package&apos;s own commands. Output streams live below.
      </p>
      <PlatformMigrations target={target} catalog={CATALOG} buCodes={buCodes} tenantFiles={tenantFiles} />
    </div>
  );
}
