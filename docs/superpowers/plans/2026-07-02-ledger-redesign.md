# Ledger Redesign (The Register of Carmen) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `instrument-console` visual identity with the **Ledger** direction ("The Register of Carmen") across the whole god-mode admin, changing only presentation — never data, routes, SQL, or server actions.

**Architecture:** The `ui/*` primitives already consume CSS custom properties, so most of the redesign is re-tokening `globals.css` + swapping the three `next/font` faces; the identity-coupled classes are fully enumerated (`.eyebrow`, `.hazard-tape`, `.target-dot`, `martian`) and each is migrated in a specific task. The one net-new piece of behaviour is the **press-to-stamp seal** confirmation (`components/seal-confirm.tsx`), which wraps the existing confirm-phrase + streaming-op wiring.

**Tech Stack:** Next.js 16.2.9 (App Router), Tailwind CSS v4 (`@theme inline` tokens), `next/font/google`, React client components, Vitest + Testing Library (jsdom), Playwright E2E.

## Global Constraints

- Off-black / off-white only — **no pure `#000` / `#fff`** anywhere (existing a11y rule).
- `bun run typecheck`, `bun run lint` must stay clean **repo-wide**; `bun run test` (Vitest — never `bun test`) must keep all 176 cases green.
- Type `postgres` results via `as unknown as { … }[]`; never introduce `any` (lint forbids `no-explicit-any`). (No SQL touched by this plan, but keep the rule if you touch a data helper.)
- `AGENTS.md`: this Next.js differs from training data — **read `node_modules/next/dist/docs/01-app/03-api-reference/02-components/font.md` before editing font loading.**
- Core technical nouns operators navigate by (**schema / table / SQL / cluster**) stay literal. Only two nav labels take ledger reframes: **Audit log → "Record"**, **Platform migrations → "Amendments"** (hrefs unchanged).
- No decorative sequence numbering (`01 / 02 / 03`); ordinals appear only in the audit log, where order is real.
- No new runtime dependencies. Fonts via `next/font/google` only. Keep the pre-paint `prefers-color-scheme` script; no manual theme toggle.
- Commit after every task. End commit messages with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

## Spec

Full design: `docs/superpowers/specs/2026-07-02-ledger-redesign-design.md`. Hero palette: oyster paper · blue-black ink · **oxblood seal** · bottle green · aged amber · register blue. Faces: **Fraunces** (display) · **Newsreader** (body) · **IBM Plex Mono** (data).

## File map

| File | Change | Task |
| --- | --- | --- |
| `app/globals.css` | replace tokens, font vars, base font; `.eyebrow`→`.rubric`; add `.rule-double` `.seal` `.stamp-mark`; drop `.hazard-tape` + `.target-dot` | 1 |
| `app/layout.tsx` | load Fraunces + Newsreader + IBM Plex Mono; drop Geist/Martian | 2 |
| `app/(god)/layout.tsx` | masthead wordmark + target seal; drop `.target-dot`/`.eyebrow` | 3 |
| `components/seal-confirm.tsx` | **new** press-to-stamp control | 4 |
| `components/__tests__/seal-confirm.test.tsx` | **new** tests | 4 |
| `components/confirm-delete.tsx` | compose `SealConfirm`; drop hazard/eyebrow | 5 |
| `components/__tests__/confirm-delete.test.tsx` | update interaction to the seal | 5 |
| `components/ui/page-header.tsx` | `.eyebrow`→`.rubric` (PageHeader + SectionLabel) | 6 |
| `components/schema-banner.tsx` | drop hazard; `.eyebrow`→`.rubric`; register bands | 7 |
| `app/login/page.tsx` | title-page; drop hazard; `.eyebrow`→`.rubric` | 8 |
| `e2e/smoke.spec.ts` | assert the new login wordmark | 8 |
| `app/(god)/audit/page.tsx` | "The Record": ordinals, mono ts, stamp-mark, double-rule | 9 |
| `app/(god)/schemas/page.tsx` | double-rule + tabular counts + folio-turn | 10 |

---

### Task 1: Design tokens + identity utilities (`globals.css`)

**Files:**
- Modify: `app/globals.css` (replace `:root` block ~L23–80, `.dark` block ~L82–130, the font vars in `@theme inline` ~L181–183, the base `body` font ~L191, and the whole `@layer components` block ~L213–268)

**Interfaces:**
- Produces (CSS custom properties + utility classes consumed by every later task): tokens `--seal`, `--seal-hover`, plus the existing token names re-valued; Tailwind color utilities `bg-seal` / `text-seal` / `border-seal` (via `--color-seal`); classes `.rubric`, `.rubric-seal`, `.rule-double`, `.seal`, `.stamp-mark`. Font vars: `--font-display` → Fraunces, `--font-sans` → Newsreader, `--font-mono` → IBM Plex Mono.

- [ ] **Step 1: Replace the light `:root` token block** (everything between `:root {` and its closing `}`) with:

