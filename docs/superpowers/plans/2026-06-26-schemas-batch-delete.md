# Multi-select Batch Delete on /schemas (Business Units) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the operator tick multiple Business Units on `/schemas` and delete them in one combined cascade, reusing the existing batch-delete backend.

**Architecture:** Extract the hand-rolled Business Units table on the `/schemas` Server Component into a small `"use client"` component that adds multi-select checkboxes and a "Delete N selected" link pointing at the **existing** `delete-batch` route. Mirror the single-row BU special case into `confirmBatchDelete` so batch-deleting BUs redirects back to `/schemas`.

**Tech Stack:** Next.js 16 App Router (RSC + client components), React `useState`, postgres.js cascade engine (unchanged), vitest + jsdom + Testing Library for the component test, bun as the runner.

## Global Constraints

- This is NOT vanilla Next.js — APIs/conventions differ; consult `node_modules/next/dist/docs/` before writing framework code if unsure.
- Reuse the existing batch backend unchanged: `delete-batch` route, `computeBlastRadiusMany`, `executeCascadeMany`, `radiusTouchesBusinessUnits`, `ConfirmDelete`.
- v1 rule stands: **batch delete never drops tenant Postgres schemas** — the orphan-schema warning on the `delete-batch` page surfaces this.
- `pks` query param is `encodeURIComponent(JSON.stringify(arrayOf{ id }))` and must round-trip into the existing `delete-batch` route's `JSON.parse`.
- `BusinessUnit` type (from `@/lib/registry`): `{ id: string; code: string; name: string; clusterId: string | null; isActive: boolean; tenantSchema: string | null }`.
- Component tests follow `components/__tests__/row-grid.test.tsx`: mock `next/link` to a passthrough `<a>`, `afterEach(cleanup)`, dynamic `await import(...)` of the component inside each test.
- Test runner: `bunx vitest run <path>`. Typecheck: `bun run typecheck`.

## File Structure

- **Create** `components/business-units-table.tsx` — `"use client"` component owning the Business Units table UI + selection state. One responsibility: render BUs with multi-select and the batch/single delete + open links.
- **Create** `components/__tests__/business-units-table.test.tsx` — component tests.
- **Modify** `server/delete.ts` — add BU detection + `/schemas` redirect to `confirmBatchDelete` (mirrors `confirmDelete`).
- **Modify** `app/(god)/schemas/page.tsx` — replace the inline Business Units `<table>` with `<BusinessUnitsTable bus={bus} system={sel.system} />`.

---

### Task 1: BusinessUnitsTable client component

**Files:**
- Create: `components/business-units-table.tsx`
- Test: `components/__tests__/business-units-table.test.tsx`

**Interfaces:**
- Consumes: `BusinessUnit` type from `@/lib/registry`; the existing `delete-batch` route at `/[schema]/[table]/delete-batch?pks=...` and single-row `delete` route at `/[schema]/[table]/delete?pk=...`.
- Produces: `export function BusinessUnitsTable({ bus, system }: { bus: BusinessUnit[]; system: string })` — consumed by Task 3.

- [ ] **Step 1: Write the failing test**

Create `components/__tests__/business-units-table.test.tsx`:

