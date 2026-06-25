"use client";
import { useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { sql as sqlLang } from "@codemirror/lang-sql";
import { runSql, applySql } from "@/server/sql";
import type { SqlResult } from "@/lib/sql-runner";

export function SqlConsole({ schema }: { schema: string }) {
  const [text, setText] = useState("SELECT 1");
  const [result, setResult] = useState<SqlResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: (s: string, q: string) => Promise<SqlResult>) {
    setBusy(true); setError(null);
    try { setResult(await fn(schema, text)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setResult(null); }
    finally { setBusy(false); }
  }

  const isWritePreview = result?.kind === "write-preview";
  return (
    <div className="space-y-3">
      <CodeMirror value={text} height="200px" extensions={[sqlLang()]} onChange={setText} />
      <div className="flex gap-2">
        <button disabled={busy} onClick={() => run(runSql)} className="rounded bg-black px-3 py-1.5 text-white">Run</button>
        {isWritePreview && (
          <button disabled={busy} onClick={() => run(applySql)} className="rounded bg-red-600 px-3 py-1.5 text-white">
            Commit ({(result as any).affected} rows)
          </button>
        )}
      </div>
      {error && <pre className="whitespace-pre-wrap rounded bg-red-50 p-3 text-sm text-red-800">{error}</pre>}
      {result?.kind === "read" && (
        <div className="overflow-x-auto">
          <p className="text-sm text-gray-500">{result.rowCount} rows</p>
          <table className="min-w-full text-sm"><thead><tr className="border-b text-left">
            {result.columns.map((c) => <th key={c} className="px-2 py-1 font-mono">{c}</th>)}
          </tr></thead><tbody>
            {result.rows.map((r, i) => <tr key={i} className="border-b">{result.columns.map((c) => <td key={c} className="max-w-xs truncate px-2 py-1">{fmt(r[c])}</td>)}</tr>)}
          </tbody></table>
        </div>
      )}
      {isWritePreview && <p className="rounded bg-amber-100 p-2 text-sm">Preview only — {(result as any).affected} row(s) would change. Nothing committed yet. Press Commit to apply.</p>}
      {result?.kind === "write-applied" && <p className="rounded bg-green-100 p-2 text-sm">Applied — {(result as any).affected} row(s) changed and audited.</p>}
    </div>
  );
}
function fmt(v: unknown): string { return v === null || v === undefined ? "∅" : typeof v === "object" ? JSON.stringify(v) : String(v); }
