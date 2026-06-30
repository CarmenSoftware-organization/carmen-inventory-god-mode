import { SqlConsole } from "@/components/sql-console";
import { SchemaBanner } from "@/components/schema-banner";

export const dynamic = "force-dynamic";

export default async function SqlPage({ params }: { params: Promise<{ schema: string }> }) {
  const { schema } = await params;
  return (
    <div className="space-y-4">
      <SchemaBanner schema={schema} />
      <div className="space-y-1">
        <h1 className="text-base font-semibold tracking-tight">
          SQL console: <span className="font-mono">{schema}</span>
        </h1>
        <p className="max-w-2xl text-sm text-foreground-muted">
          Reads run immediately. Writes run in a transaction, show affected rows, and require an
          explicit Commit. Every executed statement is audited.
        </p>
      </div>
      <SqlConsole schema={schema} />
    </div>
  );
}