```tsx
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

afterEach(cleanup);
import type { ReactNode } from "react";
import type { BusinessUnit } from "@/lib/registry";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

const bus: BusinessUnit[] = [
  { id: "11", code: "BU-A", name: "Alpha", clusterId: null, isActive: true, tenantSchema: "tenant_a" },
  { id: "22", code: "BU-B", name: "Beta", clusterId: null, isActive: false, tenantSchema: null },
];

test("rows render with code and name", async () => {
  const { BusinessUnitsTable } = await import("@/components/business-units-table");
  render(<BusinessUnitsTable bus={bus} system="CARMEN_SYSTEM" />);
  expect(screen.getByText("BU-A")).toBeInTheDocument();
  expect(screen.getByText("Beta")).toBeInTheDocument();
});

test("no Delete-selected control until a row is checked", async () => {
  const { BusinessUnitsTable } = await import("@/components/business-units-table");
  render(<BusinessUnitsTable bus={bus} system="CARMEN_SYSTEM" />);
  expect(screen.queryByText(/Delete .* selected/)).not.toBeInTheDocument();
});

test("checking a row reveals Delete N selected with the delete-batch href", async () => {
  const { BusinessUnitsTable } = await import("@/components/business-units-table");
  render(<BusinessUnitsTable bus={bus} system="CARMEN_SYSTEM" />);
  fireEvent.click(screen.getByLabelText("select row 0"));
  const link = screen.getByText("Delete 1 selected").closest("a")!;
  expect(link).toHaveAttribute(
    "href",
    `/CARMEN_SYSTEM/tb_business_unit/delete-batch?pks=${encodeURIComponent(JSON.stringify([{ id: "11" }]))}`,
  );
});

test("select-all checks every business unit", async () => {
  const { BusinessUnitsTable } = await import("@/components/business-units-table");
  render(<BusinessUnitsTable bus={bus} system="CARMEN_SYSTEM" />);
  fireEvent.click(screen.getByLabelText("select all"));
  expect(screen.getByText("Delete 2 selected")).toBeInTheDocument();
});

test("per-row delete and open links preserved", async () => {
  const { BusinessUnitsTable } = await import("@/components/business-units-table");
  render(<BusinessUnitsTable bus={bus} system="CARMEN_SYSTEM" />);
  expect(screen.getByText("open →").closest("a")).toHaveAttribute("href", "/tenant_a/tables");
  const del = screen.getAllByText("delete")[0].closest("a")!;
  expect(del).toHaveAttribute(
    "href",
    `/CARMEN_SYSTEM/tb_business_unit/delete?pk=${encodeURIComponent(JSON.stringify({ id: "11" }))}`,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run components/__tests__/business-units-table.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/business-units-table"` (file does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `components/business-units-table.tsx`:

```tsx
"use client";
import { useState } from "react";
import Link from "next/link";
import type { BusinessUnit } from "@/lib/registry";

export function BusinessUnitsTable({ bus, system }: { bus: BusinessUnit[]; system: string }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function buKey(b: BusinessUnit): string {
    return JSON.stringify({ id: b.id });
  }
  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) => (prev.size === bus.length ? new Set() : new Set(bus.map(buKey))));
  }

  const selectedPks = [...selected].map((k) => JSON.parse(k) as { id: string });
  const batchHref = `/${encodeURIComponent(system)}/tb_business_unit/delete-batch?pks=${encodeURIComponent(JSON.stringify(selectedPks))}`;
  const allSelected = bus.length > 0 && selected.size === bus.length;

  return (
    <div className="overflow-x-auto">
      {selected.size > 0 && (
        <div className="mb-2 flex items-center gap-3">
          <span className="text-sm">{selected.size} selected</span>
          <Link href={batchHref} className="rounded bg-red-600 px-3 py-1 text-sm font-semibold text-white">
            Delete {selected.size} selected
          </Link>
        </div>
      )}
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left">
          <th className="px-2"><input type="checkbox" aria-label="select all" checked={allSelected} onChange={toggleAll} /></th>
          <th>Code</th><th>Name</th><th>Active</th><th>Tenant schema</th><th></th>
        </tr></thead>
        <tbody>
          {bus.map((b, i) => {
            const key = buKey(b);
            return (
              <tr key={b.id} className="border-b">
                <td className="px-2"><input type="checkbox" aria-label={`select row ${i}`} checked={selected.has(key)} onChange={() => toggle(key)} /></td>
                <td className="py-1 font-mono">{b.code}</td>
                <td>{b.name}</td>
                <td>{b.isActive ? "yes" : "no"}</td>
                <td>{b.tenantSchema ?? <span className="rounded bg-gray-200 px-2 text-xs">no schema</span>}</td>
                <td className="space-x-3 text-right">
                  {b.tenantSchema && <Link href={`/${encodeURIComponent(b.tenantSchema)}/tables`} className="text-blue-600">open →</Link>}
                  <Link
                    href={`/${encodeURIComponent(system)}/tb_business_unit/delete?pk=${encodeURIComponent(JSON.stringify({ id: b.id }))}`}
                    className="text-red-600"
                  >
                    delete
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run components/__tests__/business-units-table.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add components/business-units-table.tsx components/__tests__/business-units-table.test.tsx
git commit -m "feat: BusinessUnitsTable client component with multi-select batch delete"
```

---

### Task 2: confirmBatchDelete redirects to /schemas for Business Units

**Files:**
- Modify: `server/delete.ts:31-42` (the `confirmBatchDelete` function)

**Interfaces:**
- Consumes: `env()` from `@/lib/env` (already imported at `server/delete.ts:4`), `executeCascadeMany` (already imported).
- Produces: no signature change to `confirmBatchDelete`; only post-cascade redirect behavior changes for the BU table.

- [ ] **Step 1: Edit confirmBatchDelete**

In `server/delete.ts`, replace the tail of `confirmBatchDelete` (from the `await executeCascadeMany(...)` line through the final `redirect(...)`) with:

```ts
  await executeCascadeMany(schema, table, pks);
  const isBusinessUnit = schema === env().systemSchemaName && table === "tb_business_unit";
  if (isBusinessUnit) {
    revalidatePath("/schemas");
    redirect("/schemas");
  }
  revalidatePath(`/${schema}/${table}`);
  redirect(`/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`);
}
```

(The function header, auth, pks parse/guard, and phrase gate above are unchanged.)

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: no errors (`env` already imported; mirrors `confirmDelete`'s BU branch at `server/delete.ts:23-26`).

- [ ] **Step 3: Confirm full suite still green**

Run: `bunx vitest run`
Expected: PASS — no existing test asserts the batch redirect target, so behavior change is non-breaking; the `executeCascadeMany` integration tests still pass.

- [ ] **Step 4: Commit**

```bash
git add server/delete.ts
git commit -m "feat: batch-delete of business units redirects back to /schemas"
```

---

### Task 3: Wire BusinessUnitsTable into the /schemas page

**Files:**
- Modify: `app/(god)/schemas/page.tsx`

**Interfaces:**
- Consumes: `BusinessUnitsTable` from Task 1; `listBusinessUnits`/`listSelectableSchemas` (already imported).
- Produces: user-visible multi-select on `/schemas`.

- [ ] **Step 1: Add the import**

In `app/(god)/schemas/page.tsx`, add below the existing registry import:

```tsx
import { BusinessUnitsTable } from "@/components/business-units-table";
```

(Keep the `import Link from "next/link";` line — `Link` is still used by the System and All-schemas sections.)

- [ ] **Step 2: Replace the Business Units table markup**

Replace the entire `<table className="w-full text-sm">...</table>` block inside the Business Units `<section>` (currently `app/(god)/schemas/page.tsx:19-40`) with:

```tsx
        <BusinessUnitsTable bus={bus} system={sel.system} />
```

The surrounding `<section>` and `<h2>Business Units</h2>` stay. The System section and All-schemas section are untouched.

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 4: Lint the touched files**

Run: `bunx eslint app/(god)/schemas/page.tsx components/business-units-table.tsx`
Expected: clean (no new `no-explicit-any` — the component uses typed props and `as { id: string }`).

- [ ] **Step 5: Smoke test (if dev server is running)**

Start `bun run dev` if not already up, then:

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3305/schemas`
Expected: `200` (authenticated) or `307` (redirect to login) — not `500`.

Manually: load `/schemas`, tick two Business Units, confirm the "Delete 2 selected" bar appears and links to `/CARMEN_SYSTEM/tb_business_unit/delete-batch?pks=...`. The confirm page shows the combined blast radius and the orphan-schema warning. (Do NOT actually confirm a delete against real data unless intended.)

- [ ] **Step 6: Commit**

```bash
git add "app/(god)/schemas/page.tsx"
git commit -m "feat: multi-select batch delete on /schemas Business Units table"
```

---

## Self-Review

**Spec coverage:**
- Client component with checkboxes + select-all + "Delete N selected" → Task 1.
- Reuse existing `delete-batch` route / combined radius / orphan warning → Task 1 link target (route unchanged) + verified on the smoke step in Task 3.
- `confirmBatchDelete` redirect to `/schemas` for BUs → Task 2.
- Page wiring, System & All-schemas sections untouched → Task 3.
- v1 no-schema-drop rule + orphan warning → unchanged backend, surfaced on confirm page.

**Placeholder scan:** none — every code step has complete code; every command has expected output.

**Type consistency:** `BusinessUnitsTable({ bus: BusinessUnit[]; system: string })` is defined in Task 1 and consumed verbatim in Task 3. `pks` shape `{ id: string }[]` is consistent between the component's `batchHref`, the test assertions, and the `delete-batch` route's `JSON.parse`. `env().systemSchemaName` matches the existing `confirmDelete` usage.