```css
:root {
  /* Base surfaces + text — "daylight on paper" */
  --background: #eae8e1; /* oyster paper, cool */
  --surface: #f5f3ed; /* leaf — cards, tables, inputs */
  --surface-hover: #edebe3;
  --surface-muted: #e4e2da;
  --foreground: #1b2230; /* blue-black ink */
  --foreground-muted: #565e6e;
  --foreground-subtle: #7a818e;
  --border: #cdcabf; /* hairline rule */
  --border-strong: #b4b0a3;
  --ring: #1b2230;

  /* Primary action = ink */
  --accent: #1b2230;
  --accent-hover: #2c3446;
  --accent-foreground: #f5f3ed;

  /* Link — register blue, underline-first */
  --link: #2c4a7c;
  --link-hover: #1e3560;

  /* Signature: the seal (also the danger family) */
  --seal: #b23a2e; /* oxblood */
  --seal-hover: #9a3227;

  --danger: #b23a2e;
  --danger-hover: #9a3227;
  --danger-foreground: #f5f3ed;
  --danger-subtle: #f6e9e5;
  --danger-subtle-foreground: #8a2c22; /* small danger TEXT uses this */
  --danger-border: #e4c3bc;

  --warning: #b07a26; /* aged amber */
  --warning-foreground: #1b2230;
  --warning-subtle: #f5edd9;
  --warning-subtle-foreground: #7a521a;
  --warning-border: #e4d3a6;
  --warning-strong: #b07a26;

  --success: #2f5d4e; /* bottle green — committed */
  --success-hover: #274e41;
  --success-subtle: #e4ede7;
  --success-subtle-foreground: #234a3e;
  --success-border: #bcd1c7;

  --info: #2c4a7c;
  --info-subtle: #e5e9f1;
  --info-subtle-foreground: #223c66;
  --info-border: #becbdf;

  --target-idle: #7a818e;
}
```

- [ ] **Step 2: Replace the `.dark` token block** with:

```css
.dark {
  /* "reading by lamplight" — warm, never blue-black */
  --background: #181510;
  --surface: #211e17;
  --surface-hover: #2a2619;
  --surface-muted: #1c1a14;
  --foreground: #ece7da; /* warm parchment */
  --foreground-muted: #a29b89;
  --foreground-subtle: #79725f;
  --border: #332e22;
  --border-strong: #48412f;
  --ring: #ece7da;

  --accent: #ece7da;
  --accent-hover: #d8d2c3;
  --accent-foreground: #181510;

  --link: #8fa9d8;
  --link-hover: #abbfe4;

  --seal: #d6564a;
  --seal-hover: #e06b60;

  --danger: #d6564a;
  --danger-hover: #e06b60;
  --danger-foreground: #181510;
  --danger-subtle: #2e1512;
  --danger-subtle-foreground: #f0b3ac;
  --danger-border: #5a241d;

  --warning: #d6a24a;
  --warning-foreground: #181510;
  --warning-subtle: #2a2010;
  --warning-subtle-foreground: #e6c88a;
  --warning-border: #5a4620;
  --warning-strong: #d6a24a;

  --success: #6fa98c;
  --success-hover: #83bb9e;
  --success-subtle: #12241c;
  --success-subtle-foreground: #a7cfbc;
  --success-border: #274a3b;

  --info: #8fa9d8;
  --info-subtle: #141c2c;
  --info-subtle-foreground: #b3c5e6;
  --info-border: #2a3b5a;

  --target-idle: #79725f;
}
```

- [ ] **Step 3: Add the seal color utility + swap font vars** inside `@theme inline`. Add these two lines next to the other `--color-*` mappings:

```css
  --color-seal: var(--seal);
  --color-seal-hover: var(--seal-hover);
```

and change the three font lines from:

```css
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
  --font-display: var(--font-martian-mono);
```

to:

```css
  --font-sans: var(--font-newsreader);
  --font-mono: var(--font-plex-mono);
  --font-display: var(--font-fraunces);
```

- [ ] **Step 4: Switch the base body font** in `@layer base` from `font-family: var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif;` to:

```css
    font-family: var(--font-newsreader), ui-serif, Georgia, serif;
```

- [ ] **Step 5: Replace the entire `@layer components { … }` block** (the old `.eyebrow`, `.hazard-tape`, `.target-dot` + keyframes) with:

```css
@layer components {
  /*
   * Rubric: the red manuscript heading — small, uppercase, widely tracked.
   * Replaces the instrument-console eyebrow; carries section voice.
   */
  .rubric {
    font-family: var(--font-newsreader), ui-serif, Georgia, serif;
    font-size: 11px;
    font-weight: 500;
    line-height: 1;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--foreground-subtle);
  }
  .rubric-seal {
    color: var(--seal);
  }

  /* Double rule — the ledger divider under titles / above totals. */
  .rule-double {
    border-bottom: 3px double var(--border-strong);
  }

  /*
   * Wax seal — the target-status disc in the masthead. Meaning is carried by
   * FILL (pressed vs. blank), never motion, so it is reduced-motion-safe.
   */
  .seal {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 9999px;
    border: 1.5px solid var(--border-strong);
    background: transparent;
    color: var(--foreground-subtle);
    font-family: var(--font-newsreader), ui-serif, Georgia, serif;
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .seal[data-live="true"] {
    border-color: var(--seal);
    background: var(--seal);
    color: var(--danger-foreground);
  }

  /* Stamp mark — the persistent seal glyph beside a sealed audit entry. */
  .stamp-mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1rem;
    height: 1rem;
    border-radius: 9999px;
    border: 1.5px solid var(--seal);
    color: var(--seal);
    font-size: 9px;
    line-height: 1;
  }
}
```

