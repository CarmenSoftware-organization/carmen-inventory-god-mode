"use client";
import { useState } from "react";
import type { AuditRow } from "@/lib/audit";
import { Sheet } from "@/components/ui/sheet";

/** "view" trigger that opens an audit entry's before/after snapshot in a Sheet. */
export function AuditChanges({ entry }: { entry: AuditRow }) {
  const [open, setOpen] = useState(false);
  const target = entry.schemaName + (entry.tableName ? `.${entry.tableName}` : "");

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-medium text-link hover:text-link-hover"
      >
        view
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Audit change">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          <dt className="text-foreground-muted">At</dt>
          <dd className="font-mono text-foreground-muted">{entry.at}</dd>
          <dt className="text-foreground-muted">Actor</dt>
          <dd>{entry.actor}</dd>
          <dt className="text-foreground-muted">Target</dt>
          <dd className="font-mono">{target}</dd>
          <dt className="text-foreground-muted">Op</dt>
          <dd className="font-mono">{entry.operation}</dd>
          <dt className="text-foreground-muted">PK</dt>
          <dd className="font-mono text-foreground-muted">{entry.pk ? JSON.stringify(entry.pk) : "∅"}</dd>
        </dl>

        <ValueBlock label="old" value={entry.oldValues} />
        <ValueBlock label="new" value={entry.newValues} />
        {entry.statement && (
          <div className="mt-4">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-foreground-muted">sql</p>
            <pre className="whitespace-pre-wrap rounded-md bg-surface-muted p-2 font-mono text-xs">
              {entry.statement}
            </pre>
          </div>
        )}
      </Sheet>
    </>
  );
}

function ValueBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="mt-4">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-foreground-muted">{label}</p>
      <pre className="whitespace-pre-wrap rounded-md bg-surface-muted p-2 font-mono text-xs">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
