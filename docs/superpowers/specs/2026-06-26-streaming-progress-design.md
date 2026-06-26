# Streaming progress for long-running operations

Date: 2026-06-26
Branch base: feat/cluster-management

## Goal

Show the operator a **live, determinate progress bar + current-step caption**
while long-running destructive operations run, instead of a frozen "please wait"
spinner. Build **one reusable streaming mechanism** and apply it across:

- **Cascade delete** (single + batch) — the step-rich core.
- **Cluster hard delete** — same path as cascade with multi-schema drops.
- **Migrations** — via a new `/migrations` admin page (per-task progress).
- **SQL console** — an indeterminate "Running…" bar only (multi-statement
  per-step progress is **deferred**, see Scope).

## Background

Today every heavy operation is a Next.js **server action** that returns one
value at the end of a single round-trip; the UI just waits. Server actions can't
stream incremental progress mid-flight. The work also runs inside a **single
open transaction** that only commits at the very end, so any "progress" written
to the DB would be invisible to other connections until COMMIT (transaction
isolation) — which rules out a progress-table + polling design.

Relevant existing code:

- `lib/cascade.ts` — `computeBlastRadiusMany` (BFS over FKs) →
  `deleteRadius` (delete table-by-table in topo order, optional
  `DROP SCHEMA … CASCADE`) → `executeCascade` / `executeCascadeMany`.
- `server/delete.ts` — `confirmDelete` / `confirmBatchDelete` server actions:
  `requireAuth` → `phraseMatches` → cascade → `revalidatePath` + `redirect`.
  Cluster hard delete is `confirmDelete` with `dropTenantSchemas` populated.
- `lib/migrations.ts` + `scripts/migrate.ts` — migration tasks
  (`ensureAuditTable`, `ensureClusterDeletedAt`) run from the CLI; **no web UI**.
- `lib/sql-runner.ts` — `runRead` / `previewWrite` / `applyWrite`, one
  statement at a time.
- There are **no Route Handlers** in the app yet (all server actions).

