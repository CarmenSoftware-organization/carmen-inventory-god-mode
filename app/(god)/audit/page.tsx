import { Filter } from "lucide-react";
import { listAudit, type Operation } from "@/lib/audit";
import { Table, THead, TBody, TR, Th, Td } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";
const OPS: Operation[] = ["INSERT", "UPDATE", "DELETE", "CASCADE_DELETE", "CREATE_SCHEMA", "DROP_SCHEMA", "RAW_SQL"];

// Irreversible operations carry the seal mark in the record.
const SEALED: ReadonlySet<Operation> = new Set(["DELETE", "CASCADE_DELETE", "DROP_SCHEMA"]);

// Map operation types to badge variants (status never by color alone: text carries it).
function opVariant(op: Operation) {
  switch (op) {
    case "DELETE":
    case "CASCADE_DELETE":
    case "DROP_SCHEMA":
      return "danger" as const;
    case "INSERT":
    case "CREATE_SCHEMA":
      return "success" as const;
    case "UPDATE":
    case "RAW_SQL":
    default:
      return "neutral" as const;
  }
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ schema?: string; table?: string; operation?: string }> }) {
  const sp = await searchParams;
  const entries = await listAudit({
    schema: sp.schema,
    table: sp.table,
    operation: sp.operation as Operation | undefined,
    limit: 200,
  });

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">Audit</p>
        <h1 className="text-2xl font-medium tracking-tight">Audit log</h1>
      </div>

      {/* Filter form */}
      <form className="flex flex-wrap items-center gap-2">
        <Input
          name="schema"
          defaultValue={sp.schema ?? ""}
          placeholder="schema"
          className="max-w-[160px]"
        />
        <Input
          name="table"
          defaultValue={sp.table ?? ""}
          placeholder="table"
          className="max-w-[160px]"
        />
        <select
          name="operation"
          defaultValue={sp.operation ?? ""}
          className="h-9 rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground hover:border-border-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <option value="">any op</option>
          {OPS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <Button type="submit" variant="primary" size="md">
          <Filter className="h-3.5 w-3.5" aria-hidden="true" />
          Filter
        </Button>
      </form>

      {/* Entries */}
      <Table>
        <THead>
          <TR>
            <Th className="text-right">#</Th>
            <Th>At</Th>
            <Th>Actor</Th>
            <Th>Target</Th>
            <Th>Op</Th>
            <Th>PK</Th>
            <Th>Changes</Th>
          </TR>
        </THead>
        <TBody>
          {entries.length === 0 ? (
            <tr>
              <td colSpan={7}>
                <EmptyState
                  icon="search"
                  title="No audit entries"
                  hint="No entries match the current filters."
                />
              </td>
            </tr>
          ) : (
            entries.map((e, i) => (
              <TR key={e.id} className="align-top">
                <Td className="text-right font-mono text-xs tabular-nums text-foreground-subtle">
                  {String(entries.length - i).padStart(3, "0")}
                </Td>
                <Td className="whitespace-nowrap font-mono text-xs text-foreground-muted">
                  {e.at}
                </Td>
                <Td className="text-xs">{e.actor}</Td>
                <Td className="font-mono text-xs">
                  {e.schemaName}
                  {e.tableName ? `.${e.tableName}` : ""}
                </Td>
                <Td>
                  <span className="inline-flex items-center gap-1.5">
                    {SEALED.has(e.operation) && (
                      <span
                        role="img"
                        aria-label="sealed"
                        title="Sealed — irreversible"
                        className="inline-flex h-4 w-4 items-center justify-center rounded-full border-[1.5px] border-seal text-[9px] leading-none text-seal"
                      >
                        ●
                      </span>
                    )}
                    <Badge variant={opVariant(e.operation)}>{e.operation}</Badge>
                  </span>
                </Td>
                <Td className="font-mono text-xs text-foreground-muted">
                  {e.pk ? JSON.stringify(e.pk) : ""}
                </Td>
                <Td className="max-w-md">
                  <details className="group">
                    <summary className="cursor-pointer text-xs font-medium text-link hover:text-link-hover">
                      view
                    </summary>
                    <pre className="mt-1 whitespace-pre-wrap rounded-md bg-surface-muted p-2 font-mono text-xs">
                      old: {JSON.stringify(e.oldValues, null, 2)}
                      {"\n"}new: {JSON.stringify(e.newValues, null, 2)}
                      {e.statement ? `\nsql: ${e.statement}` : ""}
                    </pre>
                  </details>
                </Td>
              </TR>
            ))
          )}
        </TBody>
      </Table>
    </div>
  );
}
