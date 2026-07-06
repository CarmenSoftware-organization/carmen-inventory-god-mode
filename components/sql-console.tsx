"use client";
import { useState } from "react";
import { Play, CheckCircle2 } from "lucide-react";
import CodeMirror from "@uiw/react-codemirror";
import { sql as sqlLang } from "@codemirror/lang-sql";
import { runSql, applySql } from "@/server/sql";
import type { SqlResult } from "@/lib/sql-runner";
import { OperationProgress } from "@/components/operation-progress";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Table, THead, TBody, TR, Th, Td } from "@/components/ui/table";

export function SqlConsole({ schema }: { schema: string }) {
  const [text, setText] = useState("SELECT 1");
  const [result, setResult] = useState<SqlResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: (s: string, q: string) => Promise<SqlResult>) {
    setBusy(true);
    setError(null);
    try {
      setResult(await fn(schema, text));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  const isWritePreview = result?.kind === "write-preview";
  const affected = result && "affected" in result ? result.affected : 0;

  return (
    <div className="space-y-4">
      {/* Editor */}
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <CodeMirror
          value={text}
          height="200px"
          extensions={[sqlLang()]}
          onChange={setText}
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Button
          disabled={busy}
          onClick={() => run(runSql)}
          variant="primary"
          size="sm"
        >
          <Play className="h-3.5 w-3.5" aria-hidden="true" />
          Run
        </Button>
        {isWritePreview && (
          <Button
            disabled={busy}
            onClick={() => run(applySql)}
            variant="danger"
            size="sm"
          >
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            Commit ({affected} rows)
          </Button>
        )}
      </div>

      {/* Loading */}
      {busy && (
        <OperationProgress
          state={{ phase: "running", done: 0, label: "Running..." }}
        />
      )}

      {/* Error */}
      {error && (
        <Alert variant="danger" title="SQL error">
          <pre className="whitespace-pre-wrap text-xs">{error}</pre>
        </Alert>
      )}

      {/* Read results */}
      {result?.kind === "read" && (
        <div className="space-y-2">
          <p className="text-xs text-foreground-subtle">{result.rowCount} rows</p>
          <Table>
            <THead>
              <TR>
                {result.columns.map((c) => (
                  <Th key={c} className="font-mono">
                    {c}
                  </Th>
                ))}
              </TR>
            </THead>
            <TBody>
              {result.rows.map((r, i) => (
                <TR key={i}>
                  {result.columns.map((c) => (
                    <Td key={c} className="font-mono text-xs">
                      {fmt(r[c])}
                    </Td>
                  ))}
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}

      {/* Write preview */}
      {isWritePreview && (
        <Alert
          variant="warning"
          title={`Preview only: ${affected} row(s) would change.`}
        >
          Nothing committed yet. Press Commit to apply.
        </Alert>
      )}

      {/* Write applied */}
      {result?.kind === "write-applied" && (
        <Alert
          variant="success"
          title={`Applied: ${affected} row(s) changed and audited.`}
        />
      )}
    </div>
  );
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "\u2205";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
