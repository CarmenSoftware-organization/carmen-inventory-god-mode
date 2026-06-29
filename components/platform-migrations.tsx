"use client";
import { useMemo, useState } from "react";
import { useOperationStream } from "@/components/use-operation-stream";
import { OperationProgress } from "@/components/operation-progress";
import { OperationLog } from "@/components/operation-log";
import { canRun, validateSchemaName, type CatalogOp, type OpGroup } from "@/lib/platform-migrations";

export type TargetDb = { masked: string; database: string; schema: string };

const GROUPS: { key: OpGroup; title: string }[] = [
  { key: "prisma", title: "Prisma schema migrations" },
  { key: "tenant", title: "Tenant view migrations (all active BU schemas)" },
  { key: "seed", title: "Seed scripts" },
  { key: "danger", title: "Danger zone — destructive resets" },
];

export function PlatformMigrations({ target, catalog, buCodes, tenantFiles, schemas, defaultSchema }: {
  target: TargetDb; catalog: CatalogOp[]; buCodes: string[]; tenantFiles: string[];
  schemas: string[]; defaultSchema: string;
}) {
  const { state, start } = useOperationStream();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [schema, setSchema] = useState(defaultSchema);
  const [bu, setBu] = useState("");
  const [only, setOnly] = useState("");
  const [confirm, setConfirm] = useState("");
  const [destroyChecked, setDestroyChecked] = useState(false);
  const [createChecked, setCreateChecked] = useState(false);

  const op = useMemo(() => catalog.find((o) => o.id === selectedId) ?? null, [catalog, selectedId]);
  const schemaStatus = validateSchemaName(schema, schemas);
  const isNewSchema = schemaStatus === "new";
  const running = state.phase === "running";
  const enabled = !!op && !running &&
    canRun(op, { confirm, schema, knownSchemas: schemas, destroyChecked, createChecked });

  const run = () => {
    if (!op) return;
    start("/api/ops/platform-migrate", {
      opId: op.id,
      schema,
      bu: op.acceptsBu && bu ? bu : undefined,
      only: op.acceptsOnly && only ? only : undefined,
      confirm,
      confirmDestroy: op.destructive ? destroyChecked : undefined,
      confirmCreateSchema: isNewSchema ? createChecked : undefined,
    });
  };

  const select = (id: string) => {
    setSelectedId(id); setBu(""); setOnly(""); setConfirm(""); setDestroyChecked(false); setCreateChecked(false);
  };

  const writeOp = !!op && op.writes && !op.readonly;

  return (
    <div className="space-y-4">
      <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
        <span className="font-semibold">Target:</span> <code>{target.masked}</code>{" "}
        <span className="text-gray-600">(schema <code>{schema || "—"}</code>{isNewSchema ? ", NEW" : ""})</span>
      </div>

      <label className="block text-sm">
        Target schema
        <input
          list="schemas" aria-label="schema" className="ml-2 rounded border px-2 py-1"
          value={schema} placeholder="e.g. CARMEN_SYSTEM"
          onChange={(e) => { setSchema(e.target.value); setCreateChecked(false); }}
        />
        <datalist id="schemas">
          {schemas.map((s) => <option key={s} value={s} />)}
        </datalist>
        {schemaStatus === "invalid" && schema.length > 0 && (
          <span className="ml-2 text-red-700">invalid schema name</span>
        )}
      </label>

      {GROUPS.map((g) => {
        const ops = catalog.filter((o) => o.group === g.key);
        if (!ops.length) return null;
        const danger = g.key === "danger";
        return (
          <fieldset key={g.key} className={`rounded border p-3 ${danger ? "border-red-400 bg-red-50" : ""}`}>
            <legend className={`px-1 text-sm font-semibold ${danger ? "text-red-700" : ""}`}>{g.title}</legend>
            <div className="space-y-1">
              {ops.map((o) => (
                <label key={o.id} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="op" checked={selectedId === o.id} onChange={() => select(o.id)} />
                  <span>{o.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        );
      })}

      {op?.acceptsBu && (
        <label className="block text-sm">
          Business unit (optional)
          <select className="ml-2 rounded border px-2 py-1" value={bu} onChange={(e) => setBu(e.target.value)}>
            <option value="">all active</option>
            {buCodes.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      )}

      {op?.acceptsOnly && (
        <label className="block text-sm">
          Only file prefix (optional)
          <input
            list="tenant-files" className="ml-2 rounded border px-2 py-1"
            value={only} onChange={(e) => setOnly(e.target.value)} placeholder="e.g. 001_v_operational"
          />
          <datalist id="tenant-files">
            {tenantFiles.map((f) => <option key={f} value={f.replace(/\.up\.sql$/, "")} />)}
          </datalist>
        </label>
      )}

      {writeOp && (
        <label className="block text-sm">
          Type the schema name <code>{schema}</code> to confirm
          <input
            aria-label="confirm" className="ml-2 rounded border px-2 py-1"
            value={confirm} onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
      )}

      {writeOp && isNewSchema && (
        <label className="flex items-center gap-2 text-sm text-amber-800">
          <input type="checkbox" checked={createChecked} onChange={(e) => setCreateChecked(e.target.checked)} />
          Create new schema <code>{schema}</code>
        </label>
      )}

      {op?.destructive && (
        <label className="flex items-center gap-2 text-sm text-red-700">
          <input type="checkbox" checked={destroyChecked} onChange={(e) => setDestroyChecked(e.target.checked)} />
          I understand this destroys data
        </label>
      )}

      <button
        onClick={run} disabled={!enabled}
        className="rounded bg-black px-4 py-2 font-semibold text-white disabled:opacity-50"
      >
        {running ? "Running…" : "Run"}
      </button>

      <OperationProgress state={state} />
      <OperationLog state={state} />
    </div>
  );
}
