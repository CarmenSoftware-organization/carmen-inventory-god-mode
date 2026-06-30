import { env } from "@/lib/env";
import { listClusters } from "@/lib/registry";
import { ClustersTable } from "@/components/clusters-table";
import { softDeleteClusters, restoreClusters } from "@/server/cluster-actions";

export const dynamic = "force-dynamic";

export default async function ClustersPage() {
  const clusters = await listClusters();
  return (
    <div className="space-y-4">
      <h1 className="text-base font-semibold tracking-tight">Clusters</h1>
      <ClustersTable
        clusters={clusters}
        system={env().systemSchemaName}
        softDeleteAction={softDeleteClusters}
        restoreAction={restoreClusters}
      />
    </div>
  );
}
