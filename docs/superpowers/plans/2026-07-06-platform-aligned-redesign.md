# Platform-aligned Hybrid Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the god-mode admin console to carmen-platform's visual system (Inter, blue primary, cool-gray palette, collapsible sidebar, zebra tables) while preserving one deliberately distinct safety signal — a persistent live-target bar — so god-mode is never mistaken for the everyday platform.

**Architecture:** god-mode routes all styling through CSS custom-property tokens in `app/globals.css`, exposed to Tailwind v4 via `@theme inline`, and consumed by `components/ui/*` primitives. We keep the token *names* and change their *values*, so re-skinning happens at the token layer. New structural work — the sidebar shell, the safety target bar, and a 3-way theme toggle — is added on top. Icons migrate from `@phosphor-icons/react` to `lucide-react` (the platform's set).

**Tech Stack:** Next.js (this repo's fork — read `node_modules/next/dist/docs/` before touching framework APIs), React 19, Tailwind CSS v4 (CSS-based config, no `tailwind.config.*`), `next/font/google`, Vitest (jsdom for `.test.tsx`), Playwright (e2e), Bun.

**TDD note (read before starting):** Much of this plan is presentational (tokens, fonts, CSS). Pure visual changes cannot carry a meaningful failing-unit-test-first cycle; forcing snapshot tests here would be noise. So: for tasks with real logic (theme persistence — Task 5; target-bar live/local — Task 4) we write tests first. For pure token/CSS/restyle tasks, "verification" means `bun run typecheck` + `bun run lint` + the existing `bun run test` suite staying green + a visual check in the running dev server. Each such task states its exact verification commands and expected output.

## Global Constraints

_Every task's requirements implicitly include this section._

- **Port:** dev server runs on **3305** (`bun run dev` = `.env.local`). Not 3000.
- **Test runner:** `bun run test` (Vitest). **Never** `bun test`.
- **Lint is clean repo-wide** — `bun run lint` must stay clean after every task.
- **Typecheck:** `bun run typecheck` must pass after every task.
- **No pure `#000`/`#fff`** for base surfaces/text (a11y rule); the platform's near-white/near-black anchors satisfy this.
- **WCAG AA** contrast preserved: keyboard-visible focus ring, `prefers-reduced-motion` respected. Where the platform's own value fails AA (white-on-amber warning), we deviate to an AA-safe value and document it.
- **Mono font stays** — `--font-mono` = IBM Plex Mono (SQL console, IDs, timestamps). Only the sans/display faces change to Inter.
- **Do not import carmen-platform code** — it is a separate Vite/React app. We replicate the look in our own components.
- **Token names are frozen** — keep `--background`, `--surface`, `--accent`, `--danger`, etc. Change values only. This is what keeps churn low.
- **Commit** after each task with a conventional-commit message; end every commit message with the trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Branch: work happens on `feat/platform-aligned-redesign` (already created; spec already committed there).

---

## File Structure

**Modified:**
- `app/globals.css` — token values, radius, zebra helpers, retire ledger component classes, rename `folio-in`→`page-in` (Task 1)
- `app/layout.tsx` — Inter + Plex Mono fonts, theme pre-paint script, metadata (Task 1, Task 5)
- `app/(god)/layout.tsx` — **rewritten** as sidebar shell (Task 6)
- `components/ui/button.tsx`, `table.tsx`, `badge.tsx`, `page-header.tsx`, `alert.tsx`, `empty-state.tsx`, `checkbox.tsx` — restyle + icon swap (Tasks 2–3)
- `components/nav-link.tsx` — repurposed for sidebar rows (Task 6)
- `components/schema-banner.tsx` — restyle + drop rubric/vernacular (Task 3)
- `components/seal-confirm.tsx` — auto-restyles via tokens+font; label kept so tests pass (Task 3 verify only)
- 14 files importing `@phosphor-icons/react` → `lucide-react` (Task 2)
- `e2e/smoke.spec.ts`, jsdom tests referencing changed copy (Task 7)

**Created:**
- `components/target-bar.tsx` — persistent live/local safety bar (Task 4)
- `components/theme-toggle.tsx` + `lib/use-theme.ts` — 3-way theme control (Task 5)
- `components/sidebar.tsx` — the sidebar (composed by the layout) (Task 6)

**Removed:**
- `@phosphor-icons/react` dependency (Task 2)

---

## Task 1: Foundation re-skin — tokens + typography

**Files:**
- Modify: `app/globals.css` (full token blocks + `@theme inline` + `@layer` cleanup)
- Modify: `app/layout.tsx` (fonts + metadata; theme script updated later in Task 5)

**Interfaces:**
- Produces: the full platform palette under the existing token names; `--radius`, `.zebra-row`, `.page-in`. Retires `.rubric`, `.rubric-seal`, `.rule-double`, `.seal`, `.stamp-mark`. Later tasks assume these classes no longer exist and that `font-display`/`font-sans` both resolve to Inter.

- [ ] **Step 1: Replace `app/globals.css` in full**

Replace the file contents with:

```css
@import "tailwindcss";

@custom-variant dark (&:where(.dark, .dark *));

/* ------------------------------------------------------------------ */
/*  Design tokens — carmen-platform-aligned palette.                   */
/*  Token NAMES are frozen (components consume them); values track     */
/*  carmen-platform/src/index.css. Extra subtle/hover/strong variants  */
/*  are derived along the same hue. Colour semantics: accent = blue    */
/*  primary action; danger/warning/success/info = state.               */
/* ------------------------------------------------------------------ */

:root {
  --background: hsl(226 20% 98%);
  --surface: hsl(0 0% 100%);
  --surface-hover: hsl(226 15% 94%);
  --surface-muted: hsl(226 15% 95%);
  --foreground: hsl(226 30% 10%);
  --foreground-muted: hsl(226 10% 46%);
  --foreground-subtle: hsl(226 8% 60%);
  --border: hsl(226 15% 90%);
  --border-strong: hsl(226 15% 80%);
  --ring: hsl(221 61% 48%);

  --accent: hsl(221 61% 48%);
  --accent-hover: hsl(221 61% 42%);
  --accent-foreground: hsl(0 0% 100%);

  --link: hsl(221 61% 48%);
  --link-hover: hsl(221 61% 40%);

  --seal: hsl(0 84% 60%);
  --seal-hover: hsl(0 84% 52%);

  --danger: hsl(0 84% 60%);
  --danger-hover: hsl(0 84% 52%);
  --danger-foreground: hsl(0 0% 100%);
  --danger-subtle: hsl(0 84% 96%);
  --danger-subtle-foreground: hsl(0 74% 42%);
  --danger-border: hsl(0 70% 88%);

  --warning: hsl(38 92% 45%);
  --warning-foreground: hsl(38 92% 12%); /* AA deviation: dark text on amber, not platform's white */
  --warning-subtle: hsl(38 92% 94%);
  --warning-subtle-foreground: hsl(38 80% 32%);
  --warning-border: hsl(38 80% 82%);
  --warning-strong: hsl(38 92% 45%);

  --success: hsl(142 40% 40%);
  --success-hover: hsl(142 40% 34%);
  --success-subtle: hsl(142 40% 94%);
  --success-subtle-foreground: hsl(142 40% 26%);
  --success-border: hsl(142 30% 80%);

  --info: hsl(221 61% 48%);
  --info-subtle: hsl(221 61% 95%);
  --info-subtle-foreground: hsl(221 61% 38%);
  --info-border: hsl(221 50% 85%);

  --target-idle: hsl(226 10% 55%);

  --radius: 0.375rem;
  --shadow-sm: 0 1px 2px rgba(16, 24, 40, 0.06);
  --shadow-md: 0 2px 8px rgba(16, 24, 40, 0.08);
  --zebra-even: rgba(16, 24, 40, 0.015);
}

.dark {
  --background: hsl(224 71% 4%);
  --surface: hsl(222 47% 11%);
  --surface-hover: hsl(222 47% 15%);
  --surface-muted: hsl(222 47% 13%);
  --foreground: hsl(213 31% 91%);
  --foreground-muted: hsl(215 16% 60%);
  --foreground-subtle: hsl(215 14% 50%);
  --border: hsl(216 34% 17%);
  --border-strong: hsl(216 34% 24%);
  --ring: hsl(217 65% 55%);

  --accent: hsl(217 65% 55%);
  --accent-hover: hsl(217 65% 62%);
  --accent-foreground: hsl(0 0% 100%);

  --link: hsl(217 65% 68%);
  --link-hover: hsl(217 65% 76%);

  --seal: hsl(0 62% 55%);
  --seal-hover: hsl(0 62% 62%);

  --danger: hsl(0 62% 55%);
  --danger-hover: hsl(0 62% 62%);
  --danger-foreground: hsl(0 0% 100%);
  --danger-subtle: hsl(0 40% 15%);
  --danger-subtle-foreground: hsl(0 70% 80%);
  --danger-border: hsl(0 40% 30%);

  --warning: hsl(38 92% 50%);
  --warning-foreground: hsl(38 92% 10%);
  --warning-subtle: hsl(38 50% 14%);
  --warning-subtle-foreground: hsl(38 80% 70%);
  --warning-border: hsl(38 50% 30%);
  --warning-strong: hsl(38 92% 50%);

  --success: hsl(142 40% 45%);
  --success-hover: hsl(142 40% 52%);
  --success-subtle: hsl(142 40% 13%);
  --success-subtle-foreground: hsl(142 40% 72%);
  --success-border: hsl(142 30% 28%);

  --info: hsl(217 65% 55%);
  --info-subtle: hsl(217 50% 15%);
  --info-subtle-foreground: hsl(217 70% 78%);
  --info-border: hsl(217 45% 30%);

  --target-idle: hsl(215 14% 50%);

  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 2px 8px rgba(0, 0, 0, 0.4);
  --zebra-even: rgba(255, 255, 255, 0.015);
}

@theme inline {
  --color-background: var(--background);
  --color-surface: var(--surface);
  --color-surface-hover: var(--surface-hover);
  --color-surface-muted: var(--surface-muted);
  --color-foreground: var(--foreground);
  --color-foreground-muted: var(--foreground-muted);
  --color-foreground-subtle: var(--foreground-subtle);
  --color-border: var(--border);
  --color-border-strong: var(--border-strong);
  --color-ring: var(--ring);

  --color-accent: var(--accent);
  --color-accent-hover: var(--accent-hover);
  --color-accent-foreground: var(--accent-foreground);

  --color-link: var(--link);
  --color-link-hover: var(--link-hover);

  --color-danger: var(--danger);
  --color-danger-hover: var(--danger-hover);
  --color-danger-foreground: var(--danger-foreground);
  --color-danger-subtle: var(--danger-subtle);
  --color-danger-subtle-foreground: var(--danger-subtle-foreground);
  --color-danger-border: var(--danger-border);

  --color-warning: var(--warning);
  --color-warning-foreground: var(--warning-foreground);
  --color-warning-subtle: var(--warning-subtle);
  --color-warning-subtle-foreground: var(--warning-subtle-foreground);
  --color-warning-border: var(--warning-border);
  --color-warning-strong: var(--warning-strong);

  --color-success: var(--success);
  --color-success-hover: var(--success-hover);
  --color-success-subtle: var(--success-subtle);
  --color-success-subtle-foreground: var(--success-subtle-foreground);
  --color-success-border: var(--success-border);

  --color-info: var(--info);
  --color-info-subtle: var(--info-subtle);
  --color-info-subtle-foreground: var(--info-subtle-foreground);
  --color-info-border: var(--info-border);

  --color-seal: var(--seal);
  --color-seal-hover: var(--seal-hover);
  --color-target-idle: var(--target-idle);

  --radius-md: var(--radius);
  --radius-sm: calc(var(--radius) - 2px);
  --radius-lg: calc(var(--radius) + 2px);

  --font-sans: var(--font-inter);
  --font-mono: var(--font-plex-mono);
  --font-display: var(--font-inter);
}

@layer base {
  body {
    background: var(--background);
    color: var(--foreground);
    font-family: var(--font-inter), system-ui, -apple-system, sans-serif;
    font-feature-settings: "rlig" 1, "calt" 1;
    line-height: 1.5;
  }

  :focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }

  @media (prefers-reduced-motion: no-preference) {
    button:active:not(:disabled),
    a:active,
    [role="button"]:active {
      translate: 0 1px;
    }
  }

  @media (prefers-reduced-motion: no-preference) {
    main {
      animation: page-in 220ms ease-out both;
    }
    @keyframes page-in {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: none; }
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Table striping — ported from carmen-platform.                      */
/* ------------------------------------------------------------------ */
@layer components {
  .zebra-row {
    transition: background-color 150ms ease, box-shadow 150ms ease;
  }
  .zebra-row:nth-child(even) {
    background-color: var(--zebra-even);
  }
  .zebra-row:hover {
    background-color: var(--surface-hover);
  }
}
```

- [ ] **Step 2: Swap fonts + metadata in `app/layout.tsx`**

Replace the three font imports/instances and the metadata. Change the import line and font blocks:

```tsx
import type { Metadata } from "next";
import { Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// Sans + display: one grotesque, matching carmen-platform.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

// Data: IDs, timestamps, byte sizes, SQL. Kept from the prior design.
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Carmen · God Mode",
  description: "Admin console for inspecting and surgically mutating Carmen inventory data.",
};
```

Update the `<html>` className to use the new variables (drop fraunces/newsreader):

```tsx
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${plexMono.variable} h-full antialiased`}
    >
```

Leave the existing `themeScript` and body markup unchanged for now (Task 5 rewrites the script).

- [ ] **Step 3: Verify build + existing suite**

Run: `bun run typecheck`
Expected: PASS (no type errors — font var names changed but only strings).

Run: `bun run lint`
Expected: clean, no warnings/errors.

Run: `bun run test`
Expected: PASS. Components referencing removed CSS classes (`.rubric` etc.) do not error — the classes simply no longer resolve; markup is unaffected. Any test that asserts on those *class strings* would fail here — if one does, it belongs to Task 3/7; note it and continue (do not fix out of task order unless it blocks the whole suite).

- [ ] **Step 4: Visual check**

Run: `bun run dev` (port 3305), open `/schemas`.
Expected: whole app now renders in the blue/cool-gray platform palette with Inter. Layout may still show the old top-nav (rewritten in Task 6) and some section labels look plain (restyled in Task 3) — that's expected at this stage.

- [ ] **Step 5: Commit**

```bash
git add app/globals.css app/layout.tsx
git commit -m "feat(ui): adopt carmen-platform palette + Inter typography

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Icon migration — phosphor → lucide

**Files:**
- Modify: `package.json` (swap dependency)
- Modify (14): `app/(god)/layout.tsx`, `app/(god)/[schema]/[table]/page.tsx`, `app/(god)/[schema]/tables/page.tsx`, `app/(god)/schemas/page.tsx`, `app/(god)/audit/page.tsx`, `app/login/login-tabs.tsx`, `components/sql-console.tsx`, `components/clusters-table.tsx`, `components/business-units-table.tsx`, `components/platform-migrations.tsx`, `components/row-grid.tsx`, `components/ui/alert.tsx`, `components/ui/empty-state.tsx`, `components/ui/checkbox.tsx`

**Interfaces:**
- Produces: all icon imports come from `lucide-react`; the `PhosphorIcon` type alias is replaced by `LucideIcon`. `app/(god)/layout.tsx` is edited only minimally here (import swap) since it is fully rewritten in Task 6 — if executing Task 6 first, skip its edit here.

**Name mapping (phosphor → lucide):**

| phosphor | lucide |
|---|---|
| `SignOut` | `LogOut` |
| `Plus` | `Plus` |
| `TerminalWindow` | `SquareTerminal` |
| `CaretRight` | `ChevronRight` |
| `Funnel` | `Filter` |
| `ArrowRight` | `ArrowRight` |
| `Play` | `Play` |
| `CheckCircle` | `CheckCircle2` |
| `Trash` | `Trash2` |
| `Warning` | `TriangleAlert` |
| `XCircle` | `CircleX` |
| `Info` | `Info` |
| `PencilSimple` | `Pencil` |
| `Check` | `Check` |
| `ArrowCounterClockwise` | `RotateCcw` |
| `Prohibit` | `Ban` |
| `Table` (as `TableIcon`) | `Table` (as `TableIcon`) |
| type `Icon as PhosphorIcon` | type `LucideIcon` |

- [ ] **Step 1: Install lucide, remove phosphor**

Run:
```bash
bun remove @phosphor-icons/react && bun add lucide-react
```
Expected: `lucide-react` appears in `package.json` dependencies; `@phosphor-icons/react` gone.

- [ ] **Step 2: Migrate each file's import + JSX**

In every file above, change the import source `"@phosphor-icons/react/dist/ssr"` → `"lucide-react"`, rename each icon per the table, and rename usages in JSX. Lucide has no SSR subpath — import directly from `"lucide-react"`. Example for `components/row-grid.tsx`:

```tsx
// before
import { PencilSimple, Trash } from "@phosphor-icons/react/dist/ssr";
// after
import { Pencil, Trash2 } from "lucide-react";
```
…and in JSX `<PencilSimple .../>` → `<Pencil .../>`, `<Trash .../>` → `<Trash2 .../>`.

- [ ] **Step 3: Fix the two type-alias files + the `weight` prop**

`components/ui/empty-state.tsx`:
```tsx
// before
import { Table as TableIcon, /* ... */ } from "@phosphor-icons/react/dist/ssr";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
// after
import { Table as TableIcon, /* ... */ } from "lucide-react";
import type { LucideIcon } from "lucide-react";
```
Change `const Icon: PhosphorIcon = icons[icon];` → `const Icon: LucideIcon = icons[icon];`.

`components/ui/alert.tsx`: same type swap (`CircleX`, `TriangleAlert`, `CheckCircle2`, `Info`), and **remove the phosphor-only `weight="fill"` prop** on the `<Icon />` (lucide has no `weight`). The line:
```tsx
<Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" weight="fill" />
```
becomes:
```tsx
<Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
```

- [ ] **Step 4: Verify no phosphor references remain**

Run: `grep -rn "@phosphor-icons\|weight=\"fill\"\|PhosphorIcon" app components`
Expected: no output.

Run: `bun run typecheck` → PASS. `bun run lint` → clean. `bun run test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(ui): migrate icons from phosphor to lucide-react

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Restyle shared components + retire ledger utilities in markup

**Files:**
- Modify: `components/ui/page-header.tsx` (drop `.rubric`/`font-display`)
- Modify: `components/ui/table.tsx` (zebra rows)
- Modify: `components/ui/button.tsx` (success foreground token)
- Modify: `components/schema-banner.tsx` (drop `.rubric`/`font-display`/"Register")
- Verify-only: `components/seal-confirm.tsx` (auto-restyles; label kept)
- Grep-sweep: any remaining raw `rubric`/`rule-double`/`stamp-mark`/`font-display` class usages in `app/**` pages

**Interfaces:**
- Consumes: tokens + Inter from Task 1.
- Produces: no component references the retired CSS classes; `PageHeader`/`SectionLabel` keep the same props/signatures (`rubric?`, `title`, `lede?`, `actions?`), only internal markup changes; `TBody` rows carry `.zebra-row`.

- [ ] **Step 1: Restyle `components/ui/page-header.tsx`**

Replace the `.rubric` and `font-display` usages with plain platform-style labels (Inter, uppercase, tracked, muted). Keep the exported `PageHeader` + `SectionLabel` signatures identical:

```tsx
import { cn } from "@/lib/cn";

/** Page heading: an optional eyebrow label, a title, an optional lede, and right-aligned actions. */
export function PageHeader({
  rubric,
  title,
  lede,
  actions,
  className,
}: {
  rubric?: string;
  title: string;
  lede?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-6 border-b border-border pb-4", className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {rubric && (
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-foreground-muted">
              {rubric}
            </p>
          )}
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          {lede && (
            <p className="mt-1.5 max-w-prose text-sm text-foreground-muted">{lede}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/** Section label inside a page. */
export function SectionLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p className={cn("mb-3 text-xs font-semibold uppercase tracking-wider text-foreground-muted", className)}>
      {children}
    </p>
  );
}
```

- [ ] **Step 2: Add zebra striping to `components/ui/table.tsx`**

In the `TR` component, add the `zebra-row` class so table rows stripe + hover consistently. Change:
```tsx
export function TR({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("zebra-row border-b border-border", className)} {...props} />;
}
```
And in `TBody`, remove the now-redundant hover rule (zebra-row handles hover) — change its className to just `cn(className)` or drop the `[&_tr]:hover:bg-surface-hover` fragment:
```tsx
export function TBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn(className)} {...props} />;
}
```

- [ ] **Step 3: Fix `button.tsx` success variant token**

In `components/ui/button.tsx`, the `success` variant uses `text-white`; make it token-driven for dark-mode correctness. Change:
```tsx
  success:
    "bg-success text-accent-foreground hover:bg-success-hover shadow-sm",
