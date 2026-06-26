# Streaming Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a live determinate progress bar + current-step caption while long-running destructive operations run, via one reusable streaming mechanism wired into cascade delete, cluster hard delete, migrations, and (indeterminate) the SQL console.

**Architecture:** Operation functions take an optional `onProgress(event)` callback and emit `step`/`total` events. Streaming Route Handlers (`app/api/ops/*/route.ts`) run the operation inside a `ReadableStream`, serializing events as NDJSON; the transaction stays open and events travel over HTTP, never the DB. A client hook reads the stream, reassembles NDJSON across chunk boundaries, and drives a shared `<OperationProgress>` component.

**Tech Stack:** Next.js 16 (App Router, Route Handlers, Web Streams API), React 19, `postgres`, vitest (+ embedded-postgres for `.int.test.ts`, jsdom + React Testing Library for `.test.tsx`), bun for scripts.

## Global Constraints

- **Read the relevant guide in `node_modules/next/dist/docs/` before writing Next code** — this Next version has breaking changes (per AGENTS.md). Route Handler streaming: `node_modules/next/dist/docs/01-app/02-guides/streaming.md` ("Streaming in Route Handlers") and `.../01-getting-started/15-route-handlers.md`.
- Run tests with `bun run test` (vitest, `fileParallelism: false`). `.test.tsx` files run under jsdom; `.test.ts` under node (`vitest.config.ts`).
- System schema name comes from `env().systemSchemaName` (default `CARMEN_SYSTEM`) — never hardcode.
- Cascade caps: `env().cascadeMaxRows` / `cascadeMaxDepth`. A truncated blast radius must refuse (existing behavior in `deleteRadius`).
- Confirm-phrase rules (unchanged): single BU + drop schema → phrase is the schema name; everything else → `"DELETE"` (`lib/delete-confirm.ts`).
- **Batch delete never drops tenant schemas** (only single-row delete may). Preserve this.
- The client payload is never trusted: every Route Handler re-runs `requireAuth` + `phraseMatches` server-side.
- `done` is emitted only after the operation promise resolves (post-COMMIT). All `step` events are provisional.
- End commit messages with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Current branch: `feat/cluster-management`.

---

### Task 1: Progress event protocol + `streamOperation`

**Files:**
- Create: `lib/progress.ts`
- Test: `lib/__tests__/progress.test.ts`

**Interfaces:**
- Produces:
  - `type ProgressEvent = {type:"step";label:string;done?:number} | {type:"total";total:number;title?:string} | {type:"done";summary:string;redirect?:string} | {type:"error";message:string}`
  - `type OnProgress = (event: ProgressEvent) => void`
  - `function streamOperation(run: (onProgress: OnProgress) => Promise<{summary: string; redirect?: string}>): Response`

- [ ] **Step 1: Write the failing test**

```ts
// lib/__tests__/progress.test.ts
import { expect, test } from "vitest";
import { streamOperation } from "@/lib/progress";

async function collect(res: Response): Promise<unknown[]> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
  }
  return buf.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
}

test("emits step/total in order then a final done carrying the resolved summary", async () => {
  const res = streamOperation(async (onProgress) => {
    onProgress({ type: "step", label: "Computing…" });
    onProgress({ type: "total", total: 2 });
    onProgress({ type: "step", label: "A", done: 1 });
    return { summary: "ok", redirect: "/x" };
  });
  expect(res.headers.get("Content-Type")).toBe("application/x-ndjson");
  expect(await collect(res)).toEqual([
    { type: "step", label: "Computing…" },
    { type: "total", total: 2 },
    { type: "step", label: "A", done: 1 },
    { type: "done", summary: "ok", redirect: "/x" },
  ]);
});

test("emits a single error event when run throws, and no done", async () => {
  const res = streamOperation(async () => { throw new Error("boom"); });
  expect(await collect(res)).toEqual([{ type: "error", message: "boom" }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test lib/__tests__/progress.test.ts`
Expected: FAIL — `Cannot find module '@/lib/progress'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/progress.ts
export type ProgressEvent =
  | { type: "step"; label: string; done?: number }
  | { type: "total"; total: number; title?: string }
  | { type: "done"; summary: string; redirect?: string }
  | { type: "error"; message: string };

export type OnProgress = (event: ProgressEvent) => void;

// ~1KB whitespace preamble defeats Safari's 1024-byte streaming buffer.
// The client NDJSON parser skips blank lines, so it is inert.
const PADDING = " ".repeat(1024) + "\n";

export function streamOperation(
  run: (onProgress: OnProgress) => Promise<{ summary: string; redirect?: string }>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: ProgressEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      controller.enqueue(encoder.encode(PADDING));
      try {
        const result = await run(emit); // resolves only after COMMIT
        emit({ type: "done", summary: result.summary, redirect: result.redirect });
      } catch (err) {
        emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test lib/__tests__/progress.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/progress.ts lib/__tests__/progress.test.ts
git commit -m "feat: streamOperation NDJSON progress primitive

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Client-side NDJSON reader + state reducer (pure)

**Files:**
- Create: `lib/operation-stream.ts`
- Test: `lib/__tests__/operation-stream.test.ts`

**Interfaces:**
- Consumes: `type ProgressEvent` (Task 1).
- Produces:
  - `type OperationState = {phase:"idle"|"running"|"done"|"error";title?:string;total?:number;done:number;label?:string;summary?:string;error?:string}`
  - `const initialOperationState: OperationState`
  - `function reduceOperation(prev: OperationState, event: ProgressEvent): OperationState`
  - `async function* readNdjson(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<ProgressEvent>`

- [ ] **Step 1: Write the failing test**

```ts
// lib/__tests__/operation-stream.test.ts
import { expect, test } from "vitest";
import { readNdjson, reduceOperation, initialOperationState } from "@/lib/operation-stream";
import type { ProgressEvent } from "@/lib/progress";

function readerFrom(chunks: string[]): ReadableStreamDefaultReader<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return {
    read: async () =>
      i < chunks.length ? { value: enc.encode(chunks[i++]), done: false } : { value: undefined, done: true },
    releaseLock() {}, cancel: async () => {}, closed: Promise.resolve(undefined),
  } as unknown as ReadableStreamDefaultReader<Uint8Array>;
}

async function drain(chunks: string[]): Promise<ProgressEvent[]> {
  const out: ProgressEvent[] = [];
  for await (const e of readNdjson(readerFrom(chunks))) out.push(e);
  return out;
}