This Next version (16.x) supports streaming raw responses from Route Handlers via
the Web Streams API (`ReadableStream` + `TextEncoder` + `controller.enqueue`),
explicitly recommended for SSE / progressive responses
(`node_modules/next/dist/docs/01-app/02-guides/streaming.md`, "Streaming in
Route Handlers"). One documented caveat: Safari buffers streamed bodies until
1024 bytes.

## Approach (chosen)

**Route Handler + streamed NDJSON, with an `onProgress` callback threaded
through the operation functions.** Considered and rejected: streaming server
actions via RSC streamable values (not first-class without an extra lib,
fragile), and background-job + progress polling (blocked by transaction
isolation — in-transaction progress is invisible until COMMIT).

The streaming handler holds the transaction open and emits progress over the
HTTP stream as the in-transaction work proceeds. Events never touch the DB, so
isolation is a non-issue. The `onProgress` callback keeps operation logic
transport-agnostic: no callback passed = behaves exactly as today, still
callable from plain server actions, still unit-testable.

## Architecture

Three reusable pieces:

1. **`OnProgress` callback** — operation functions take an optional
   `onProgress(event)` and emit events as work proceeds.
2. **Streaming Route Handlers** (`app/api/ops/*/route.ts`) — POST handlers:
   `requireAuth` → validate (reuse `requiredPhrase` / `phraseMatches`) → return
   a `ReadableStream` whose `start(controller)` runs the operation, wiring
   `onProgress` to `controller.enqueue(...)` as NDJSON (one JSON object/line). A
   shared `streamOperation()` helper builds the stream, serializes events, wraps
   the run in try/catch, and sets headers.
3. **Client** — a `useOperationStream` hook (POST + read + reassemble NDJSON)
   and an `<OperationProgress>` component (bar + caption).

### Event protocol (NDJSON)

| event   | shape                                   | client effect |
|---------|-----------------------------------------|---------------|
| `step`  | `{type:"step", label, done?}`           | set caption; if `done` and a known `total`, advance bar; else **indeterminate** bar |
| `total` | `{type:"total", total, title?}`         | switch bar to **determinate**; bar = `done/total` |
| `done`  | `{type:"done", summary, redirect?}`     | bar → 100%, show summary, then router navigate/refresh |
| `error` | `{type:"error", message}`               | stop, show error (work was rolled back) |

Design choices:

- `done` is **cumulative**, not an increment → idempotent, robust to any dropped
  frame; client computes `done/total`.
- `total` may arrive **after** early `step`s → an honest **indeterminate prefix**
  for phases where the denominator isn't known yet (e.g. "Computing blast
  radius…"), then determinate once counted.
- **NDJSON over a POST fetch**, not SSE — `EventSource` can't POST a body or
  carry the confirm-phrase/pks payload, and we control both ends.
- Headers: `Content-Type: application/x-ndjson`, `Cache-Control: no-store`,
  `X-Accel-Buffering: no`. A ~1KB **whitespace padding preamble** defeats the
  Safari 1024-byte buffer; the parser skips blank lines.

### Data flow (cascade example)

```
Client form (phrase + pks)
   └─POST→ /api/ops/cascade-delete/route.ts
              requireAuth ✓ · phraseMatches ✓
              streamOperation(onProgress =>
                 executeCascade(..., {onProgress})
                   step  "Computing blast radius…"       (indeterminate)
                   total = rows + schemas                 (now determinate)
                   step  "Deleting SYS.tb_x (44)…"  done=44
                   step  "Dropping schema tenant_ab…" done=…
                 done { summary, redirect:"/clusters" })
   ◀─NDJSON stream─ bar + caption update live
   on done → router.refresh() + navigate
```

## Per-operation wiring & granularity

### Cascade delete + cluster hard delete (full value — the core)

Thread `onProgress` through `computeBlastRadiusMany` → `deleteRadius` →
`executeCascade` / `executeCascadeMany`:

- `step "Computing blast radius…"` — indeterminate, during the BFS.
- `total = totalRows + dropSchemas.length` — once the radius is known.
- Per **table** (not per row — per-row would be thousands of events): emit a
  `step` **before** deleting each table with `done` = cumulative rows so far and
  label `"Deleting SYS.tb_x (44 rows)…"`. Bar advances weighted by row counts.
- Per **schema drop**: `step "Dropping schema tenant_ab…"`, `done += 1`.
- `done { summary: "Deleted 312 rows, dropped 2 schemas", redirect }`.

Cluster hard delete shares this path with `dropTenantSchemas` populated — no
extra route.

### Migrations (thin — needs a trigger)

New **`/migrations`** admin page: a server-component shell + a client
`<RunMigrations>` button using the hook against `/api/ops/migrate`. The route
runs the existing tasks emitting one `step` per task (`total = task count`). The
CLI `scripts/migrate.ts` stays and calls the **same task list** so they never
drift. Add a nav link.

### SQL console (deferred by default — YAGNI)

Wire the SQL console to the same `<OperationProgress>` component so a long single
statement shows an honest **indeterminate** "Running…" bar (consistency win for
free). **Do not** build the `;`-aware multi-statement splitter now (finicky
around quotes / dollar-quoting / comments) — add per-statement progress later if
multi-statement scripts are actually run.

## UI component & form changes

- **`useOperationStream` hook** — `start(url, payload)` POSTs JSON, reads
  `response.body.getReader()`, decodes with `TextDecoder`, **buffers across chunk
  boundaries** (split on `\n`, keep the trailing partial line), `JSON.parse` each
  line. State: `{ phase: "idle"|"running"|"done"|"error", title, total, done,
  label, summary, error }`. On `done.redirect` → `router.refresh()` then
  `router.push(redirect)`. Non-200 → read JSON error body → `error` state.
- **`<OperationProgress>`** — determinate bar + caption
  (`round(done/total*100)% · label`), or animated **indeterminate** bar when
  `total` is unknown. `done` → full bar + green summary before redirect. `error`
  → red bar + message + **"No changes were applied — the operation was rolled
  back."**
- **Delete confirm forms become client-driven.** The confirm-phrase input and
  "drop schema" checkbox stay as-is. On submit, the client calls
  `start("/api/ops/cascade-delete", { schema, table, pks, dropSchemas, confirm })`
  and renders `<OperationProgress>` inline. The handler re-runs auth +
  `phraseMatches` server-side (client payload never trusted). The
  `confirmDelete` / `confirmBatchDelete` server actions are **retired** in favor
  of the route (their cascade/validation logic is reused by the handler);
  `revalidatePath` moves into the handler before `done`; the redirect target
  rides in the `done` payload.

Affected UI: `app/(god)/[schema]/[table]/delete/page.tsx`,
`delete-batch/page.tsx`, the `ClustersTable` batch actions, the new
`/migrations` page, and (indeterminate) the SQL console — all sharing **one**
hook and **one** component.

## Error handling & edge cases

- **Commit ordering (critical rule).** `done` is emitted **only after**
  `withTransaction` resolves (post-COMMIT) — never from inside the tx callback.
  `done` is the one event that truthfully means "committed"; all `step` events
  are provisional/optimistic.
- **Mid-operation failure** (FK cycle, blast-radius cap, DB error).
  `withTransaction` rolls back on throw; `streamOperation` catches → emits
  `{type:"error", message}` → closes. Error UI states: **"No changes were
  applied — the operation was rolled back."**
- **Validation/auth fail before the stream opens** — phrase mismatch, empty
  selection, unauthenticated → normal **non-200 JSON** (400/401), not a stream.
  The hook detects non-200 and shows the error.
- **Client disconnect mid-stream** — with no-cancel, the next `onProgress`
  enqueue throws → propagates → `withTransaction` rolls back. Safe default:
  **leaving mid-operation rolls it back**; atomic boundary is COMMIT itself (a
  disconnect during the final commit may still commit — correct semantics).
- **Blast radius exceeds caps** → throws before any delete; stream shows
  `Computing…` then `error`. Nothing deleted.
- **Empty / idempotent work** (migrations re-run via `ALTER … IF NOT EXISTS`,
  `total = 0`) → steps run as no-ops, bar completes immediately.
- **Double-submit** → trigger `disabled` while `phase === "running"`; the hook
  refuses a second concurrent stream.
- **Auditing unchanged** — the cascade engine still writes per-row audit inside
  the transaction.
- **`revalidatePath`** runs in the handler before `done`; the client then
  `router.refresh()` + navigates. No `next/navigation redirect()` (it doesn't
  drive a browser nav through a fetch).
- **Error message** passes the real DB error through (trusted god-mode
  operators), stack stripped; full error logged server-side.

## Decisions (locked)

- **No cancellation.** Fire-and-forget; runs to completion or fails and rolls
  back. Keeps an abort signal out of the DB layer. Can add later.
- **Determinate progress bar + caption** (indeterminate prefix where the
  denominator is unknown).
- **SQL console multi-statement: deferred.**
- **Migrations trigger: new `/migrations` page.**

## Testing

Vitest unit + `.int.test.ts` integration (embedded-postgres) + one playwright
e2e. TDD order, pure/fast layers first.

1. **Protocol / `streamOperation` (unit).** Fake `run(onProgress)` emits a known
   sequence → assert NDJSON parses back in order with trailing
   `done`(summary+redirect). Error path: `run` throws → last line is `error`, no
   `done`. **Commit-ordering invariant:** `run` resolves on a deferred → assert
   no `done` line until it resolves.
2. **NDJSON client parser (unit — trickiest).** Fake reader yielding chunks that
   split events mid-line, events spanning 3 chunks, multiple events per chunk,
   trailing partial then close, padding/blank lines → assert complete events in
   order. Non-200 path → straight to `error`.
3. **`onProgress` emission from the cascade engine (integration).** Extend
   `cascade.int.test.ts` / `cascade-batch.int.test.ts`: collecting `onProgress`
   asserts `Computing…` (no total) → `total = rows + schemas` → one step per
   table with cumulative `done` matching real row counts and correct
   `schema.table` labels → schema-drop steps → final `done === total`. Existing
   no-callback tests keep passing = backward-compat proof.
4. **Migrations emission (integration).** Task list with `onProgress`:
   `total = task count`, one step per task; idempotent re-run still emits and
   leaves the schema intact.
5. **Route handler guards (integration — highest value).** Fake `Request`, no
   running server: unauthenticated → 401 JSON; bad phrase → 400 JSON; valid → a
   streaming Response whose body parses to the expected sequence end-to-end
   against pg fixtures.
6. **E2E (playwright — one happy path).** Trigger a cluster delete; assert the
   bar appears, reaches 100%, redirects to `/clusters`, row gone.

**Not tested (YAGNI):** cancellation (not built), multi-statement SQL splitting
(deferred), exhaustive cross-browser buffering (covered by padding preamble +
the Safari note).

## New / changed files (summary)

- `lib/progress.ts` — `ProgressEvent` types, `OnProgress`, `streamOperation()`.
- `lib/cascade.ts` — thread `onProgress` through compute/delete/execute.
- `lib/migrations.ts` — expose an ordered task list emitting `onProgress`.
- `app/api/ops/cascade-delete/route.ts` — single + batch + cluster drops.
- `app/api/ops/migrate/route.ts`.
- `components/use-operation-stream.ts` — client hook.
- `components/operation-progress.tsx` — bar + caption.
- `components/clusters-table.tsx`, delete + delete-batch pages, SQL console —
  switch to the hook/component.
- `app/(god)/migrations/page.tsx` + `<RunMigrations>` + nav link.
- `server/delete.ts` — retire `confirmDelete` / `confirmBatchDelete`.
- Tests across the layers above.