```
(`--accent-foreground` is white in both themes; this removes the hardcoded `text-white`.)

- [ ] **Step 4: Restyle `components/schema-banner.tsx`**

Drop `.rubric` + `font-display`, remove the "Register" vernacular, keep the safety message and the System/Tenant colour semantics:

```tsx
import { env } from "@/lib/env";
import { cn } from "@/lib/cn";

/**
 * Persistent context band showing which schema the operator is in.
 * SYSTEM renders as a danger fill, TENANT as an amber fill. Status is never
 * colour-alone — always a label + path + words.
 */
export function SchemaBanner({ schema }: { schema: string | null }) {
  if (!schema) return null;
  const isSystem = schema === env().systemSchemaName;

  return (
    <div
      role="status"
      className={cn(
        "flex items-center gap-3 px-4 py-2 text-sm",
        isSystem
          ? "bg-danger text-danger-foreground"
          : "bg-warning-strong text-warning-foreground",
      )}
    >
      <span
        className={cn(
          "rounded-sm px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]",
          isSystem ? "bg-black/25" : "bg-black/15",
        )}
      >
        {isSystem ? "System" : "Tenant"}
      </span>

      <span className="flex min-w-0 items-center gap-1.5 font-mono text-[13px]">
        <span aria-hidden="true" className="opacity-60">▸</span>
        <span className="truncate">{schema}</span>
      </span>

      <span className="ml-auto shrink-0 text-xs font-medium uppercase tracking-wider opacity-80">
        <span className="hidden sm:inline">Changes are permanent</span>
      </span>
    </div>
  );
}
```

- [ ] **Step 5: Sweep pages for remaining ledger classes**

Run: `grep -rn "rubric\|rule-double\|stamp-mark\|font-display\|\bseal\b" app components --include=*.tsx | grep -v "seal-confirm\|SealConfirm"`
For each remaining hit in an `app/**` page (e.g. `app/(god)/schemas/page.tsx`, `app/(god)/audit/page.tsx`, `app/login/page.tsx`): replace `className="rubric ..."` with `className="text-xs font-semibold uppercase tracking-wider text-foreground-muted ..."`, `rule-double` with `border-b border-border`, and drop `font-display` (Inter is the default). Leave `seal-confirm.tsx`'s internal `border-seal`/`bg-seal`/`text-seal` — those are tokens, not the retired `.seal` class, and restyle correctly.

- [ ] **Step 6: Verify**

Run: `grep -rn "\brubric\b\|rule-double\|stamp-mark\|font-display" app components --include=*.tsx`
Expected: no output.

Run: `bun run typecheck` → PASS. `bun run lint` → clean. `bun run test` → PASS (seal-confirm + confirm-delete tests still pass — the seal button `aria-label` "Seal & execute" is unchanged, matching `{ name: /seal/i }`).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(ui): restyle shared components, retire ledger utilities

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Persistent safety target bar

**Files:**
- Create: `components/target-bar.tsx`
- Create: `components/__tests__/target-bar.test.tsx`

**Interfaces:**
- Consumes: `dbTarget()` from `lib/db-target.ts` returning `{ host: string; isLocal: boolean; label: "LOCAL" | "LIVE" }`.
- Produces: `export function TargetBar(): JSX.Element` — a server component that reads `dbTarget()` and renders the bar. Consumed by the layout in Task 6.

- [ ] **Step 1: Write the failing test**

`components/__tests__/target-bar.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { vi, test, expect, afterEach } from "vitest";

const mockTarget = vi.fn();
vi.mock("@/lib/db-target", () => ({ dbTarget: () => mockTarget() }));

afterEach(() => vi.clearAllMocks());

async function mount() {
  const { TargetBar } = await import("@/components/target-bar");
  render(<TargetBar />);
}

test("LIVE target shows the permanent-writes warning", async () => {
  mockTarget.mockReturnValue({ host: "db.prod:5432", isLocal: false, label: "LIVE" });
  await mount();
  expect(screen.getByText(/every write is permanent/i)).toBeInTheDocument();
  expect(screen.getByText("db.prod:5432")).toBeInTheDocument();
  expect(screen.getByText("LIVE")).toBeInTheDocument();
});

test("LOCAL target is calm — no permanent warning", async () => {
  mockTarget.mockReturnValue({ host: "localhost:5432", isLocal: true, label: "LOCAL" });
  await mount();
  expect(screen.queryByText(/every write is permanent/i)).not.toBeInTheDocument();
  expect(screen.getByText("LOCAL")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test target-bar`
Expected: FAIL — cannot resolve `@/components/target-bar`.

- [ ] **Step 3: Implement `components/target-bar.tsx`**

```tsx
import { TriangleAlert } from "lucide-react";
import { dbTarget } from "@/lib/db-target";
import { cn } from "@/lib/cn";

/**
 * The one deliberately un-platform-like element: a persistent bar naming the
 * database this console writes to. LOCAL is calm; LIVE is loud (danger fill +
 * "every write is permanent"), so god-mode is never mistaken for the everyday
 * platform. Meaning is carried by words + icon, never colour alone.
 */
