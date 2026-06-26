import { notFound } from "next/navigation";
import { env } from "@/lib/env";
import { describeTable } from "@/lib/introspect";
import { getSql } from "@/lib/db";
import { qualified } from "@/lib/sql-guard";
import { whereFromPk } from "@/lib/write";
import { RowForm } from "@/components/row-form";
import { submitClusterUpdate } from "@/server/cluster-actions";

export const dynamic = "force-dynamic";

export default async function EditClusterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const schema = env().systemSchemaName;
  const pk = { id };
  const shape = await describeTable(schema, "tb_cluster");
  const editable = shape.columns.filter((c) => c.name !== "deleted_at" && !(c.isPrimaryKey && c.default));
  const { clause, args } = whereFromPk(pk, 1);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await getSql().unsafe(`SELECT * FROM ${qualified(schema, "tb_cluster")} WHERE ${clause} LIMIT 1`, args as any[]);
  if (!rows[0]) notFound();
  const action = submitClusterUpdate.bind(null, JSON.stringify(pk));
  return (
    <div>
      <h1 className="my-3 text-lg font-semibold">Edit cluster</h1>
      <RowForm columns={editable} initial={rows[0] as Record<string, unknown>} action={action} submitLabel="Save changes" />
    </div>
  );
}
