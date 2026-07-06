# Platform-aligned Hybrid Redesign

**Date:** 2026-07-06
**Status:** Approved (direction) — pending spec review
**Supersedes:** the "The Register of Carmen" (Ledger) design language for god-mode chrome

## Motivation

god-mode is the admin console that sits beside `carmen-platform`. Operators who
use both should recognise them as one product family. The current Ledger
identity (aged-paper, serif, wax-seal) is distinctive but reads as a different
product. This redesign adopts carmen-platform's visual system so god-mode looks
like a sibling of the platform.

**But god-mode is far more dangerous than the platform** — it writes a live
Postgres, every write is permanent, and it can `DROP SCHEMA` / cascade-delete.
Making it look *identical* to the everyday platform would invite platform-level
casualness in a tool where mistakes are irreversible on prod. So this is a
**Hybrid**: full adoption of the platform's look, with **one deliberately
distinct, always-visible safety signal** so god-mode is never mistaken for the
platform.

## Design principles

1. **Same family, not same tool.** Adopt the platform's palette, typography,
   radius, tables, and sidebar shell. A returning platform user should feel at
   home instantly.
2. **Safety is the exception to consistency.** The live-target indicator and
   destructive-flow friction stay visually loud and god-mode-specific. This is
   the one place we spend distinctiveness.
3. **Token-driven, minimal churn.** Keep god-mode's existing token *names* and
   `components/ui/*` structure; change *values*. Re-skinning happens through the
   token layer, not a per-component rewrite.

## Architecture

### A. Foundation — `app/globals.css`

Keep the existing token-name architecture (`--background`, `--surface`,
`--accent`, `--danger`, …) and the `@theme inline` block. **Change only the
values** to carmen-platform's palette. Because every component consumes tokens,
this re-skins the whole app.

Anchor values are taken verbatim from `carmen-platform/src/index.css`; the
extra god-mode tokens (subtle/hover/strong variants god-mode has and the
platform does not) are *derived* along the same hue.

**Light (`:root`) — proposed values**

| god-mode token | new value | source |
|---|---|---|
| `--background` | `hsl(226 20% 98%)` | platform `--background` |
| `--surface` | `hsl(0 0% 100%)` | platform `--card` (white) |
| `--surface-hover` | `hsl(226 15% 94%)` | platform `--secondary` |
| `--surface-muted` | `hsl(226 15% 95%)` | platform `--muted` |
| `--foreground` | `hsl(226 30% 10%)` | platform `--foreground` |
| `--foreground-muted` | `hsl(226 10% 46%)` | platform `--muted-foreground` |
| `--foreground-subtle` | `hsl(226 8% 60%)` | derived |
| `--border` | `hsl(226 15% 90%)` | platform `--border` |
| `--border-strong` | `hsl(226 15% 80%)` | derived |
| `--ring` | `hsl(221 61% 48%)` | platform `--ring` (blue) |
| `--accent` (primary action) | `hsl(221 61% 48%)` | platform `--primary` |
| `--accent-hover` | `hsl(221 61% 42%)` | derived |
| `--accent-foreground` | `hsl(0 0% 100%)` | platform `--primary-foreground` |
| `--link` | `hsl(221 61% 48%)` | platform `--primary` |
| `--link-hover` | `hsl(221 61% 40%)` | derived |
| `--danger` (+ `--seal`) | `hsl(0 84% 60%)` | platform `--destructive` |
| `--danger-hover` | `hsl(0 84% 52%)` | derived |
| `--danger-foreground` | `hsl(0 0% 100%)` | platform `--destructive-foreground` |
| `--danger-subtle` | `hsl(0 84% 96%)` | derived |
| `--danger-subtle-foreground` | `hsl(0 74% 42%)` | derived |
| `--danger-border` | `hsl(0 70% 88%)` | derived |
| `--warning` | `hsl(38 92% 45%)` | platform `--warning` |
| `--warning-foreground` | `hsl(0 0% 100%)` | platform `--warning-foreground` |
| `--warning-subtle` | `hsl(38 92% 94%)` | derived |
| `--warning-subtle-foreground` | `hsl(38 80% 32%)` | derived |
| `--warning-border` | `hsl(38 80% 82%)` | derived |
| `--warning-strong` | `hsl(38 92% 45%)` | platform `--warning` |
| `--success` | `hsl(142 40% 40%)` | platform `--success` |
| `--success-hover` | `hsl(142 40% 34%)` | derived |
| `--success-subtle` | `hsl(142 40% 94%)` | derived |
| `--success-subtle-foreground` | `hsl(142 40% 28%)` | derived |
| `--success-border` | `hsl(142 30% 80%)` | derived |
| `--info` | `hsl(221 61% 48%)` | platform `--info` |
| `--info-subtle` | `hsl(221 61% 95%)` | derived |
| `--info-subtle-foreground` | `hsl(221 61% 38%)` | derived |
| `--info-border` | `hsl(221 50% 85%)` | derived |
| `--target-idle` | `hsl(226 10% 55%)` | derived |