Also update the file's top comment banner (L13–21) so it no longer says "instrument paper" — change the heading to `Design tokens — "The Register of Carmen" (ledger)`.

- [ ] **Step 6: Verify no identity leftovers remain in the file**

Run: `grep -nE "eyebrow|hazard-tape|target-dot|martian|instrument" app/globals.css`
Expected: no output (exit code 1).

- [ ] **Step 7: Verify lint stays clean** (fonts wired in Task 2 — CSS alone must not break lint)

Run: `bun run lint`
Expected: no errors. (The app won't render correctly until Task 2 supplies the font vars; that's fine — this step only guards CSS validity.)

- [ ] **Step 8: Commit**

```bash
git add app/globals.css
git commit -m "feat(ui): Ledger design tokens + rubric/seal/rule utilities

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Load the Ledger typefaces (`app/layout.tsx`)

**Files:**
- Modify: `app/layout.tsx` (replace the three `next/font/google` imports + loaders L2–20, and the `<html className>` L48)

**Interfaces:**
- Consumes: nothing.
- Produces: CSS variables `--font-fraunces`, `--font-newsreader`, `--font-plex-mono` on `<html>` — the values Task 1's `@theme inline` maps to `--font-display` / `--font-sans` / `--font-mono`.

- [ ] **Step 1: Read the font API doc** (per AGENTS.md)

Run: `sed -n '112,140p' node_modules/next/dist/docs/01-app/03-api-reference/02-components/font.md`
Confirm: variable fonts omit `weight` but may pass `axes`; non-variable fonts require a `weight` array. (Fraunces/Newsreader are variable with an `opsz` axis; IBM Plex Mono is not variable.)

- [ ] **Step 2: Replace the import + loaders** (L2–20) with:

```tsx
import { Fraunces, Newsreader, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// Display: a soft, engraved serif — masthead, folio titles, large numerals.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz"],
  display: "swap",
});

// Body / UI: an editorial old-style with tabular figures for ledger data.
const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  display: "swap",
});

// Data: IDs, timestamps, byte sizes, SQL. Not a variable font — weights listed.
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});
```

- [ ] **Step 3: Swap the `<html>` className** (L48) from the Geist/Martian variables to:

```tsx
      className={`${fraunces.variable} ${newsreader.variable} ${plexMono.variable} h-full antialiased`}
```

- [ ] **Step 4: Typecheck + build the font manifest**

Run: `bun run typecheck`
Expected: no errors.
Run: `bun run lint`
Expected: no errors.

- [ ] **Step 5: Smoke-render the dev server once** to confirm fonts resolve (Google font fetch at build)

Run: `bun run dev &` then `sleep 6 && curl -sSf http://localhost:3305/login >/dev/null && echo OK; kill %1`
Expected: `OK` (page compiles; no `next/font` request error in the dev log). If the font fetch fails in a sandbox, note it and fall back to Petrona / Source Serif 4 / JetBrains Mono per the spec's Open Questions.

- [ ] **Step 6: Commit**

