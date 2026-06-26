import { RunMigrations } from "@/components/run-migrations";

export const dynamic = "force-dynamic";

export default function MigrationsPage() {
  return (
    <div>
      <h1 className="my-3 text-lg font-semibold">Migrations</h1>
      <p className="mb-3 text-sm text-gray-600">
        Applies idempotent schema migrations (god-mode audit table, <code>tb_cluster.deleted_at</code>). Safe to run repeatedly.
      </p>
      <RunMigrations />
    </div>
  );
}