**Dark (`.dark`)** — same mapping, anchored on the platform's `.dark` block
(`--background: 224 71% 4%`, `--primary: 217 65% 55%`, `--destructive: 0 62% 40%`,
etc.); god-mode's extra variants derived along the same hues.

**New in `@theme inline`:**
- `--radius: 0.375rem` exposed as `--radius` and used via `rounded-md` etc.
- `--color-shadow-sm` / `--color-shadow-md` following platform's shadow tokens.

**Retire from `@layer components`:** `.rubric`, `.rubric-seal`, `.rule-double`,
`.seal`, `.stamp-mark`, and the `folio-in` masthead-vernacular framing. Keep a
page-load fade (rename `folio-in` → `page-in`, same reduced-motion guard) and
the tactile `:active` press. Add platform's `.zebra-row` striping + sticky
column helpers (ported from `carmen-platform/src/index.css`).

### B. Typography — `app/layout.tsx`

- Replace `Fraunces` + `Newsreader` with **`Inter`** (weights 400/500/600/700)
  via `next/font/google`, bound to `--font-sans` (and used as `--font-display`).
- **Keep `IBM_Plex_Mono`** bound to `--font-mono` — god-mode shows SQL, IDs,
  timestamps and byte sizes; the platform has no mono but god-mode needs one.
- `body` font-family → Inter (drop the serif fallback chain; use
  `Inter, system-ui, -apple-system, sans-serif` like the platform).
- Update `metadata.title` from "Carmen · The Register" → "Carmen · God Mode".

### C. Sidebar shell — `app/(god)/layout.tsx` (rewrite)

Replace the top-nav masthead with a **collapsible left sidebar** modelled on
`carmen-platform/src/components/Sidebar.tsx`, but simpler (4 items, no groups):

- **Top:** brand ("CARMEN" + small "God Mode" label).
- **Nav:** icon + label rows, active = `bg-surface-hover`/secondary +
  `text-foreground`, inactive = `text-foreground-muted` hover `bg-accent/5`.
  Items: **Schemas** (`/schemas`), **Clusters** (`/clusters`),
  **Audit** (`/audit`), **Migrations** (`/platform-migrations`).
- **Collapse:** a `PanelLeft`/`PanelLeftClose` toggle; collapsed = icons only
  (labels via tooltip). Reuse platform's `.sidebar-transition` timing.
- **Footer:** theme toggle (light/dark/system) + logout. User identity row if
  cheaply available; otherwise logout button alone.
- **Mobile:** off-canvas drawer/sheet with a hamburger trigger (platform uses a
  `Sheet`; we implement an equivalent — no new Radix dep required unless we
  choose one).