```bash
git add app/layout.tsx
git commit -m "feat(ui): load Fraunces + Newsreader + IBM Plex Mono

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Masthead + target seal (`app/(god)/layout.tsx`)

**Files:**
- Modify: `app/(god)/layout.tsx` (replace the returned JSX; keep imports + `dbTarget()` usage)

**Interfaces:**
- Consumes: `dbTarget()` → `{ host: string; label: string; isLocal: boolean }` (unchanged); `.rubric`, `.seal` from Task 1; `NavLink`.
- Produces: the running-head chrome. Nav labels: Schemas · Clusters · **Record** (`/audit`) · **Amendments** (`/platform-migrations`).

- [ ] **Step 1: Replace the `NAV` array** (L8–13) with the reframed labels:

```tsx
const NAV: { href: string; label: string }[] = [
  { href: "/schemas", label: "Schemas" },
  { href: "/clusters", label: "Clusters" },
  { href: "/audit", label: "Record" },
  { href: "/platform-migrations", label: "Amendments" },
];
```

- [ ] **Step 2: Replace the component body** (the whole `return ( … )`) with the masthead:

```tsx
  return (
    <div className="min-h-dvh">
      <div className="sticky top-0 z-30 bg-surface/85 backdrop-blur">
        <header className="flex h-14 items-center gap-3 px-4">
          <Link
            href="/schemas"
            className="mr-1 flex items-baseline gap-2"
            aria-label="The Register of Carmen — home"
          >
            <span className="font-display text-lg font-medium tracking-tight text-foreground">
              CARMEN
            </span>
            <span className="rubric rubric-seal">Register</span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
            {NAV.map((item) => (
              <NavLink key={item.href} href={item.href}>
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div
            role="status"
            className={cn(
              "ml-auto hidden items-center gap-2.5 sm:flex",
              live ? "text-danger" : "text-foreground-subtle",
            )}
          >
            <span className="rubric">Target</span>
            <span className="font-mono text-[11px] text-foreground-muted">
              {target.host}
            </span>
            <span className="seal" data-live={live} aria-hidden="true">
              {live ? "Live" : "Local"}
            </span>
            <span className="sr-only">
              {live ? "Live target — writes are permanent" : "Local target"}
            </span>
          </div>

          <form action={logout} className="ml-auto sm:ml-0">
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-foreground-muted transition-colors hover:bg-surface-hover hover:text-foreground"
            >
              <SignOut className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Log out</span>
            </button>
          </form>
        </header>

        {/* The ledger's running rule — draws once on load (Task 11 adds motion). */}
        <div className={cn("rule-double", live && "bg-danger-subtle")} aria-hidden="true" />

        {/* Mobile target row — the persistent "where is this pointed" reminder. */}
        <div
          role="status"
          className={cn(
            "flex h-7 items-center gap-2 px-4 sm:hidden",
            live ? "bg-danger-subtle text-danger" : "bg-surface",
          )}
        >
          <span className="seal !h-4 !w-4 !text-[7px]" data-live={live} aria-hidden="true">
            {live ? "L" : "·"}
          </span>
          <span className="rubric">Target</span>
          <span className="truncate font-mono text-[11px] text-foreground-muted">
            {target.host}
          </span>
          <span className={cn("rubric ml-auto shrink-0", live && "text-danger")}>
            {target.label}
          </span>
        </div>
      </div>

      {/* Mobile nav row. */}
      <nav
        className="flex items-center gap-1 overflow-x-auto border-b border-border bg-surface px-4 py-2 md:hidden"
        aria-label="Primary"
      >
        {NAV.map((item) => (
          <NavLink key={item.href} href={item.href}>
            {item.label}
          </NavLink>
        ))}
      </nav>

      <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 md:px-6">
        {children}
      </main>
    </div>
  );
```

- [ ] **Step 3: Verify the identity leftovers are gone**

Run: `grep -nE "target-dot|eyebrow|hazard" app/(god)/layout.tsx`
Expected: no output.

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add "app/(god)/layout.tsx"
git commit -m "feat(ui): Ledger masthead + wax-seal target rail

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The seal — press-to-stamp control (`components/seal-confirm.tsx`)

**Files:**
- Create: `components/seal-confirm.tsx`
- Test: `components/__tests__/seal-confirm.test.tsx`

**Interfaces:**
- Consumes: `Input` from `@/components/ui/input`; `cn` from `@/lib/cn`; `bg-seal`/`border-seal` utilities + `.rubric` from Task 1.
- Produces:
  ```ts
  function SealConfirm(props: {
    requiredPhrase: string;
    onStamp: () => void;      // fires once when a hold completes
    disabled?: boolean;       // external block (e.g. blast radius truncated)
    pending?: boolean;        // op in flight
    holdMs?: number;          // default 700; tests pass a small value
    label?: string;           // accessible name; default "Seal & execute"
  }): JSX.Element
  ```
  Behaviour: the seal button is inert until the typed phrase exactly equals `requiredPhrase`; then a press-and-hold for `holdMs` fires `onStamp` exactly once; releasing early cancels.

- [ ] **Step 1: Write the failing test**

```tsx
// components/__tests__/seal-confirm.test.tsx
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function mount(props: Partial<React.ComponentProps<typeof import("@/components/seal-confirm")["SealConfirm"]>> = {}) {
  const { SealConfirm } = await import("@/components/seal-confirm");
  const onStamp = vi.fn();
  render(<SealConfirm requiredPhrase="DELETE" onStamp={onStamp} holdMs={40} {...props} />);
  return { onStamp };
}

test("the seal stays disabled until the exact phrase is typed", async () => {
  await mount();
  const seal = screen.getByRole("button", { name: /seal/i });
  expect(seal).toHaveAttribute("aria-disabled", "true");
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "delete" } });
  expect(seal).toHaveAttribute("aria-disabled", "true");
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "DELETE" } });
  expect(seal).toHaveAttribute("aria-disabled", "false");
});

test("holding the armed seal for holdMs fires onStamp once", async () => {
  const { onStamp } = await mount();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "DELETE" } });
  fireEvent.mouseDown(screen.getByRole("button", { name: /seal/i }));
  await waitFor(() => expect(onStamp).toHaveBeenCalledTimes(1));
});

test("releasing before holdMs cancels the stamp", async () => {
  const { onStamp } = await mount();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "DELETE" } });
  const seal = screen.getByRole("button", { name: /seal/i });
  fireEvent.mouseDown(seal);
  fireEvent.mouseUp(seal);
  await new Promise((r) => setTimeout(r, 120));
  expect(onStamp).not.toHaveBeenCalled();
});

test("keyboard hold (Space) also stamps", async () => {
  const { onStamp } = await mount();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "DELETE" } });
  fireEvent.keyDown(screen.getByRole("button", { name: /seal/i }), { key: " " });
  await waitFor(() => expect(onStamp).toHaveBeenCalledTimes(1));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test seal-confirm`
Expected: FAIL — `Cannot find module '@/components/seal-confirm'`.

- [ ] **Step 3: Write the component**

```tsx
// components/seal-confirm.tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";

/**
 * The seal — a two-step irreversible-action ceremony that replaces a plain
 * destructive submit button. Step one: type the exact confirm phrase to ARM
 * the seal. Step two: press-and-hold the seal (~holdMs) to STAMP, which fires
 * `onStamp`. Releasing early cancels. Keyboard: focus + hold Space/Enter.
 * Meaning-by-fill + a real hold make the friction proportional to consequence.
 */
