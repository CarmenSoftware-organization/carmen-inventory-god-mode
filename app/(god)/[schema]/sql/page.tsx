import { SqlConsole } from "@/components/sql-console";
import { SchemaBanner } from "@/components/schema-banner";

export const dynamic = "force-dynamic";

export default async function SqlPage({ params }: { params: Promise<{ schema: string }> }) {
  const { schema } = await params;
  return (
    <div>
      <SchemaBanner schema={schema} />
      <h1 className="my-3 text-lg font-semibold">SQL console — {schema}</h1>
      <p className="mb-2 text-sm text-gray-600">Reads run immediately. Writes run in a transaction, show affected rows, and require an explicit Commit. Every executed statement is audited.</p>
      <SqlConsole schema={schema} />
    </div>
  );
}