- **Icons:** switch `@phosphor-icons/react` → **`lucide-react`** (platform's set)
  for family consistency. Add `lucide-react`, remove `@phosphor-icons/react`
  once all usages are migrated.

### D. Safety signal (the Hybrid core)

- A **persistent target bar** rendered above `<main>`, spanning the content
  column, visible regardless of sidebar collapse state.
  - **Local:** quiet — muted text, "LOCAL · `<host>`".
  - **Live:** loud — `--danger` background/border, warning-triangle icon,
    "⚠ LIVE — every write is permanent · `<host>`". This is the single element
    that stays deliberately un-platform-like.
- Keep the destructive-flow friction: `confirm-delete` and `seal-confirm`
  (type-to-confirm) retain their behaviour. Restyle to platform look
  (destructive button, 6px radius) and drop the wax-seal metaphor/wording. The
  `seal-confirm` component keeps its name and type-to-confirm function; only its
  visual treatment and any "seal/stamp" copy change.

### E. Component restyle — `components/ui/*` and feature components

Token changes cover most of it. Targeted per-component work:

- `ui/button.tsx` — radius 6px, primary = blue `--accent`, destructive variant
  uses `--danger`; focus ring = `--ring` (blue).
- `ui/table.tsx` + `clusters-table.tsx` / `business-units-table.tsx` — apply
  `.zebra-row` striping and sticky-column helpers; header uses `--surface`.
- `ui/badge.tsx`, `ui/card.tsx`, `ui/input.tsx`, `ui/textarea.tsx`,
  `ui/alert.tsx`, `ui/checkbox.tsx`, `ui/page-header.tsx`, `ui/tabs.tsx` —
  swap any hardcoded ledger utilities (`.rubric`, `.rule-double`) for plain
  platform equivalents (uppercase muted `text-xs` labels, hairline borders).
- `schema-banner.tsx`, `nav-link.tsx`, `operation-log.tsx`,
  `platform-migrations.tsx`, `sql-console.tsx`, `row-form.tsx`, `row-grid.tsx` —
  audit for `.rubric`/`.seal`/`.stamp-mark`/vernacular usage and convert.

### F. Copy / vernacular

Replace ledger vernacular with plain terms throughout: "Register" → "Schemas"
(home), "Record" → "Audit", "Amendments" → "Migrations", "folio" → "page",
"seal/stamp" → "confirm". `metadata` and any headings/aria-labels updated to
match.

## Scope

**In scope:** everything under `app/(god)/**`, `app/login`, `app/layout.tsx`,
`app/globals.css`, all `components/**` that carry ledger styling/copy.

**Out of scope:** behaviour/logic changes, DB/SQL, auth, streaming-progress
mechanics, adopting the platform's *component library* wholesale (we restyle our
own `ui/*`, we do not import platform code — it is a separate Vite/React app).

## Testing & quality

- `.test.tsx` (jsdom) that assert on retired copy or classes must be updated:
  notably `schema-banner.test.tsx`, `seal-confirm.test.tsx`, and any test
  asserting nav labels ("Register"/"Record"/"Amendments") or `.rubric`/`.seal`
  markup. Update assertions to the new copy/markup; do not delete coverage.
- E2E specs asserting nav/target text must be updated to new copy.
- `bun run lint` stays clean repo-wide; `bun run typecheck` clean;
  `bun run test` green. lucide migration must leave no dangling phosphor import.
- a11y floor preserved: keyboard-visible focus ring, `prefers-reduced-motion`
  respected, WCAG AA contrast on the new palette (verify danger-on-surface and
  muted-foreground pairs — the platform values are AA, derived subtles must be
  checked).

## Follow-up

After implementation, update the `design-language-ledger` auto-memory: the
Ledger identity is retired for chrome in favour of this platform-aligned hybrid;
note the one preserved distinctive element (live-target safety bar).

## Open questions

None outstanding — direction, sidebar, lucide switch, and persistent top-bar
safety signal all confirmed by the user.
