// components/confirm-delete.tsx
"use client";
import { useState } from "react";
import type { BlastRadius } from "@/lib/cascade";
import { useOperationStream } from "@/components/use-operation-stream";
import { OperationProgress } from "@/components/operation-progress";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, THead, TBody, TR, Th, Td } from "@/components/ui/table";

export function ConfirmDelete({
  schema,
  table,
  pkJson,
  radius,
  isBusinessUnit,
  tenantSchema,
  orphanSchemas,
  requiredPhrase,
}: {
  schema: string;
  table: string;
  pkJson: string;
  radius: BlastRadius;
  isBusinessUnit: boolean;
  tenantSchema: string | null;
  orphanSchemas?: string[];
  requiredPhrase: string;
}) {
  const { state, start } = useOperationStream();
  const [confirm, setConfirm] = useState("");
  const [dropSchema, setDropSchema] = useState(false);

  const parsed = JSON.parse(pkJson);
  const pks: Record<string, unknown>[] = Array.isArray(parsed) ? parsed : [parsed];
  const running = state.phase === "running";

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    start("/api/ops/cascade-delete", {
      schema,
      table,
      pks,
      dropSchema,
      confirm,
    });
  }

  return (
    <form onSubmit={onSubmit} className="max-w-2xl">
      <div className="overflow-hidden rounded-lg border border-danger-border bg-surface">
        {/* Hazard tape — the signature frame for an irreversible action. */}
        <span aria-hidden="true" className="hazard-tape block h-2" />
        <div className="flex items-center gap-2 border-b border-danger-border bg-danger-subtle px-4 py-2.5">
          <span className="eyebrow text-danger">Armed</span>
          <span aria-hidden="true" className="text-danger-border">
            /
          </span>
          <span className="eyebrow text-danger-subtle-foreground">Irreversible</span>
        </div>

        <div className="space-y-4 p-4">
      {/* Blast radius warning */}
      <Alert variant="danger" title={`Permanently deletes ${radius.rows.length} row(s) across ${radius.byTable.length} table(s). Max depth ${radius.maxDepth}.`}>
        {radius.truncated && (
          <p>
            Blast radius hit the configured cap. Execution will be refused until you
            narrow it or raise the caps.
          </p>
        )}
      </Alert>

      {/* Blast radius summary table */}
      <Table>
        <THead>
          <TR>
            <Th>Table</Th>
            <Th className="text-right">Rows</Th>
          </TR>
        </THead>
        <TBody>
          {radius.byTable.map((b) => (
            <TR key={`${b.schema}.${b.table}`}>
              <Td className="font-mono text-xs">
                {b.schema}.{b.table}
              </Td>
              <Td className="text-right tabular-nums">{b.count}</Td>
            </TR>
          ))}
        </TBody>
      </Table>

      {/* Business unit schema drop */}
      {isBusinessUnit && tenantSchema && (
        <label className="flex items-center gap-3 rounded-md border border-warning-border bg-warning-subtle p-3 text-sm text-warning-subtle-foreground">
          <Checkbox
            checked={dropSchema}
            onChange={(e) => setDropSchema(e.target.checked)}
          />
          <span>
            Also <strong>DROP SCHEMA &quot;{tenantSchema}&quot; CASCADE</strong> (wipes the
            entire tenant database for this business unit)
          </span>
        </label>
      )}

      {/* Orphan schema drop */}
      {orphanSchemas && orphanSchemas.length > 0 && (
        <div className="space-y-2">
          <label className="flex items-start gap-3 rounded-md border border-warning-border bg-warning-subtle p-3 text-sm text-warning-subtle-foreground">
            <Checkbox
              checked={dropSchema}
              onChange={(e) => setDropSchema(e.target.checked)}
            />
            <span>
              Also <strong>DROP {orphanSchemas.length} tenant schema(s) CASCADE</strong>:{" "}
              <code className="rounded bg-black/10 px-1 font-mono text-xs">
                {orphanSchemas.join(", ")}
              </code>{" "}
              (wipes each tenant database)
            </span>
          </label>
          <p className="text-xs text-foreground-subtle">
            The confirmation phrase below stays DELETE.
          </p>
        </div>
      )}

      {/* Confirm phrase input */}
      <div className="space-y-1.5">
        <label htmlFor="confirm-input" className="block text-sm font-medium">
          Type{" "}
          <code className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-xs">
            {requiredPhrase}
          </code>{" "}
          to confirm:
        </label>
        <Input
          id="confirm-input"
          name="confirm"
          autoComplete="off"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {isBusinessUnit && tenantSchema && (
          <p className="text-xs text-foreground-subtle">
            If you check the schema-drop box, the required phrase becomes the schema name.
          </p>
        )}
      </div>

      <Button
        type="submit"
        variant="danger"
        size="lg"
        disabled={radius.truncated || running}
        pending={running}
        className="w-full font-display uppercase tracking-[0.12em]"
      >
        {running ? "Deleting..." : "Permanently delete"}
      </Button>

      <OperationProgress state={state} rolledBackOnError />
        </div>
      </div>
    </form>
  );
}