test("reassembles events split across chunk boundaries and skips blank/padding lines", async () => {
  const events = await drain([
    "   \n",                                    // padding preamble
    '{"type":"to',                              // split mid-line
    'tal","total":2}\n{"type":"st',             // end of one + start of next
    'ep","label":"A","done":1}\n',
    '{"type":"done","summary":"ok"}',           // trailing line, no newline before close
  ]);
  expect(events).toEqual([
    { type: "total", total: 2 },
    { type: "step", label: "A", done: 1 },
    { type: "done", summary: "ok" },
  ]);
});

test("reducer: total makes it determinate, step advances done, done snaps to total", () => {
  let s = initialOperationState;
  s = reduceOperation(s, { type: "step", label: "Computing…" });
  expect(s).toMatchObject({ phase: "running", label: "Computing…", total: undefined });
  s = reduceOperation(s, { type: "total", total: 4 });
  expect(s).toMatchObject({ total: 4 });
  s = reduceOperation(s, { type: "step", label: "B", done: 2 });
  expect(s).toMatchObject({ done: 2, label: "B" });
  s = reduceOperation(s, { type: "done", summary: "done" });
  expect(s).toMatchObject({ phase: "done", summary: "done", done: 4 });
});

test("reducer: error sets error phase", () => {
  const s = reduceOperation(initialOperationState, { type: "error", message: "boom" });
  expect(s).toMatchObject({ phase: "error", error: "boom" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test lib/__tests__/operation-stream.test.ts`
Expected: FAIL — `Cannot find module '@/lib/operation-stream'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/operation-stream.ts
import type { ProgressEvent } from "@/lib/progress";

export type OperationState = {
  phase: "idle" | "running" | "done" | "error";
  title?: string;
  total?: number;
  done: number;
  label?: string;
  summary?: string;
  error?: string;
};

export const initialOperationState: OperationState = { phase: "idle", done: 0 };

export function reduceOperation(prev: OperationState, event: ProgressEvent): OperationState {
  switch (event.type) {
    case "total":
      return { ...prev, phase: "running", total: event.total, title: event.title ?? prev.title };
    case "step":
      return { ...prev, phase: "running", label: event.label, done: event.done ?? prev.done };
    case "done":
      return { ...prev, phase: "done", summary: event.summary, done: prev.total ?? prev.done };
    case "error":
      return { ...prev, phase: "error", error: event.message };
  }
}

export async function* readNdjson(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<ProgressEvent> {
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) yield JSON.parse(line) as ProgressEvent;
    }
  }
  const last = buffer.trim();
  if (last) yield JSON.parse(last) as ProgressEvent;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test lib/__tests__/operation-stream.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/operation-stream.ts lib/__tests__/operation-stream.test.ts
git commit -m "feat: client NDJSON reader + operation-state reducer

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Thread `onProgress` through the cascade engine

**Files:**
- Modify: `lib/cascade.ts` (`deleteRadius`, `executeCascade`, `executeCascadeMany`)
- Test: `lib/__tests__/cascade-progress.int.test.ts` (new, isolated fixtures)

**Interfaces:**
- Consumes: `type OnProgress` (Task 1).
- Produces:
  - `executeCascade(schema, table, pk, opts: {dropTenantSchemas?: string[]; onProgress?: OnProgress}): Promise<{deleted:number;droppedSchemas:string[]}>`
  - `executeCascadeMany(schema, table, pks, opts?: {onProgress?: OnProgress}): Promise<{deleted:number}>`
  - Emission order: `step "Computing blast radius…"` → `total = rows + dropSchemas` → per-table `step "Deleting s.t (N rows)…"` with cumulative `done` → per-schema `step "Dropping schema X…"`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/__tests__/cascade-progress.int.test.ts
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import type { Pg } from "@/test/pg";
import { startPg } from "@/test/pg";
import type { ProgressEvent } from "@/lib/progress";

let container: Pg;
beforeAll(async () => {
  const pg = await startPg();
  container = pg.container;
  process.env.DATABASE_URL = pg.url;
  process.env.SYSTEM_DATABASE_URL = pg.url;
  process.env.SYSTEM_SCHEMA_NAME = "CARMEN_SYSTEM";
  process.env.GOD_MODE_PASSWORD = "x";
  process.env.SESSION_SECRET = "x".repeat(32);
  process.env.CASCADE_MAX_ROWS = "5000";
  process.env.CASCADE_MAX_DEPTH = "20";
  vi.mock("@/lib/session", () => ({ getSession: async () => ({ actor: "tester", authed: true }) }));
  const { getSql } = await import("@/lib/db");
  await getSql().unsafe(`
    CREATE SCHEMA "CARMEN_SYSTEM";
    CREATE SCHEMA app;
    CREATE TABLE app.bu (id int primary key, name text);
    CREATE TABLE app.role (id int primary key, bu_id int references app.bu(id));
    INSERT INTO app.bu VALUES (1,'BU1');
    INSERT INTO app.role VALUES (10,1),(11,1);
    CREATE TABLE app.drv (id int primary key);
    INSERT INTO app.drv VALUES (1);
    CREATE SCHEMA tdropA;
  `);
  const { ensureAuditTable } = await import("@/lib/audit");
  await ensureAuditTable();
});
afterAll(async () => { await container.stop(); });

test("executeCascade emits computing → total → per-table steps with cumulative done", async () => {
  const { executeCascade } = await import("@/lib/cascade");
  const events: ProgressEvent[] = [];
  const res = await executeCascade("app", "bu", { id: 1 }, { onProgress: (e) => events.push(e) });
  expect(res.deleted).toBe(3); // bu + 2 roles

  expect(events[0]).toEqual({ type: "step", label: "Computing blast radius…" });
  const total = events.find((e) => e.type === "total");
  expect(total).toEqual({ type: "total", total: 3 });

  const deletes = events.filter((e): e is Extract<ProgressEvent, { type: "step" }> =>
    e.type === "step" && e.label.startsWith("Deleting"));
  expect(deletes.length).toBeGreaterThan(0);
  // cumulative done is monotonic non-decreasing and never exceeds total
  const dones = deletes.map((e) => e.done ?? 0);
  expect(dones).toEqual([...dones].sort((a, b) => a - b));
  expect(Math.max(...dones)).toBeLessThanOrEqual(3);
});

test("executeCascade emits a Dropping schema step per dropped tenant schema", async () => {
  const { executeCascade } = await import("@/lib/cascade");
  const events: ProgressEvent[] = [];
  await executeCascade("app", "drv", { id: 1 }, { dropTenantSchemas: ["tdropA"], onProgress: (e) => events.push(e) });
  expect(events.some((e) => e.type === "step" && e.label === "Dropping schema tdropA…")).toBe(true);
  const total = events.find((e) => e.type === "total");
  expect(total).toEqual({ type: "total", total: 2 }); // 1 drv row + 1 schema
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test lib/__tests__/cascade-progress.int.test.ts`
Expected: FAIL — `executeCascade` ignores `onProgress`, so `events` is empty (`events[0]` is `undefined`).

- [ ] **Step 3: Write minimal implementation**

Edit `lib/cascade.ts`. Add the import at the top (after the existing imports):

```ts
import type { OnProgress } from "@/lib/progress";
```

Change the `deleteRadius` signature and emit events. Replace the signature line and the `withTransaction` body:

```ts
async function deleteRadius(
  actor: string, radius: BlastRadius, opts: { dropTenantSchemas?: string[]; onProgress?: OnProgress },
): Promise<{ deleted: number; droppedSchemas: string[] }> {
```

Inside `deleteRadius`, after the cycle check and `rowsByTable` is built, before `return withTransaction(...)`, add:

```ts
  const onProgress = opts.onProgress;
  const dropSchemas = opts.dropTenantSchemas ?? [];
  onProgress?.({ type: "total", total: radius.rows.length + dropSchemas.length });
```

Then in the transaction body, emit a step before each table and before each schema drop (cumulative `done`). Replace the loop bodies so they read:

```ts
  return withTransaction(null, async (tx) => {
    let deleted = 0;
    for (const t of order) {
      const list = rowsByTable.get(`${t.schema}.${t.table}`) ?? [];
      if (list.length > 0) {
        onProgress?.({ type: "step", label: `Deleting ${t.schema}.${t.table} (${list.length} rows)…`, done: deleted });
      }
      for (const r of list) {
        const keys = Object.keys(r.pk);
        const clause = keys.map((k, i) => `${ident(k)} = $${i + 1}`).join(" AND ");
        const args = keys.map((k) => r.pk[k]);
        const oldRows = await tx.unsafe(`SELECT * FROM ${qualified(t.schema, t.table)} WHERE ${clause}`, args as any[]);
        await tx.unsafe(`DELETE FROM ${qualified(t.schema, t.table)} WHERE ${clause}`, args as any[]);
        await writeAudit(tx, { actor, schemaName: t.schema, tableName: t.table, operation: "CASCADE_DELETE",
          pk: r.pk, oldValues: oldRows[0] ?? null, newValues: null, statement: `DELETE FROM ${qualified(t.schema, t.table)}` });
        deleted += 1;
      }
    }
    const droppedSchemas: string[] = [];
    for (const s of dropSchemas) {
      onProgress?.({ type: "step", label: `Dropping schema ${s}…`, done: deleted + droppedSchemas.length });
      await tx.unsafe(`DROP SCHEMA ${ident(s)} CASCADE`);
      droppedSchemas.push(s);
      await writeAudit(tx, { actor, schemaName: s, tableName: null, operation: "DROP_SCHEMA",
        pk: null, oldValues: null, newValues: null, statement: `DROP SCHEMA ${ident(s)} CASCADE` });
    }
    return { deleted, droppedSchemas };
  });
```

Update `executeCascade` to emit the computing step and forward `onProgress`:

```ts
export async function executeCascade(
  schema: string, table: string, pk: Record<string, unknown>,
  opts: { dropTenantSchemas?: string[]; onProgress?: OnProgress },
): Promise<{ deleted: number; droppedSchemas: string[] }> {
  const actor = await currentActor();
  opts.onProgress?.({ type: "step", label: "Computing blast radius…" });
  const radius = await computeBlastRadius(schema, table, pk);
  return deleteRadius(actor, radius, opts);
}
```

Update `executeCascadeMany` likewise:

```ts
export async function executeCascadeMany(
  schema: string, table: string, pks: Record<string, unknown>[],
  opts: { onProgress?: OnProgress } = {},
): Promise<{ deleted: number }> {
  const actor = await currentActor();
  opts.onProgress?.({ type: "step", label: "Computing blast radius…" });
  const radius = await computeBlastRadiusMany(schema, table, pks);
  const { deleted } = await deleteRadius(actor, radius, { dropTenantSchemas: [], onProgress: opts.onProgress });
  return { deleted };
}
```

- [ ] **Step 4: Run tests to verify they pass (new + existing cascade suites unchanged)**

Run: `bun run test lib/__tests__/cascade-progress.int.test.ts lib/__tests__/cascade.int.test.ts lib/__tests__/cascade-batch.int.test.ts`
Expected: PASS. The existing no-callback cascade tests still pass = backward-compat proof.

- [ ] **Step 5: Commit**

```bash
git add lib/cascade.ts lib/__tests__/cascade-progress.int.test.ts
git commit -m "feat: emit onProgress events from the cascade engine

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `cascade-delete` streaming Route Handler

**Files:**
- Create: `app/api/ops/cascade-delete/route.ts`
- Test: `lib/__tests__/cascade-route.int.test.ts`

**Interfaces:**
- Consumes: `streamOperation` (Task 1), `executeCascade`/`executeCascadeMany` (Task 3), `requireAuth`, `requiredPhrase`/`phraseMatches`, `resolveTenantSchema`/`resolveTenantSchemasForCluster`, `env`.
- Produces: `POST(request: Request): Promise<Response>`. Request JSON body: `{schema, table, pks: Record<string,unknown>[], dropSchema?: boolean, confirm: string}`. Returns 401 (unauth) / 400 (no rows or bad phrase) as JSON, else a streaming NDJSON `Response`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/__tests__/cascade-route.int.test.ts
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import type { Pg } from "@/test/pg";
import { startPg } from "@/test/pg";

let container: Pg;
beforeAll(async () => {
  const pg = await startPg();
  container = pg.container;
  process.env.DATABASE_URL = pg.url;
  process.env.SYSTEM_DATABASE_URL = pg.url;
  process.env.SYSTEM_SCHEMA_NAME = "CARMEN_SYSTEM";
  process.env.GOD_MODE_PASSWORD = "x";
  process.env.SESSION_SECRET = "x".repeat(32);
  process.env.CASCADE_MAX_ROWS = "5000";
  process.env.CASCADE_MAX_DEPTH = "20";
  vi.mock("@/lib/session", () => ({ requireAuth: async () => ({ authed: true, actor: "tester" }) }));
  vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
  const { getSql } = await import("@/lib/db");
  await getSql().unsafe(`
    CREATE SCHEMA "CARMEN_SYSTEM";
    CREATE SCHEMA app;
    CREATE TABLE app.p (id int primary key);
    INSERT INTO app.p VALUES (1),(2);
  `);
  const { ensureAuditTable } = await import("@/lib/audit");
  await ensureAuditTable();
});
afterAll(async () => { await container.stop(); });

function req(body: unknown): Request {
  return new Request("http://x/api/ops/cascade-delete", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}
async function collect(res: Response): Promise<any[]> {
  const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = "";
  for (;;) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); }
  return buf.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
}

test("rejects a wrong confirm phrase with 400 and does not delete", async () => {
  const { POST } = await import("@/app/api/ops/cascade-delete/route");
  const res = await POST(req({ schema: "app", table: "p", pks: [{ id: 1 }], confirm: "nope" }));
  expect(res.status).toBe(400);
  const { getSql } = await import("@/lib/db");
  const n = await getSql().unsafe(`SELECT count(*)::int n FROM app.p`);
  expect(n[0].n).toBe(2);
});

test("streams progress and deletes the selected rows", async () => {
  const { POST } = await import("@/app/api/ops/cascade-delete/route");
  const res = await POST(req({ schema: "app", table: "p", pks: [{ id: 1 }, { id: 2 }], confirm: "DELETE" }));
  expect(res.status).toBe(200);
  const events = await collect(res);
  expect(events.some((e) => e.type === "total")).toBe(true);
  expect(events.at(-1)).toMatchObject({ type: "done" });
  const { getSql } = await import("@/lib/db");
  const n = await getSql().unsafe(`SELECT count(*)::int n FROM app.p`);
  expect(n[0].n).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test lib/__tests__/cascade-route.int.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/ops/cascade-delete/route'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// app/api/ops/cascade-delete/route.ts
import { revalidatePath } from "next/cache";
import { env } from "@/lib/env";
import { requireAuth } from "@/lib/session";
import { executeCascade, executeCascadeMany } from "@/lib/cascade";
import { requiredPhrase, phraseMatches } from "@/lib/delete-confirm";
import { resolveTenantSchema, resolveTenantSchemasForCluster } from "@/lib/registry";
import { streamOperation } from "@/lib/progress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  schema: string; table: string;
  pks: Record<string, unknown>[]; dropSchema?: boolean; confirm: string;
};

export async function POST(request: Request): Promise<Response> {
  try {
    await requireAuth();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { schema, table, pks, dropSchema, confirm } = (await request.json()) as Body;
  if (!Array.isArray(pks) || pks.length === 0) {
    return Response.json({ error: "No rows selected" }, { status: 400 });
  }

  const isBusinessUnit = schema === env().systemSchemaName && table === "tb_business_unit";
  const isCluster = schema === env().systemSchemaName && table === "tb_cluster";
  const isSingle = pks.length === 1;

  // Only single-row delete may drop tenant schemas (batch never drops).
  let dropSchemas: string[] = [];
  if (isSingle && dropSchema) {
    if (isBusinessUnit) { const s = await resolveTenantSchema(String(pks[0].id)); if (s) dropSchemas = [s]; }
    else if (isCluster) { dropSchemas = await resolveTenantSchemasForCluster(String(pks[0].id)); }
  }

  // BU + single + drop → phrase is the schema name; everything else → "DELETE".
  const phrase = requiredPhrase({
    isBusinessUnit,
    dropSchema: isBusinessUnit && isSingle ? (dropSchemas[0] ?? null) : null,
  });
  if (!phraseMatches(confirm ?? "", phrase)) {
    return Response.json({ error: `Confirmation text must equal "${phrase}"` }, { status: 400 });
  }

  const redirect = isBusinessUnit
    ? "/schemas"
    : isCluster
    ? "/clusters"
    : `/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`;

  return streamOperation(async (onProgress) => {
    let summary: string;
    if (isSingle) {
      const res = await executeCascade(schema, table, pks[0], { dropTenantSchemas: dropSchemas, onProgress });
      summary = `Deleted ${res.deleted} row(s)` +
        (res.droppedSchemas.length ? `, dropped ${res.droppedSchemas.length} schema(s)` : "");
    } else {
      const res = await executeCascadeMany(schema, table, pks, { onProgress });
      summary = `Deleted ${res.deleted} row(s)`;
    }
    // mirror the prior server-action revalidation
    if (isBusinessUnit) revalidatePath("/schemas");
    if (isCluster) revalidatePath("/clusters");
    revalidatePath(`/${schema}/${table}`);
    return { summary, redirect };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test lib/__tests__/cascade-route.int.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/ops/cascade-delete/route.ts lib/__tests__/cascade-route.int.test.ts
git commit -m "feat: streaming cascade-delete route handler

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `useOperationStream` hook + `<OperationProgress>` component

**Files:**
- Create: `components/use-operation-stream.ts`
- Create: `components/operation-progress.tsx`
- Test: `components/__tests__/use-operation-stream.test.tsx`
- Test: `components/__tests__/operation-progress.test.tsx`

**Interfaces:**
- Consumes: `readNdjson`, `reduceOperation`, `initialOperationState`, `type OperationState` (Task 2).
- Produces:
  - `function useOperationStream(): { state: OperationState; start: (url: string, payload: unknown) => Promise<void> }`
  - `function OperationProgress({ state }: { state: OperationState }): JSX.Element | null`

- [ ] **Step 1: Write the failing tests**

```tsx
// components/__tests__/operation-progress.test.tsx
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import "@testing-library/jest-dom/vitest";
import { OperationProgress } from "@/components/operation-progress";

afterEach(cleanup);

test("renders nothing when idle", () => {
  const { container } = render(<OperationProgress state={{ phase: "idle", done: 0 }} />);
  expect(container).toBeEmptyDOMElement();
});

test("shows percent + label when determinate and running", () => {
  render(<OperationProgress state={{ phase: "running", done: 3, total: 4, label: "Deleting x…" }} />);
  expect(screen.getByText(/75% · Deleting x…/)).toBeInTheDocument();
});

test("error state spells out the rollback", () => {
  render(<OperationProgress state={{ phase: "error", done: 0, error: "boom" }} />);
  expect(screen.getByText("boom")).toBeInTheDocument();
  expect(screen.getByText(/No changes were applied — the operation was rolled back\./)).toBeInTheDocument();
});
```

```tsx
// components/__tests__/use-operation-stream.test.tsx
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const push = vi.fn(); const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

import { useOperationStream } from "@/components/use-operation-stream";

function Harness() {
  const { state, start } = useOperationStream();
  return (
    <div>
      <button onClick={() => start("/api/ops/x", { a: 1 })}>go</button>
      <span data-testid="phase">{state.phase}</span>
      <span data-testid="summary">{state.summary}</span>
    </div>
  );
}

function streamingResponse(lines: string[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) { for (const l of lines) c.enqueue(enc.encode(l + "\n")); c.close(); },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test("drives to done and triggers router navigation on redirect", async () => {
  vi.stubGlobal("fetch", vi.fn(async () =>
    streamingResponse([
      JSON.stringify({ type: "total", total: 1 }),
      JSON.stringify({ type: "step", label: "A", done: 1 }),
      JSON.stringify({ type: "done", summary: "ok", redirect: "/clusters" }),
    ])));
  render(<Harness />);
  fireEvent.click(screen.getByText("go"));
  await waitFor(() => expect(screen.getByTestId("phase")).toHaveTextContent("done"));
  expect(screen.getByTestId("summary")).toHaveTextContent("ok");
  expect(push).toHaveBeenCalledWith("/clusters");
});

test("non-200 response surfaces the JSON error", async () => {
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(JSON.stringify({ error: "bad phrase" }), { status: 400 })));
  render(<Harness />);
  fireEvent.click(screen.getByText("go"));
  await waitFor(() => expect(screen.getByTestId("phase")).toHaveTextContent("error"));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test components/__tests__/operation-progress.test.tsx components/__tests__/use-operation-stream.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write minimal implementations**

```tsx
// components/operation-progress.tsx
"use client";
import type { OperationState } from "@/lib/operation-stream";

export function OperationProgress({ state }: { state: OperationState }) {
  if (state.phase === "idle") return null;
  const determinate = state.total != null && state.total > 0;
  const pct = determinate ? Math.min(100, Math.round((state.done / state.total!) * 100)) : null;
  return (
    <div className="space-y-1" role="status" aria-live="polite">
      <div className="h-2 w-full overflow-hidden rounded bg-gray-200">
        {state.phase === "done" ? (
          <div className="h-full bg-green-600" style={{ width: "100%" }} />
        ) : state.phase === "error" ? (
          <div className="h-full bg-red-600" style={{ width: "100%" }} />
        ) : determinate ? (
          <div className="h-full bg-black transition-all" style={{ width: `${pct}%` }} />
        ) : (
          <div className="h-full w-1/3 animate-pulse bg-black" />
        )}
      </div>
      {state.phase === "running" && (
        <p className="text-sm text-gray-600">{pct != null ? `${pct}% · ` : ""}{state.label}</p>
      )}
      {state.phase === "done" && <p className="text-sm text-green-700">{state.summary}</p>}
      {state.phase === "error" && (
        <div className="text-sm text-red-700">
          <p>{state.error}</p>
          <p className="text-xs text-red-600">No changes were applied — the operation was rolled back.</p>
        </div>
      )}
    </div>
  );
}
```

```tsx
// components/use-operation-stream.ts
"use client";
import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  initialOperationState,
  reduceOperation,
  readNdjson,
  type OperationState,
} from "@/lib/operation-stream";

export function useOperationStream(): {
  state: OperationState;
  start: (url: string, payload: unknown) => Promise<void>;
} {
  const router = useRouter();
  const [state, setState] = useState<OperationState>(initialOperationState);
  const running = useRef(false);

  const start = useCallback(async (url: string, payload: unknown) => {
    if (running.current) return;
    running.current = true;
    setState({ ...initialOperationState, phase: "running" });

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      running.current = false;
      setState({ phase: "error", done: 0, error: e instanceof Error ? e.message : String(e) });
      return;
    }

    if (!res.ok || !res.body) {
      let message = `Request failed (${res.status})`;
      try { const j = await res.json(); if (j?.error) message = j.error; } catch { /* non-JSON */ }
      running.current = false;
      setState({ phase: "error", done: 0, error: message });
      return;
    }

    let redirectTo: string | undefined;
    for await (const event of readNdjson(res.body.getReader())) {
      if (event.type === "done") redirectTo = event.redirect;
      setState((prev) => reduceOperation(prev, event));
    }

    running.current = false;
    if (redirectTo) { router.refresh(); router.push(redirectTo); }
  }, [router]);

  return { state, start };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test components/__tests__/operation-progress.test.tsx components/__tests__/use-operation-stream.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add components/use-operation-stream.ts components/operation-progress.tsx components/__tests__/use-operation-stream.test.tsx components/__tests__/operation-progress.test.tsx
git commit -m "feat: useOperationStream hook + OperationProgress component

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Convert delete flow to client-driven streaming + retire server actions

**Files:**
- Modify: `components/confirm-delete.tsx` (→ client component using the hook)
- Modify: `app/(god)/[schema]/[table]/delete/page.tsx` (drop `action` prop + `confirmDelete` import)
- Modify: `app/(god)/[schema]/[table]/delete-batch/page.tsx` (drop `action` prop + `confirmBatchDelete` import)
- Delete: `server/delete.ts`
- Modify: `components/__tests__/confirm-delete.test.tsx` (update to client-driven API)

**Interfaces:**
- Consumes: `useOperationStream` + `OperationProgress` (Task 5), the `/api/ops/cascade-delete` route (Task 4).
- Produces: `ConfirmDelete` now takes `{schema, table, pkJson, radius, isBusinessUnit, tenantSchema, orphanSchemas?, requiredPhrase}` (no `action`); it POSTs `{schema, table, pks, dropSchema, confirm}` and renders inline progress. `pkJson` may be a single object or an array — normalized to `pks: Record<string,unknown>[]`.

- [ ] **Step 1: Update the failing test first**

Replace `components/__tests__/confirm-delete.test.tsx` with the client-driven version:

```tsx
// components/__tests__/confirm-delete.test.tsx
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { BlastRadius } from "@/lib/cascade";

const push = vi.fn(); const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const radius: BlastRadius = {
  rows: [{ schema: "CARMEN_SYSTEM", table: "tb_cluster", pk: { id: "1" }, depth: 0 }],
  byTable: [{ schema: "CARMEN_SYSTEM", table: "tb_cluster", count: 1 }],
  maxDepth: 0, truncated: false,
};

test("renders an orphan-schemas drop checkbox listing each schema", async () => {
  const { ConfirmDelete } = await import("@/components/confirm-delete");
  render(<ConfirmDelete schema="CARMEN_SYSTEM" table="tb_cluster" pkJson={JSON.stringify({ id: "1" })}
    radius={radius} isBusinessUnit={false} tenantSchema={null}
    orphanSchemas={["tenant_one", "tenant_two"]} requiredPhrase="DELETE" />);
  expect(screen.getByRole("checkbox")).toBeInTheDocument();
  expect(screen.getByText(/tenant_one/)).toBeInTheDocument();
  expect(screen.getByText(/tenant_two/)).toBeInTheDocument();
});

test("no checkbox when orphanSchemas is empty/absent", async () => {
  const { ConfirmDelete } = await import("@/components/confirm-delete");
  render(<ConfirmDelete schema="CARMEN_SYSTEM" table="tb_cluster" pkJson={JSON.stringify({ id: "1" })}
    radius={radius} isBusinessUnit={false} tenantSchema={null} requiredPhrase="DELETE" />);
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});

test("submitting POSTs the normalized payload to the cascade-delete route", async () => {
  const fetchMock = vi.fn(async () => {
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(enc.encode(JSON.stringify({ type: "done", summary: "ok", redirect: "/clusters" }) + "\n")); c.close(); },
    });
    return new Response(body, { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);

  const { ConfirmDelete } = await import("@/components/confirm-delete");
  render(<ConfirmDelete schema="CARMEN_SYSTEM" table="tb_cluster" pkJson={JSON.stringify({ id: "1" })}
    radius={radius} isBusinessUnit={false} tenantSchema={null} requiredPhrase="DELETE" />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "DELETE" } });
  fireEvent.click(screen.getByRole("button", { name: /permanently delete/i }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("/api/ops/cascade-delete");
  expect(JSON.parse(String(init.body))).toEqual({
    schema: "CARMEN_SYSTEM", table: "tb_cluster", pks: [{ id: "1" }], dropSchema: false, confirm: "DELETE",
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test components/__tests__/confirm-delete.test.tsx`
Expected: FAIL — the current `ConfirmDelete` still expects an `action` prop and uses `<form action=…>`, so the submit test (and the `useRouter` import) fails.

- [ ] **Step 3: Rewrite `ConfirmDelete` as a client component**

Replace the entire contents of `components/confirm-delete.tsx`:

```tsx
// components/confirm-delete.tsx
"use client";
import { useState } from "react";
import type { BlastRadius } from "@/lib/cascade";
import { useOperationStream } from "@/components/use-operation-stream";
import { OperationProgress } from "@/components/operation-progress";

export function ConfirmDelete({
  schema, table, pkJson, radius, isBusinessUnit, tenantSchema, orphanSchemas, requiredPhrase,
}: {
  schema: string; table: string; pkJson: string; radius: BlastRadius;
  isBusinessUnit: boolean; tenantSchema: string | null;
  orphanSchemas?: string[]; requiredPhrase: string;
}) {
  const { state, start } = useOperationStream();
  const [confirm, setConfirm] = useState("");
  const [dropSchema, setDropSchema] = useState(false);

  const parsed = JSON.parse(pkJson);
  const pks: Record<string, unknown>[] = Array.isArray(parsed) ? parsed : [parsed];
  const running = state.phase === "running";

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    start("/api/ops/cascade-delete", { schema, table, pks, dropSchema, confirm });
  }

  return (
    <form onSubmit={onSubmit} className="max-w-2xl space-y-4">
      <div className="rounded border border-red-300 bg-red-50 p-3">
        <p className="font-semibold text-red-800">This permanently deletes {radius.rows.length} row(s) across {radius.byTable.length} table(s). Max depth {radius.maxDepth}.</p>
        {radius.truncated && <p className="mt-1 text-sm text-red-900">⚠ Blast radius hit the configured cap — execution will be refused until you narrow it or raise the caps.</p>}
      </div>
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left"><th>Table</th><th className="text-right">rows</th></tr></thead>
        <tbody>{radius.byTable.map((b) => (
          <tr key={`${b.schema}.${b.table}`} className="border-b"><td className="font-mono">{b.schema}.{b.table}</td><td className="text-right">{b.count}</td></tr>
        ))}</tbody>
      </table>

      {isBusinessUnit && tenantSchema && (
        <label className="flex items-center gap-2 rounded border border-amber-400 bg-amber-50 p-2 text-sm">
          <input type="checkbox" checked={dropSchema} onChange={(e) => setDropSchema(e.target.checked)} />
          Also <strong>DROP SCHEMA &quot;{tenantSchema}&quot; CASCADE</strong> (wipes the entire tenant database for this BU)
        </label>
      )}

      {orphanSchemas && orphanSchemas.length > 0 && (
        <div className="space-y-2">
          <label className="flex items-start gap-2 rounded border border-amber-400 bg-amber-50 p-2 text-sm">
            <input type="checkbox" checked={dropSchema} onChange={(e) => setDropSchema(e.target.checked)} />
            <span>Also <strong>DROP {orphanSchemas.length} tenant schema(s) CASCADE</strong>: <code>{orphanSchemas.join(", ")}</code> (wipes each tenant database)</span>
          </label>
          <span className="block text-xs text-gray-500">The confirmation phrase below stays DELETE.</span>
        </div>
      )}

      <div className="space-y-1">
        <label className="block text-sm">Type <code className="rounded bg-gray-200 px-1">{requiredPhrase}</code> to confirm:</label>
        <input name="confirm" autoComplete="off" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="w-full rounded border p-2" />
        {isBusinessUnit && tenantSchema && (
          <p className="text-xs text-gray-500">If you check the schema-drop box, the required phrase becomes the schema name.</p>
        )}
      </div>

      <button type="submit" className="rounded bg-red-600 px-4 py-2 font-semibold text-white disabled:opacity-50" disabled={radius.truncated || running}>
        {running ? "Deleting…" : "Permanently delete"}
      </button>

      <OperationProgress state={state} />
    </form>
  );
}
```

- [ ] **Step 4: Update the two pages to drop the server action**

In `app/(god)/[schema]/[table]/delete/page.tsx`: remove the `import { confirmDelete } from "@/server/delete";` line and the `const action = confirmDelete.bind(...)` line, and remove `action={action}` from the `<ConfirmDelete …>` props. (Everything else — `computeBlastRadius`, `resolveTenantSchema`, `resolveTenantSchemasForCluster`, `requiredPhrase`, `orphanSchemas`, `isBusinessUnit`, `tenantSchema` — stays.)

In `app/(god)/[schema]/[table]/delete-batch/page.tsx`: remove `import { confirmBatchDelete } from "@/server/delete";` and the `const action = confirmBatchDelete.bind(...)` line, and remove `action={action}` from the `<ConfirmDelete …>` props.

- [ ] **Step 5: Delete the retired server actions and confirm nothing references them**

```bash
git rm server/delete.ts
grep -rn "server/delete\|confirmDelete\|confirmBatchDelete" app components server lib --include="*.ts" --include="*.tsx"
```
Expected: the grep prints nothing (no remaining references).

- [ ] **Step 6: Run tests + typecheck**

Run: `bun run test components/__tests__/confirm-delete.test.tsx && bun run typecheck`
Expected: PASS, and `tsc --noEmit` clean (no dangling imports).

- [ ] **Step 7: Commit**

```bash
git add components/confirm-delete.tsx components/__tests__/confirm-delete.test.tsx "app/(god)/[schema]/[table]/delete/page.tsx" "app/(god)/[schema]/[table]/delete-batch/page.tsx"
git commit -m "feat: client-driven streaming delete; retire confirmDelete server actions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Migration task list + `runMigrations`

**Files:**
- Modify: `lib/migrations.ts` (add task list + `runMigrations`)
- Modify: `scripts/migrate.ts` (use `runMigrations` — single source of truth)
- Test: `lib/__tests__/migrations.int.test.ts` (extend existing file)

**Interfaces:**
- Consumes: `type OnProgress` (Task 1), `ensureAuditTable` (`lib/audit.ts`), `ensureClusterDeletedAt` (existing).
- Produces:
  - `type MigrationTask = { name: string; run: () => Promise<void> }`
  - `function migrationTasks(): MigrationTask[]`
  - `function runMigrations(onProgress?: OnProgress): Promise<{ count: number }>` — emits `total = tasks.length` then one `step` per task.

- [ ] **Step 1: Write the failing test (append to existing file)**

Add to `lib/__tests__/migrations.int.test.ts`:

```ts
test("runMigrations emits one step per task and reports the count", async () => {
  const { runMigrations } = await import("@/lib/migrations");
  const events: import("@/lib/progress").ProgressEvent[] = [];
  const res = await runMigrations((e) => events.push(e));
  expect(res.count).toBe(2);
  const total = events.find((e) => e.type === "total");
  expect(total).toEqual({ type: "total", total: 2 });
  const steps = events.filter((e) => e.type === "step");
  expect(steps.length).toBe(2);
  // idempotent: a second run still succeeds
  const again = await runMigrations();
  expect(again.count).toBe(2);
});
```

(Append this test at the **end** of the existing file. Note: an earlier test in that file (`…no-ops when the table is absent`) `DROP`s `CARMEN_SYSTEM.tb_cluster`, so by the time this test runs the table is gone — that is fine, because `runMigrations` → `ensureClusterDeletedAt` no-ops on a missing table (catches `42P01`) while `ensureAuditTable` still creates the audit table. `count` is therefore still `2` regardless of table presence. Do not reorder the existing tests.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test lib/__tests__/migrations.int.test.ts`
Expected: FAIL — `runMigrations` is not exported.

- [ ] **Step 3: Write minimal implementation**

Replace `lib/migrations.ts`:

```ts
// lib/migrations.ts
import { getSql } from "@/lib/db";
import { env } from "@/lib/env";
import { qualified } from "@/lib/sql-guard";
import { ensureAuditTable } from "@/lib/audit";
import type { OnProgress } from "@/lib/progress";

/** Ensure tb_cluster has a deleted_at column for soft delete. Idempotent; no-op if the table is absent. */
export async function ensureClusterDeletedAt(): Promise<void> {
  const rel = qualified(env().systemSchemaName, "tb_cluster");
  try {
    await getSql().unsafe(`ALTER TABLE ${rel} ADD COLUMN IF NOT EXISTS deleted_at timestamptz`);
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === "42P01") return; // table absent — nothing to migrate
    throw err;
  }
}

export type MigrationTask = { name: string; run: () => Promise<void> };

export function migrationTasks(): MigrationTask[] {
  return [
    { name: "Ensure audit table", run: ensureAuditTable },
    { name: "Add tb_cluster.deleted_at", run: ensureClusterDeletedAt },
  ];
}

export async function runMigrations(onProgress?: OnProgress): Promise<{ count: number }> {
  const tasks = migrationTasks();
  onProgress?.({ type: "total", total: tasks.length });
  let done = 0;
  for (const t of tasks) {
    onProgress?.({ type: "step", label: `${t.name}…`, done });
    await t.run();
    done += 1;
  }
  return { count: tasks.length };
}
```

Replace `scripts/migrate.ts`:

```ts
// scripts/migrate.ts
import { runMigrations } from "@/lib/migrations";

runMigrations()
  .then(({ count }) => { console.log(`migrations ready (${count} applied)`); process.exit(0); })
  .catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test lib/__tests__/migrations.int.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/migrations.ts scripts/migrate.ts lib/__tests__/migrations.int.test.ts
git commit -m "feat: runMigrations task list with progress; CLI reuses it

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: `/migrations` page + migrate route + nav link

**Files:**
- Create: `app/api/ops/migrate/route.ts`
- Create: `app/(god)/migrations/page.tsx`
- Create: `components/run-migrations.tsx`
- Modify: `app/(god)/layout.tsx` (nav link)
- Test: `lib/__tests__/migrate-route.int.test.ts`

**Interfaces:**
- Consumes: `runMigrations` (Task 7), `streamOperation` (Task 1), `requireAuth`, `useOperationStream` + `OperationProgress` (Task 5).
- Produces: `POST(): Promise<Response>` at `/api/ops/migrate` (401 if unauth, else streams). `<RunMigrations/>` client component. `/migrations` page.

- [ ] **Step 1: Write the failing test**

```ts
// lib/__tests__/migrate-route.int.test.ts
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import type { Pg } from "@/test/pg";
import { startPg } from "@/test/pg";

let container: Pg;
beforeAll(async () => {
  const pg = await startPg();
  container = pg.container;
  process.env.DATABASE_URL = pg.url;
  process.env.SYSTEM_DATABASE_URL = pg.url;
  process.env.SYSTEM_SCHEMA_NAME = "CARMEN_SYSTEM";
  process.env.GOD_MODE_PASSWORD = "x";
  process.env.SESSION_SECRET = "x".repeat(32);
  vi.mock("@/lib/session", () => ({ requireAuth: async () => ({ authed: true }) }));
  const { getSql } = await import("@/lib/db");
  await getSql().unsafe(`CREATE SCHEMA "CARMEN_SYSTEM"; CREATE TABLE "CARMEN_SYSTEM".tb_cluster (id int primary key);`);
});
afterAll(async () => { await container.stop(); });

async function collect(res: Response): Promise<any[]> {
  const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = "";
  for (;;) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); }
  return buf.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
}

test("POST streams migration progress and finishes with done", async () => {
  const { POST } = await import("@/app/api/ops/migrate/route");
  const res = await POST();
  expect(res.status).toBe(200);
  const events = await collect(res);
  expect(events.find((e) => e.type === "total")).toEqual({ type: "total", total: 2 });
  expect(events.at(-1)).toMatchObject({ type: "done" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test lib/__tests__/migrate-route.int.test.ts`
Expected: FAIL — route module not found.

- [ ] **Step 3: Write minimal implementations**

```ts
// app/api/ops/migrate/route.ts
import { requireAuth } from "@/lib/session";
import { runMigrations } from "@/lib/migrations";
import { streamOperation } from "@/lib/progress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  try {
    await requireAuth();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return streamOperation(async (onProgress) => {
    const { count } = await runMigrations(onProgress);
    return { summary: `${count} migration(s) applied` };
  });
}
```

```tsx
// components/run-migrations.tsx
"use client";
import { useOperationStream } from "@/components/use-operation-stream";
import { OperationProgress } from "@/components/operation-progress";

export function RunMigrations() {
  const { state, start } = useOperationStream();
  const running = state.phase === "running";
  return (
    <div className="space-y-3">
      <button disabled={running} onClick={() => start("/api/ops/migrate", {})}
        className="rounded bg-black px-4 py-2 font-semibold text-white disabled:opacity-50">
        {running ? "Running…" : "Run migrations"}
      </button>
      <OperationProgress state={state} />
    </div>
  );
}
```

```tsx
// app/(god)/migrations/page.tsx
import { RunMigrations } from "@/components/run-migrations";

export const dynamic = "force-dynamic";

export default function MigrationsPage() {
  return (
    <div>
      <h1 className="my-3 text-lg font-semibold">Migrations</h1>
      <p className="mb-3 text-sm text-gray-600">
        Applies idempotent schema migrations (god-mode audit table, <code>tb_cluster.deleted_at</code>). Safe to run repeatedly.
      </p>
      <RunMigrations />
    </div>
  );
}
```

In `app/(god)/layout.tsx`, add a nav link after the Audit log link:

```tsx
        <Link href="/audit" className="text-sm text-gray-600">Audit log</Link>
        <Link href="/migrations" className="text-sm text-gray-600">Migrations</Link>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test lib/__tests__/migrate-route.int.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/ops/migrate/route.ts "app/(god)/migrations/page.tsx" components/run-migrations.tsx "app/(god)/layout.tsx" lib/__tests__/migrate-route.int.test.ts
git commit -m "feat: /migrations page + streaming migrate route + nav link

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: SQL console indeterminate "Running…" bar

**Files:**
- Modify: `components/sql-console.tsx` (render `<OperationProgress>` while busy)

**Interfaces:**
- Consumes: `<OperationProgress>` (Task 5). No new exports. This is a presentational reuse — the SQL console keeps its existing server actions (`runSql`/`applySql`); it just shows an indeterminate bar while `busy`.

- [ ] **Step 1: Add the import and render the bar**

In `components/sql-console.tsx`, add the import:

```tsx
import { OperationProgress } from "@/components/operation-progress";
```

Then, immediately after the `<div className="flex gap-2">…</div>` button row (before the `{error && …}` line), add:

```tsx
      {busy && <OperationProgress state={{ phase: "running", done: 0, label: "Running…" }} />}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: clean (the inline state object matches `OperationState`: `phase`, `done`, `label` provided; `total` omitted → indeterminate).

- [ ] **Step 3: Commit**

```bash
git add components/sql-console.tsx
git commit -m "feat: indeterminate Running bar in the SQL console

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Full suite + typecheck + lint gate

**Files:** none (verification only).

- [ ] **Step 1: Run the entire test suite**

Run: `bun run test`
Expected: all suites PASS, including the previously-existing cascade/registry/soft-delete int tests (proving backward compatibility) and the new progress/stream/route tests.

- [ ] **Step 2: Typecheck and lint**

Run: `bun run typecheck && bun run lint`
Expected: both clean. (If lint flags `any` casts copied from existing cascade code, they already carry the established `eslint-disable` pattern — match the surrounding style.)

- [ ] **Step 3: Commit any cleanup**

```bash
git add -A
git commit -m "chore: streaming-progress suite green (typecheck + lint clean)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" --allow-empty
```

---

## Optional follow-up (not in this plan)

- **Playwright e2e** (`e2e/`): drive a real cluster delete, assert the bar appears, reaches 100%, redirects to `/clusters`, row gone. The integration layer already covers correctness; add this only if you want a browser-level smoke test.
- **Multi-statement SQL streaming**: deferred per the spec (a `;`-aware splitter handling quotes / dollar-quoting / comments + per-statement `step`s).

## Self-Review notes

- **Spec coverage:** streaming primitive (T1), client reader/reducer (T2), cascade + cluster onProgress (T3) + route (T4), UI hook/component (T5) + delete-flow conversion & server-action retirement (T6), migrations task list (T7) + `/migrations` page/route/nav (T8), SQL console indeterminate bar (T9), verification (T10). Cluster hard delete is covered by T4/T6 (same `cascade-delete` route with `dropSchema`). No cancellation (per locked decision).
- **Type consistency:** `ProgressEvent`/`OnProgress` (T1) are consumed unchanged in T2/T3/T4/T7; `OperationState`/`reduceOperation`/`readNdjson` (T2) feed T5; `useOperationStream` returns `{state, start}` consumed by T6/T8; route bodies use `{schema, table, pks, dropSchema, confirm}` consistently between T4 and the T6 client payload.
- **Batch-never-drops rule:** enforced in T4 (`isSingle && dropSchema` gate). Phrase rules mirror the retired server action exactly.