export function TargetBar() {
  const target = dbTarget();
  const live = !target.isLocal;

  return (
    <div
      role="status"
      className={cn(
        "flex h-8 items-center gap-2 px-4 text-xs sm:px-6",
        live
          ? "bg-danger text-danger-foreground"
          : "bg-surface-muted text-foreground-muted",
      )}
    >
      {live && <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      <span className="font-semibold uppercase tracking-wider">{target.label}</span>
      <span aria-hidden="true" className="opacity-50">·</span>
      <span className="truncate font-mono">{target.host}</span>
      {live && (
        <span className="ml-auto hidden shrink-0 font-medium uppercase tracking-wider sm:inline">
          Every write is permanent
        </span>
      )}
      <span className="sr-only">
        {live ? "Live target — every write is permanent" : "Local target"}
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test target-bar`
Expected: PASS (both tests).

- [ ] **Step 5: Verify build**

Run: `bun run typecheck` → PASS. `bun run lint` → clean.

- [ ] **Step 6: Commit**

```bash
git add components/target-bar.tsx components/__tests__/target-bar.test.tsx
git commit -m "feat(ui): persistent live-target safety bar

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Theme system — light / dark / system toggle

**Files:**
- Create: `lib/use-theme.ts` (client hook)
- Create: `components/theme-toggle.tsx` (client component)
- Modify: `app/layout.tsx` (pre-paint script reads stored choice)
- Create: `components/__tests__/use-theme.test.tsx`

**Interfaces:**
- Produces:
  - `type ThemePref = "light" | "dark" | "system"`
  - `useTheme(): { pref: ThemePref; setPref: (p: ThemePref) => void }` — persists to `localStorage["theme"]` and applies the `.dark` class on `<html>`.
  - `export function ThemeToggle(): JSX.Element` — cycles light→dark→system, shows the matching lucide icon (`Sun`/`Moon`/`Monitor`). Consumed by the sidebar footer in Task 6.

- [ ] **Step 1: Write the failing test**

`components/__tests__/use-theme.test.tsx`:
```tsx
// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import { beforeEach, test, expect } from "vitest";
import { useTheme } from "@/lib/use-theme";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});

test("setPref('dark') stores the choice and adds the dark class", () => {
  const { result } = renderHook(() => useTheme());
  act(() => result.current.setPref("dark"));
  expect(localStorage.getItem("theme")).toBe("dark");
  expect(document.documentElement.classList.contains("dark")).toBe(true);
});

test("setPref('light') removes the dark class", () => {
  document.documentElement.classList.add("dark");
  const { result } = renderHook(() => useTheme());
  act(() => result.current.setPref("light"));
  expect(localStorage.getItem("theme")).toBe("light");
  expect(document.documentElement.classList.contains("dark")).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test use-theme`
Expected: FAIL — cannot resolve `@/lib/use-theme`.

- [ ] **Step 3: Implement `lib/use-theme.ts`**

```tsx
"use client";
import { useCallback, useEffect, useState } from "react";

export type ThemePref = "light" | "dark" | "system";

function systemPrefersDark(): boolean {
  return typeof window !== "undefined"
    && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function apply(pref: ThemePref) {
  const dark = pref === "dark" || (pref === "system" && systemPrefersDark());
  document.documentElement.classList.toggle("dark", dark);
}

export function useTheme(): { pref: ThemePref; setPref: (p: ThemePref) => void } {
  const [pref, setPrefState] = useState<ThemePref>("system");

  useEffect(() => {
    const stored = localStorage.getItem("theme") as ThemePref | null;
    if (stored === "light" || stored === "dark" || stored === "system") {
      setPrefState(stored);
    }
  }, []);

  const setPref = useCallback((p: ThemePref) => {
    setPrefState(p);
    localStorage.setItem("theme", p);
    apply(p);
  }, []);

  return { pref, setPref };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test use-theme`
Expected: PASS.

- [ ] **Step 5: Implement `components/theme-toggle.tsx`**

```tsx
"use client";
import { Sun, Moon, Monitor } from "lucide-react";
import { useTheme, type ThemePref } from "@/lib/use-theme";

const NEXT: Record<ThemePref, ThemePref> = { light: "dark", dark: "system", system: "light" };
const ICON = { light: Sun, dark: Moon, system: Monitor };
const LABEL = { light: "Light", dark: "Dark", system: "System" };

/** Cycles light → dark → system. Icon + label reflect the current choice. */
export function ThemeToggle({ showLabel = true }: { showLabel?: boolean }) {
  const { pref, setPref } = useTheme();
  const Icon = ICON[pref];
  return (
    <button
      type="button"
      onClick={() => setPref(NEXT[pref])}
      aria-label={`Theme: ${LABEL[pref]}. Switch to ${LABEL[NEXT[pref]]}.`}
      className="inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-foreground-muted transition-colors hover:bg-surface-hover hover:text-foreground"
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      {showLabel && <span>{LABEL[pref]}</span>}
    </button>
  );
}
```

- [ ] **Step 6: Update the pre-paint script in `app/layout.tsx`**

Replace the `themeScript` constant so it honours the stored choice (falling back to system), avoiding a flash:

```tsx
const themeScript = `
(function () {
  try {
    var pref = localStorage.getItem("theme");
    var systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    var dark = pref === "dark" || ((pref === "system" || !pref) && systemDark);
    if (dark) document.documentElement.classList.add("dark");
  } catch (e) {}
})();
`;
```

- [ ] **Step 7: Verify**

Run: `bun run test use-theme` → PASS. `bun run typecheck` → PASS. `bun run lint` → clean.

- [ ] **Step 8: Commit**

```bash
git add lib/use-theme.ts components/theme-toggle.tsx components/__tests__/use-theme.test.tsx app/layout.tsx
git commit -m "feat(ui): light/dark/system theme toggle with persistence

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Sidebar shell — rewrite `app/(god)/layout.tsx`

**Files:**
- Create: `components/sidebar.tsx` (client — collapse state + active route + mobile drawer)
- Rewrite: `app/(god)/layout.tsx` (server — composes sidebar + target bar + main)
- Rewrite: `components/nav-link.tsx` (sidebar row: icon + label, active state)
- Create: `components/__tests__/nav-link.test.tsx`

**Interfaces:**
- Consumes: `TargetBar` (Task 4), `ThemeToggle` (Task 5), `logout` from `@/server/auth`, lucide icons.
- Produces:
  - `nav-link.tsx`: `export function NavLink({ href, label, icon: Icon, collapsed }: { href: string; label: string; icon: LucideIcon; collapsed?: boolean }): JSX.Element`
  - `sidebar.tsx`: `export function Sidebar({ items }: { items: { href: string; label: string; icon: LucideIcon }[] }): JSX.Element` — renders brand, nav, footer (ThemeToggle + logout), collapse toggle, and a mobile drawer trigger.

- [ ] **Step 1: Write the failing test for `NavLink`**

`components/__tests__/nav-link.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { vi, test, expect } from "vitest";
import { Database } from "lucide-react";

vi.mock("next/navigation", () => ({ usePathname: () => "/schemas/public" }));

test("marks the row active when the pathname is under its href", async () => {
  const { NavLink } = await import("@/components/nav-link");
  render(<NavLink href="/schemas" label="Schemas" icon={Database} />);
  expect(screen.getByRole("link", { name: /schemas/i })).toHaveAttribute("aria-current", "page");
});

test("is not active for an unrelated href", async () => {
  const { NavLink } = await import("@/components/nav-link");
  render(<NavLink href="/clusters" label="Clusters" icon={Database} />);
  expect(screen.getByRole("link", { name: /clusters/i })).not.toHaveAttribute("aria-current");
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `bun run test nav-link`
Expected: FAIL — current `NavLink` takes `children`, not `label`/`icon`; assertion on `aria-current` may still pass for test 1 but test signature mismatch/TS should flag. (If it passes accidentally, proceed — Step 4 makes intent explicit.)

- [ ] **Step 3: Rewrite `components/nav-link.tsx`**

```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

/** Sidebar navigation row. Active when the pathname equals or is under `href`. */
export function NavLink({
  href,
  label,
  icon: Icon,
  collapsed = false,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  collapsed?: boolean;
}) {
  const pathname = usePathname() ?? "";
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      title={collapsed ? label : undefined}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        collapsed && "justify-center px-2",
        active
          ? "bg-surface-hover text-foreground"
          : "text-foreground-muted hover:bg-surface-hover hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test nav-link`
Expected: PASS (both tests).

- [ ] **Step 5: Implement `components/sidebar.tsx`**

```tsx
"use client";
import { useState } from "react";
import Link from "next/link";
import { PanelLeftClose, PanelLeft, LogOut, Menu, X, type LucideIcon } from "lucide-react";
import { logout } from "@/server/auth";
import { NavLink } from "@/components/nav-link";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/cn";

export type NavItem = { href: string; label: string; icon: LucideIcon };

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <Link href="/schemas" className="flex items-center gap-2 px-3 py-4" aria-label="Carmen God Mode — home">
      <span className="text-lg font-bold tracking-tight text-foreground">CARMEN</span>
      {!collapsed && (
        <span className="rounded bg-danger px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-danger-foreground">
          God Mode
        </span>
      )}
    </Link>
  );
}

function Rail({ items, collapsed }: { items: NavItem[]; collapsed: boolean }) {
  return (
    <nav className="flex flex-1 flex-col gap-1 px-2" aria-label="Primary">
      {items.map((it) => (
        <NavLink key={it.href} href={it.href} label={it.label} icon={it.icon} collapsed={collapsed} />
      ))}
    </nav>
  );
}

function Footer({ collapsed }: { collapsed: boolean }) {
  return (
    <div className={cn("flex flex-col gap-1 border-t border-border p-2", collapsed && "items-center")}>
      <ThemeToggle showLabel={!collapsed} />
      <form action={logout}>
        <button
          type="submit"
          className={cn(
            "inline-flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-foreground-muted transition-colors hover:bg-surface-hover hover:text-foreground",
            collapsed && "justify-center px-2",
          )}
        >
          <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
          {!collapsed && <span>Log out</span>}
        </button>
      </form>
    </div>
  );
}

export function Sidebar({ items }: { items: NavItem[] }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Desktop rail */}
      <aside
        className={cn(
          "hidden shrink-0 flex-col border-r border-border bg-surface md:flex",
          "transition-[width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
          collapsed ? "w-16" : "w-60",
        )}
      >
        <Brand collapsed={collapsed} />
        <Rail items={items} collapsed={collapsed} />
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="mx-2 mb-1 inline-flex items-center justify-center rounded-md p-2 text-foreground-subtle transition-colors hover:bg-surface-hover hover:text-foreground"
        >
          {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
        <Footer collapsed={collapsed} />
      </aside>

      {/* Mobile trigger */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation"
        className="fixed left-3 top-3 z-40 inline-flex items-center justify-center rounded-md border border-border bg-surface p-2 text-foreground md:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} aria-hidden="true" />
          <div className="absolute left-0 top-0 flex h-full w-64 flex-col border-r border-border bg-surface">
            <div className="flex items-center justify-between">
              <Brand collapsed={false} />
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close navigation"
                className="mr-2 rounded-md p-2 text-foreground-subtle hover:bg-surface-hover hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div onClick={() => setMobileOpen(false)}>
              <Rail items={items} collapsed={false} />
            </div>
            <Footer collapsed={false} />
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 6: Rewrite `app/(god)/layout.tsx`**

```tsx
import { Database, Boxes, ScrollText, GitBranch } from "lucide-react";
import { Sidebar, type NavItem } from "@/components/sidebar";
import { TargetBar } from "@/components/target-bar";

const NAV: NavItem[] = [
  { href: "/schemas", label: "Schemas", icon: Database },
  { href: "/clusters", label: "Clusters", icon: Boxes },
  { href: "/audit", label: "Audit", icon: ScrollText },
  { href: "/platform-migrations", label: "Migrations", icon: GitBranch },
];

export default function GodLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <Sidebar items={NAV} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TargetBar />
        <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 md:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Verify build, tests, and visuals**

Run: `bun run typecheck` → PASS. `bun run lint` → clean. `bun run test` → PASS.
Run: `bun run dev`; visit `/schemas`, `/clusters`, `/audit`, `/platform-migrations`. Verify: sidebar with 4 items, active highlight tracks the route, collapse toggle narrows to icons, target bar sits above content, theme toggle cycles light/dark/system, mobile drawer opens/closes (narrow the window). Verify keyboard focus rings are visible on nav + toggle + logout.

- [ ] **Step 8: Commit**

```bash
git add app/(god)/layout.tsx components/sidebar.tsx components/nav-link.tsx components/__tests__/nav-link.test.tsx
git commit -m "feat(ui): collapsible sidebar shell with target bar + theme toggle

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Copy, tests & e2e reconciliation + full verification

**Files:**
- Modify: `e2e/smoke.spec.ts` (line 6 asserts `getByText("Register")`)
- Modify: any jsdom test that asserts on retired copy/classes (from Task 1/3 notes)
- Sweep: remaining ledger vernacular in `app/**` pages

**Interfaces:** none produced — this task reconciles copy and gets the whole suite green.

- [ ] **Step 1: Update `e2e/smoke.spec.ts`**

Line 6 currently: `await expect(page.getByText("Register")).toBeVisible();`
The brand no longer says "Register". Change it to assert the new masthead + nav:
```ts
await expect(page.getByText("CARMEN")).toBeVisible();
await expect(page.getByRole("link", { name: "Schemas" })).toBeVisible();
```
Then scan the rest of `e2e/smoke.spec.ts` for `"Record"` / `"Amendments"` nav assertions and rename to `"Audit"` / `"Migrations"`.

- [ ] **Step 2: Sweep pages for remaining vernacular**

Run: `grep -rn "Register\|Amendments\|\bRecord\b\|\bfolio\b" app --include=*.tsx`
For user-facing copy hits (headings, `rubric` props, aria-labels), replace with plain terms: "Record" → "Audit", "Amendments" → "Migrations", "Register"/"folio" → context-appropriate plain word ("page"/"schema"). Ignore matches that are database/domain identifiers (e.g. an `audit` table column literally named in SQL) — only change human-facing UI strings. Note in the commit which were skipped and why.

- [ ] **Step 3: Run the jsdom suite and fix stragglers**

Run: `bun run test`
Expected: PASS. If any `.test.tsx` fails asserting on retired copy/classes, update the assertion to the new copy/markup — **do not delete coverage**, only update the expected string.

- [ ] **Step 4: Run e2e**

Run: `node_modules/.bin/playwright test`
Expected: PASS (auto-starts/reuses the dev server on 3305). Fix any remaining text-assertion drift.

- [ ] **Step 5: a11y contrast verification**

For the new palette, verify WCAG AA (4.5:1 body / 3:1 large & UI) for these pairs in **both** themes: `--foreground-muted` on `--surface`, `--danger-foreground` on `--danger` (target bar), `--warning-foreground` on `--warning-strong` (schema banner tenant), `--danger-subtle-foreground` on `--danger-subtle`. Use any contrast checker (e.g. paste the resolved hex into a WCAG tool). If a pair fails, nudge the `*-foreground`/`*-subtle-foreground` lightness in `app/globals.css` until it passes, and re-run typecheck/lint. Record the four ratios in the commit body.

- [ ] **Step 6: Full verification gate**

Run all, expect green:
```bash
bun run typecheck && bun run lint && bun run test
node_modules/.bin/playwright test
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "test(ui): reconcile copy, nav labels, e2e for platform-aligned redesign

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Follow-up — update design-language memory

**Files:** (no repo code) auto-memory at the user's memory dir.

- [ ] **Step 1: Update the `design-language-ledger` memory**

Update `~/.claude/projects/-Users-samutpra-GitHub-carmensoftware-organize-carmen-inventory-god-mode/memory/design-language-ledger.md` to record that the Ledger identity is **retired for chrome** in favour of the carmen-platform-aligned hybrid: Inter, blue primary, cool-gray palette, collapsible sidebar, zebra tables — with **one preserved distinctive element**, the persistent live-target safety bar (`components/target-bar.tsx`), plus the retained type-to-confirm/seal ceremony (`components/seal-confirm.tsx`). Keep the `MEMORY.md` index line pointing at the same file; update its hook text. Link `[[design-language-ledger]]` from any related memory if present.

- [ ] **Step 2: No commit** (memory lives outside the repo).

---

## Self-Review

**1. Spec coverage:**
- Foundation tokens/values → Task 1 ✓
- Fonts (Inter + keep Plex Mono) → Task 1 ✓
- Radius + zebra → Task 1 (tokens/CSS) + Task 3 (applied to `TR`) ✓
- Retire ledger utilities → Task 1 (CSS) + Task 3 (markup sweep) ✓
- Sidebar shell (collapsible, 4 items, mobile, footer) → Task 6 ✓
- lucide icons → Task 2 ✓
- Safety target bar (LIVE loud / LOCAL calm) → Task 4 ✓
- Keep confirm/seal-confirm friction → Task 3 (verify-only, label preserved) ✓
- Component restyle list → Tasks 2–3 ✓
- Copy/vernacular → Task 7 ✓
- Theme toggle (light/dark/system) → Task 5 ✓
- Testing/e2e updates → Task 7 ✓
- a11y AA verification → Task 7 Step 5 ✓
- Memory follow-up → Task 8 ✓
No gaps.

**2. Placeholder scan:** No "TBD"/"handle appropriately"/"similar to Task N". Every code step shows full code or an exact before→after edit. Icon migration uses an explicit name table.

**3. Type consistency:** `NavItem` type defined in `sidebar.tsx` and imported by the layout (Task 6). `NavLink` new signature (`href`/`label`/`icon`/`collapsed`) is defined in Task 6 Step 3 and consumed by `sidebar.tsx` Step 5 + tested in Step 1 — consistent. `ThemePref`/`useTheme` defined in Task 5 and consumed by `ThemeToggle` (Task 5) + `Sidebar` footer (Task 6) — consistent. `TargetBar` (no args) defined Task 4, consumed Task 6 — consistent. `dbTarget()` shape matches `lib/db-target.ts` as read.
```
