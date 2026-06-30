import { env } from "@/lib/env";
import { describeTable } from "@/lib/introspect";
import { RowForm } from "@/components/row-form";
import { submitClusterInsert } from "@/server/cluster-actions";

export const dynamic = "force-dynamic";

export default async function NewClusterPage() {
  const schema = env().systemSchemaName;
  const shape = await describeTable(schema, "tb_cluster");
  // Hide soft-delete bookkeeping and auto-generated PKs from the form.
  const editable = shape.columns.filter((c) => c.name !== "deleted_at" && !(c.isPrimaryKey && c.default));
  return (
    <div className="space-y-4">
      <h1 className="text-base font-semibold tracking-tight">Add cluster</h1>
      <RowForm columns={editable} action={submitClusterInsert} submitLabel="Create cluster" />
    </div>
  );
}