export function SealConfirm({
  requiredPhrase,
  onStamp,
  disabled = false,
  pending = false,
  holdMs = 700,
  label = "Seal & execute",
}: {
  requiredPhrase: string;
  onStamp: () => void;
  disabled?: boolean;
  pending?: boolean;
  holdMs?: number;
  label?: string;
}) {
  const [confirm, setConfirm] = useState("");
  const [holding, setHolding] = useState(false);
  const [sealed, setSealed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const armed = confirm === requiredPhrase;
  const canSeal = armed && !disabled && !pending && !sealed;

  function begin() {
    if (!canSeal || holding) return;
    setHolding(true);
    timer.current = setTimeout(() => {
      setHolding(false);
      setSealed(true);
      onStamp();
    }, holdMs);
  }
  function cancel() {
    setHolding(false);
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const face = sealed
    ? "Sealed"
    : pending
      ? "Sealing…"
      : armed
        ? "Press & hold to seal"
        : "Type the phrase to arm";

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label htmlFor="seal-confirm-input" className="block text-sm font-medium">
          Type{" "}
          <code className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-xs">
            {requiredPhrase}
          </code>{" "}
          to arm the seal:
        </label>
        <Input
          id="seal-confirm-input"
          name="confirm"
          autoComplete="off"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>

      <button
        type="button"
        aria-label={label}
        aria-disabled={!canSeal}
        aria-busy={pending || holding || undefined}
        data-armed={armed}
        data-holding={holding}
        data-sealed={sealed}
        onMouseDown={begin}
        onMouseUp={cancel}
        onMouseLeave={cancel}
        onTouchStart={begin}
        onTouchEnd={cancel}
        onKeyDown={(e) => {
          if ((e.key === " " || e.key === "Enter") && !e.repeat) {
            e.preventDefault();
            begin();
          }
        }}
        onKeyUp={(e) => {
          if (e.key === " " || e.key === "Enter") cancel();
        }}
        className={cn(
          "relative flex h-11 w-full select-none items-center justify-center overflow-hidden rounded-md border transition-colors",
          canSeal ? "border-seal" : "cursor-not-allowed border-border",
        )}
      >
        {/* Ink fill grows left→right over holdMs while holding, then stays. */}
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-0 origin-left bg-seal",
            holding || sealed ? "scale-x-100" : "scale-x-0",
          )}
          style={{
            transition: holding
              ? `transform ${holdMs}ms linear`
              : "transform 140ms ease-out",
          }}
        />
        <span
          className={cn(
            "relative font-display text-sm font-medium uppercase tracking-[0.12em]",
            holding || sealed
              ? "text-danger-foreground"
              : canSeal
                ? "text-seal"
                : "text-foreground-subtle",
          )}
        >
          {face}
        </span>
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test seal-confirm`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add components/seal-confirm.tsx components/__tests__/seal-confirm.test.tsx
git commit -m "feat(ui): SealConfirm — press-to-stamp irreversible-action ceremony

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Wire the seal into `confirm-delete.tsx`

**Files:**
- Modify: `components/confirm-delete.tsx` (drop the hazard/eyebrow header L53–62, and replace the confirm `Input` + danger `Button` L131–163 with `SealConfirm`)
- Modify: `components/__tests__/confirm-delete.test.tsx` (the third test's interaction)

**Interfaces:**
- Consumes: `SealConfirm` from Task 4. Keeps `useOperationStream`, `OperationProgress`, the blast-radius table, and the drop-schema checkbox untouched.
- Produces: unchanged POST payload to `/api/ops/cascade-delete` (`{ schema, table, pks, dropSchema, confirm }`), now triggered by the seal instead of a submit button.

- [ ] **Step 1: Update the failing test first** — replace the third test (`"submitting POSTs the normalized payload…"`, L35–57) with:

```tsx
test("stamping the seal POSTs the normalized payload to the cascade-delete route", async () => {
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
  fireEvent.mouseDown(screen.getByRole("button", { name: /seal/i }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalled(), { timeout: 2000 });
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("/api/ops/cascade-delete");
  expect(JSON.parse(String(init.body))).toEqual({
    schema: "CARMEN_SYSTEM", table: "tb_cluster", pks: [{ id: "1" }], dropSchema: false, confirm: "DELETE",
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun run test confirm-delete`
Expected: FAIL — no button named `/seal/i` yet (still the old "Permanently delete" button).

- [ ] **Step 3: Refactor `confirm-delete.tsx`.** Add the import, split `onSubmit` into a plain `submit()`, replace the hazard/eyebrow header with a rubric header, and swap the input+button for `SealConfirm`.

Add to the imports (after the `Button` import — `Button` is still used elsewhere? No; remove it if now unused. `Input` becomes unused too — remove it):

```tsx
import { SealConfirm } from "@/components/seal-confirm";
```

Remove the now-unused `Input` and `Button` imports (L8–9). Replace `onSubmit` (L40–49) with:

```tsx
  function submit() {
    start("/api/ops/cascade-delete", {
      schema,
      table,
      pks,
      dropSchema,
      confirm: requiredPhrase,
    });
  }
```

Change the outer element from `<form onSubmit={onSubmit} …>` to `<div className="max-w-2xl">` (and its closing `</form>`→`</div>`). Replace the hazard/eyebrow header block (L53–62) with:

```tsx
      <div className="overflow-hidden rounded-md border border-danger-border bg-surface">
        <div className="flex items-center gap-2 rule-double bg-danger-subtle px-4 py-2.5">
          <span className="rubric rubric-seal">Armed</span>
          <span aria-hidden="true" className="text-danger-border">/</span>
          <span className="rubric text-danger-subtle-foreground">Irreversible</span>
        </div>
```

Replace the confirm-phrase `<div>` + `<Button>` (L131–163) with:

```tsx
      {isBusinessUnit && tenantSchema && (
        <p className="text-xs text-foreground-subtle">
          If you check the schema-drop box, the required phrase becomes the schema name.
        </p>
      )}

      <SealConfirm
        requiredPhrase={requiredPhrase}
        onStamp={submit}
        disabled={radius.truncated}
        pending={running}
        label="Seal and permanently delete"
      />
```

> Note: `SealConfirm` owns the confirm input, and its internal `confirm` state is only used to *arm* the seal; the actual POST sends `requiredPhrase` (the value the server re-validates), so `confirm` state is no longer needed in this component. Remove the `const [confirm, setConfirm] = useState("")` line (L33) and the `useState` import if it becomes unused (it's still used for `dropSchema`, so keep it).

- [ ] **Step 4: Run the confirm-delete suite**

Run: `bun run test confirm-delete`
Expected: PASS (all 3 tests — checkbox-present, no-checkbox, seal-stamp POST).

- [ ] **Step 5: Verify no identity leftovers + typecheck**

Run: `grep -nE "hazard|eyebrow" components/confirm-delete.tsx`
Expected: no output.
Run: `bun run typecheck && bun run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add components/confirm-delete.tsx components/__tests__/confirm-delete.test.tsx
git commit -m "feat(ui): confirm-delete uses the seal ceremony

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `page-header.tsx` → rubric

**Files:**
- Modify: `components/ui/page-header.tsx` (the two `.eyebrow` usages + the readout marker)

**Interfaces:**
- Consumes: `.rubric` from Task 1. Public props unchanged (`PageHeader({ eyebrow, title, lede, actions, className })`, `SectionLabel({ children, className })`) — the `eyebrow` prop name stays to avoid churn across callers.
- Produces: headings in the ledger voice; `title` uses `font-display` (now Fraunces).

- [ ] **Step 1: In `PageHeader`,** change the eyebrow paragraph (L27–33) — swap the `eyebrow` class for `rubric` and drop the `▌` bar marker (the rubric carries the voice; the bar was an instrument-console motif):

```tsx
          {eyebrow && <p className="rubric mb-2">{eyebrow}</p>}
```

- [ ] **Step 2: Keep the title on `font-display`** but let Fraunces breathe — change L34's `<h1 className="font-display text-xl font-medium tracking-tight text-foreground">` to:

```tsx
          <h1 className="font-display text-2xl font-medium tracking-tight text-foreground">
```

- [ ] **Step 3: In `SectionLabel`,** replace the whole return (L57–64) with:

```tsx
  return <p className={cn("rubric mb-3", className)}>{children}</p>;
```

- [ ] **Step 4: Update the file's doc comment** (L3–8) to describe the rubric rather than the "mission-control eyebrow".

- [ ] **Step 5: Verify + typecheck**

Run: `grep -nE "eyebrow class|className=\"eyebrow|▌" components/ui/page-header.tsx`
Expected: no output. (The `eyebrow` *prop* name remains; only the CSS class and bar marker are gone.)
Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add components/ui/page-header.tsx
git commit -m "feat(ui): page header adopts the rubric voice

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `schema-banner.tsx` → register bands

**Files:**
- Modify: `components/schema-banner.tsx` (drop hazard tape, `.eyebrow`→`.rubric`)

**Interfaces:**
- Consumes: `env().systemSchemaName`, `cn`, `.rubric` from Task 1. Props unchanged (`SchemaBanner({ schema })`).
- Produces: a persistent register-context band; SYSTEM = danger fill, TENANT = aged-amber fill; no hazard tape.

- [ ] **Step 1: Replace the whole returned JSX** (L14–55) with:

```tsx
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
          "rounded-sm px-1.5 py-0.5 font-display text-[10px] font-semibold uppercase tracking-[0.18em]",
          isSystem ? "bg-black/25" : "bg-black/15",
        )}
      >
        {isSystem ? "System" : "Tenant"}
      </span>

      <span className="flex min-w-0 items-center gap-1.5 font-mono text-[13px]">
        <span aria-hidden="true" className="opacity-60">
          ▸
        </span>
        <span className="truncate">{schema}</span>
      </span>

      <span className="rubric ml-auto shrink-0 text-inherit opacity-80">
        Register
        <span aria-hidden="true"> · </span>
        <span className="hidden sm:inline">Changes are permanent</span>
      </span>
    </div>
  );
```

- [ ] **Step 2: Update the doc comment** (L4–9) — remove the hazard-tape sentence; describe the SYSTEM/TENANT register bands.

- [ ] **Step 3: Verify the existing banner test still passes** (it asserts the SYSTEM schema renders — behaviour unchanged)

Run: `bun run test schema-banner`
Expected: PASS.

- [ ] **Step 4: Verify + typecheck**

Run: `grep -nE "hazard|eyebrow" components/schema-banner.tsx`
Expected: no output.
Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add components/schema-banner.tsx
git commit -m "feat(ui): schema banner as a register-context band

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Login as a title page (`app/login/page.tsx`)

**Files:**
- Modify: `app/login/page.tsx` (drop hazard tape, `.eyebrow`→`.rubric`, title-page treatment)
- Modify: `e2e/smoke.spec.ts` (assert the new wordmark)

**Interfaces:**
- Consumes: `env().gatewayEnabled`, `LoginTabs`, `.rubric` from Task 1.
- Produces: the front-matter / title page. The visible wordmark becomes `CARMEN` + `Register` (so the smoke test asserts `Register`, not `God Mode`).

- [ ] **Step 1: Replace the whole page** with the title-page composition:

```tsx
import { env } from "@/lib/env";
import { LoginTabs } from "@/app/login/login-tabs";

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm overflow-hidden rounded-md border border-border bg-surface shadow-sm">
        <div className="rule-double" aria-hidden="true" />
        <div className="space-y-6 p-6">
          <div className="space-y-3">
            <div className="flex items-baseline gap-2">
              <span className="font-display text-xl font-medium tracking-tight text-foreground">
                CARMEN
              </span>
              <span className="rubric rubric-seal">Register</span>
            </div>
            <div className="space-y-1">
              <p className="rubric">Restricted console</p>
              <p className="text-sm text-foreground-muted">
                Sign in to operate on live inventory data. Every write is permanent.
              </p>
            </div>
          </div>
          <LoginTabs gatewayEnabled={env().gatewayEnabled} />
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Update the smoke E2E assertion** — in `e2e/smoke.spec.ts` change L6 from `await expect(page.getByText("God Mode")).toBeVisible();` to:

```ts
  await expect(page.getByText("Register")).toBeVisible();
```

- [ ] **Step 3: Verify no identity leftovers**

Run: `grep -nE "hazard|eyebrow|God.?Mode" app/login/page.tsx`
Expected: no output.

- [ ] **Step 4: Run the login unit test + typecheck**

Run: `bun run test login-tabs`
Expected: PASS (unchanged — it tests the tabs, not the page chrome).
Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/login/page.tsx e2e/smoke.spec.ts
git commit -m "feat(ui): login as the register's title page

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: The Record — audit log (`app/(god)/audit/page.tsx`)

**Files:**
- Modify: `app/(god)/audit/page.tsx` (heading, ordinal column, mono timestamps, stamp-mark on sealed ops, double-rule header)

**Interfaces:**
- Consumes: `listAudit`, `Operation`, `.stamp-mark` + `.rubric` from Task 1, existing `Table`/`Badge`/`EmptyState`. No data changes.
- Produces: the audit table read as the ledger's own record.

- [ ] **Step 1: Add a sealed-op set** below the `OPS` constant (L10):

```tsx
// Irreversible operations carry the seal mark in the record.
const SEALED: ReadonlySet<Operation> = new Set(["DELETE", "CASCADE_DELETE", "DROP_SCHEMA"]);
```

- [ ] **Step 2: Replace the heading** (L40) with a rubric + Fraunces title:

```tsx
      <div>
        <p className="rubric">The Record</p>
        <h1 className="font-display text-2xl font-medium tracking-tight">Audit log</h1>
      </div>
```

- [ ] **Step 3: Add a leading ordinal column.** In the `THead` row (L77–84) prepend `<Th className="text-right">#</Th>` before `<Th>At</Th>`. Update the empty-state `colSpan` from `6` to `7` (L89).

- [ ] **Step 4: Render the ordinal + mono timestamp + stamp-mark.** Replace the entries `.map` (L98–127) with:

```tsx
            entries.map((e, i) => (
              <TR key={e.id} className="align-top">
                <Td className="text-right font-mono text-xs tabular-nums text-foreground-subtle">
                  {String(entries.length - i).padStart(3, "0")}
                </Td>
                <Td className="whitespace-nowrap font-mono text-xs text-foreground-muted">
                  {e.at}
                </Td>
                <Td className="text-xs">{e.actor}</Td>
                <Td className="font-mono text-xs">
                  {e.schemaName}
                  {e.tableName ? `.${e.tableName}` : ""}
                </Td>
                <Td>
                  <span className="inline-flex items-center gap-1.5">
                    {SEALED.has(e.operation) && (
                      <span className="stamp-mark" aria-label="sealed" title="Sealed — irreversible">
                        ●
                      </span>
                    )}
                    <Badge variant={opVariant(e.operation)}>{e.operation}</Badge>
                  </span>
                </Td>
                <Td className="font-mono text-xs text-foreground-muted">
                  {e.pk ? JSON.stringify(e.pk) : ""}
                </Td>
                <Td className="max-w-md">
                  <details className="group">
                    <summary className="cursor-pointer text-xs font-medium text-link hover:text-link-hover">
                      view
                    </summary>
                    <pre className="mt-1 whitespace-pre-wrap rounded-md bg-surface-muted p-2 font-mono text-xs">
                      old: {JSON.stringify(e.oldValues, null, 2)}
                      {"\n"}new: {JSON.stringify(e.newValues, null, 2)}
                      {e.statement ? `\nsql: ${e.statement}` : ""}
                    </pre>
                  </details>
                </Td>
              </TR>
            ))
```

- [ ] **Step 5: Typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add "app/(god)/audit/page.tsx"
git commit -m "feat(ui): audit log reads as The Record (ordinals + seal marks)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Schemas list — double rule, tabular counts, folio-turn

**Files:**
- Modify: `app/(god)/schemas/page.tsx` (the "All schemas" section)

**Interfaces:**
- Consumes: `listBusinessUnits`, `listSelectableSchemas`, `PageHeader`/`SectionLabel` (Task 6), `.rule-double`.
- Produces: the schemas index in the ledger voice. `eyebrow="Registry"` prop is kept (renders via the rubric now).

- [ ] **Step 1: Give the "All schemas" list a double-rule header + folio-turn rows.** Replace the `<Table>…</Table>` in the "All schemas" section (L42–58) with:

```tsx
          <div className="overflow-hidden rounded-md border border-border bg-surface">
            <div className="rule-double flex items-center justify-between px-4 py-2">
              <span className="rubric">Schema</span>
              <span className="rubric">Open</span>
            </div>
            <ul>
              {sel.allSchemas.map((s) => (
                <li key={s} className="border-b border-border last:border-0">
                  <Link
                    href={`/${encodeURIComponent(s)}/tables`}
                    className="flex items-center justify-between gap-2 px-4 py-2.5 transition-colors hover:bg-surface-hover"
                  >
                    <span className="truncate font-mono text-[13px] text-foreground">{s}</span>
                    <CaretRight className="h-3.5 w-3.5 shrink-0 text-foreground-subtle" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
```

The unused `Table`/`TBody`/`TR`/`Td` imports (L6) can be removed if no longer referenced in the file; the `Link` and `CaretRight` imports stay.

- [ ] **Step 2: Typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "app/(god)/schemas/page.tsx"
git commit -m "feat(ui): schemas index as a ruled register with folio-turn rows

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Motion, full verification, and visual pass

**Files:**
- Modify: `app/globals.css` (one reduced-motion-gated page-load rule)

**Interfaces:**
- Consumes: everything above.
- Produces: the single orchestrated load moment + a green, screenshotted build.

- [ ] **Step 1: Add the page-load rule** to `@layer base` in `globals.css` (after the existing focus-visible rule), gated behind reduced-motion:

```css
  @media (prefers-reduced-motion: no-preference) {
    main {
      animation: folio-in 260ms ease-out both;
    }
    @keyframes folio-in {
      from {
        opacity: 0;
        transform: translateY(4px);
      }
      to {
        opacity: 1;
        transform: none;
      }
    }
  }
```

- [ ] **Step 2: Run the full unit suite**

Run: `bun run test`
Expected: all green (176+ including the 4 new seal tests). If any test still asserts old identity copy (`God Mode`, `eyebrow`, hazard, Martian), update the assertion to the ledger vocabulary — **never** change behaviour assertions.

- [ ] **Step 3: Typecheck + lint (repo-wide clean gate)**

Run: `bun run typecheck && bun run lint`
Expected: no errors.

- [ ] **Step 4: Production build**

Run: `bun run build`
Expected: build succeeds; no `next/font` errors.

- [ ] **Step 5: Visual verification** — start the dev server and screenshot the key surfaces in both themes (use the browser tools or `/run`). Confirm: masthead wordmark + wax seal (LOCAL blank vs LIVE filled), Fraunces titles, Newsreader body, oldstyle/tabular figures in the audit ordinals and counts, the seal press-and-hold on a delete confirm, and no hazard tape anywhere. Check mobile width (masthead target row collapses) and `prefers-reduced-motion` (no folio-in, seal still works).

Run: `bun run dev` (port 3305), then drive `/login`, `/schemas`, `/audit`, and a delete-confirm route.
Expected: matches the spec; note any contrast pair that looks under 4.5:1 and darken the token.

- [ ] **Step 6: Final identity-sweep guard**

Run: `grep -rnE "eyebrow|hazard-tape|target-dot|[Mm]artian" app components --include=*.tsx --include=*.ts --include=*.css | grep -vE "__tests__|rubric"`
Expected: no output (all identity-coupled references migrated).

- [ ] **Step 7: Commit**

```bash
git add app/globals.css
git commit -m "feat(ui): folio-in load motion + Ledger redesign verification

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review notes

- **Spec coverage:** §3 colour → Task 1; §4 type → Tasks 1–2; §5 utilities → Task 1; §6 masthead/target seal → Task 3; §7 seal ceremony → Tasks 4–5; §8 motion → Task 11; §9 per-surface → Tasks 3,5,7,8,9,10 (row-grid / sql-console / clusters / platform-migrations / insert-edit inherit tokens + radius globally and carry no identity-coupled class per the grep in Task 11 Step 6, so they need no dedicated task — verified by the sweep); §10 code scope → all; §11 quality floor → Task 11.
- **Type consistency:** `SealConfirm` prop names (`requiredPhrase`, `onStamp`, `disabled`, `pending`, `holdMs`, `label`) are identical in Task 4 (definition), the Task 4 tests, and Task 5 (consumer). The `submit()` payload matches the pre-existing route contract and the updated confirm-delete test.
- **Deferred detail:** day-separator double-rules in the audit log (spec §9) were dropped as YAGNI — the ordinal + mono timestamp already carry chronological structure; revisit only if requested.
```
