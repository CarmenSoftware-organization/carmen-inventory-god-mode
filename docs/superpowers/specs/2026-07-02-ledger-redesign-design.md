# The Register of Carmen — visual redesign (Ledger direction)

**Date:** 2026-07-02
**Status:** Approved design, pre-implementation
**Supersedes:** the `instrument-console` identity (commit `8456e47`, merged `bb9e2b0`)

## 1. Purpose & scope

Replace the merged `instrument-console` visual identity with a wholly new
direction — **Ledger** — across the entire god-mode admin surface. This is a
**visual/identity redesign only**: no data-layer, route-handler, server-action,
or SQL behaviour changes. The 176 existing tests and clean lint must stay green;
where a test asserts identity-specific copy or class names (as ~12 did in the
last identity pass), the test is updated to the new vocabulary, never the
behaviour.

### The subject, pinned

Carmen Inventory God Mode is an internal super-admin console operated by a very
small number of trusted engineers over a **live production Postgres**. Every
write is permanent and unrecoverable. It manages schemas (multi-tenant schema
isolation), clusters, per-table row browse/insert/edit/delete, a raw SQL
console, platform migrations, and an audit log.

**Emotional truth:** enormous, irreversible power in the hands of one trusted
person, pointed at a living system. The design must make the operator feel the
*weight* of that — without the constant-alarm fatigue of the mission-control
predecessor. Ledger reframes the core feeling from **hazard/alarm** to
**accountability/gravity**: a book of record where every consequential act is
signed and sealed.

### Non-goals (YAGNI)

- No manual light/dark toggle — keep the existing pre-paint `prefers-color-scheme` script.
- No new runtime dependencies. Fonts via `next/font/google` only.
- The core technical nouns operators reason with (**schema / table / SQL / cluster**) stay literal — never reskinned. Two nav items take recognizable ledger reframes because they remain unambiguous: **Audit log → "Record"** and **Platform migrations → "Amendments"** (hrefs unchanged). Ledger voice otherwise lives in chrome, labels, and ceremony, not in renaming things operators search for.
- No decorative sequence numbering (`01 / 02 / 03`). Ordinal numbers appear **only** where order carries real information (the audit log).

## 2. Concept & vocabulary

The whole app reads as one bound register. Functional labels stay plain; the
*ceremony and chrome* carry the ledger voice.

| Old (instrument-console) | Ledger |
| --- | --- |
| `.eyebrow` label | **`.rubric`** — the red manuscript heading: small, uppercase, tracked, in seal-red or subtle ink |
| page | **folio** (folio number shown in the masthead) |
| delete / drop / truncate | **strike / void an entry** — confirmed by *stamping a seal* |
| audit log | **The Record** — the ledger made literal (already the app's real purpose) |
| breathing red target dot | **wax seal** — pressed (LIVE) or blank-embossed (LOCAL) |
| hazard-tape motif | removed entirely |
| Martian Mono display voice | Fraunces display + Newsreader body |

## 3. Colour system

Off-black / off-white only (keep the existing a11y rule — no pure `#000`/`#fff`).
Chrome is ink-on-paper; colour is reserved for **state** (committed / warning /
danger) and for the **seal** signature.

### Hero palette (the 6 to remember)

oyster paper · blue-black ink · **oxblood seal** · bottle green · aged amber · register blue.

### Light — "daylight on paper"

```
--background        #EAE8E1  /* oyster paper, cool */
--surface           #F5F3ED  /* leaf — cards, tables, inputs (brighter than bg) */
--surface-hover     #EDEBE3
--surface-muted     #E4E2DA
--foreground        #1B2230  /* blue-black ink */
--foreground-muted  #565E6E
--foreground-subtle #7A818E
--border            #CDCABF  /* hairline rule */
--border-strong     #B4B0A3
--ring              #1B2230

--accent            #1B2230  /* primary action = ink */
--accent-hover      #2C3446
--accent-foreground #F5F3ED

--link              #2C4A7C  /* register blue, underline-first */
--link-hover        #1E3560

--seal              #B23A2E  /* oxblood — signature + irreversible */
--seal-hover        #9A3227

/* semantic: danger (shares the seal family) */
--danger            #B23A2E
--danger-hover      #9A3227
--danger-foreground #F5F3ED
--danger-subtle     #F6E9E5
--danger-subtle-foreground #8A2C22   /* small danger TEXT uses this for ≥4.5:1 */
--danger-border     #E4C3BC

/* semantic: warning (aged amber — tenant band, caution) */
--warning           #B07A26
--warning-foreground #1B2230
--warning-subtle    #F5EDD9
--warning-subtle-foreground #7A521A
--warning-border    #E4D3A6
--warning-strong    #B07A26

/* semantic: success / committed (bottle green) */
--success           #2F5D4E
--success-hover     #274E41
--success-subtle    #E4EDE7
--success-subtle-foreground #234A3E
--success-border    #BCD1C7

/* semantic: info (register blue) */
--info              #2C4A7C
--info-subtle       #E5E9F1
--info-subtle-foreground #223C66
--info-border       #BECBDF

--target-idle       #7A818E  /* blank-seal LOCAL indicator */
```

### Dark — "reading by lamplight" (warm, NOT blue-black)

```
--background        #181510  /* deep warm brown-black */
--surface           #211E17
--surface-hover     #2A2619
--surface-muted     #1C1A14
--foreground        #ECE7DA  /* warm parchment white */
--foreground-muted  #A29B89
--foreground-subtle #79725F
--border            #332E22
--border-strong     #48412F
--ring              #ECE7DA

--accent            #ECE7DA
--accent-hover      #D8D2C3
--accent-foreground #181510

--link              #8FA9D8
--link-hover        #ABBFE4

--seal              #D6564A
--seal-hover        #E06B60

--danger            #D6564A
--danger-hover      #E06B60
--danger-foreground #181510
--danger-subtle     #2E1512
--danger-subtle-foreground #F0B3AC
--danger-border     #5A241D

--warning           #D6A24A
--warning-foreground #181510
--warning-subtle    #2A2010
--warning-subtle-foreground #E6C88A
--warning-border    #5A4620
--warning-strong    #D6A24A

--success           #6FA98C
--success-hover     #83BB9E
--success-subtle    #12241C
--success-subtle-foreground #A7CFBC
--success-border    #274A3B

--info              #8FA9D8
--info-subtle       #141C2C
--info-subtle-foreground #B3C5E6
--info-border       #2A3B5A

--target-idle       #79725F
```

**Contrast rule:** seal-red is for fills, borders, glyphs, and large/bold text.
Small danger *body* text uses `--danger-subtle-foreground`. Verify every
text/background pair ≥ 4.5:1 (normal) / 3:1 (large) during build.

## 4. Typography

Loaded via `next/font/google` in `app/layout.tsx`, exposing CSS variables (same
mechanism as today's Geist/Martian setup). **Read `node_modules/next/dist/docs/`
for the current `next/font` API before editing** (per `AGENTS.md`).

| Role | Face | CSS var | Usage |
| --- | --- | --- | --- |
| Display | **Fraunces** (variable, high `opsz`) | `--font-fraunces` | masthead wordmark, folio/page titles, large numerals — **used with restraint** |
| Body / UI | **Newsreader** (old-style, tabular figures) | `--font-newsreader` | reading text, table cells, labels, form text |
| Data / mono | **IBM Plex Mono** | `--font-plex-mono` | IDs, timestamps, byte sizes, SQL, type names |

`@theme inline` mapping: `--font-display: var(--font-fraunces)`,
`--font-sans: var(--font-newsreader)`, `--font-mono: var(--font-plex-mono)`.
Body font-family in `@layer base` switches to Newsreader.

### Type scale (printed feel)

- Masthead wordmark — Fraunces 20 / wght 500 / tight tracking
- Folio title — Fraunces 30–40 / high `opsz` / wght 460
- Section head — Newsreader 20 / wght 500
- Body — Newsreader 15 / line-height 1.6
- Data cell — Newsreader 14 tabular, or Plex Mono 13 for typed/ID values
- Rubric label — Newsreader 11 / uppercase / tracking 0.14em / seal or subtle
- Caption / mono — IBM Plex Mono 12

### Numerals

**Oldstyle where prose-adjacent, tabular/lining where columnar.** Numeric
figures (counts, sizes, IDs, timestamps) always tabular so columns align — the
single strongest ledger tell. Enable via `font-variant-numeric: tabular-nums`.

### Structural devices

- `border-radius: 2px` app-wide (square ledger feel; not the friendly 8–12px admin default, not brutalist 0).
- **Double rule** under page titles and above any total/summary row (classic ledger).
- Single hairline (`--border`) between list/table rows; hover thickens to `--border-strong`.

## 5. Identity utilities (globals.css `@layer components`)

- **`.rubric`** — replaces `.eyebrow`. `font-family: var(--font-newsreader)`, 11px, wght 500, uppercase, `letter-spacing: 0.14em`, `color: var(--foreground-subtle)`; a `.rubric--seal` modifier colours it `--seal`.
- **`.rule-double`** — a 3px-tall double hairline (`border-top` + `border-bottom` with a 2px gap, or a `linear-gradient`), token-driven.
- **`.seal`** — the wax-seal disc (see §6/§7). Base = circular, `--border-strong` outline, `--target-idle` blank face. `.seal[data-live="true"]` = filled `--seal`, parchment-coloured "LIVE" text. No animation; meaning is carried by fill, so it is reduced-motion-safe by construction.
- **`.stamp-mark`** — the persistent oxblood seal glyph shown next to sealed audit entries and in operation logs.

Remove `.hazard-tape` and the `.target-dot` pulse keyframes.

## 6. Masthead + target rail (functional constant: where is the console pointed?)

Replaces the current 14px header + 7px target rail with a single running-head
band + a double rule.

```
┌──────────────────────────────────────────────────────────────────────┐
│ CARMEN · REGISTER   Schemas Clusters Record Amendments    folio 03  ⬢  │
│                                                    live-db · [ SEAL ]  │
├══════════════════════════════════════════════════════════════════════┤   ← rule-double
```

- Wordmark: Fraunces "CARMEN" + rubric "REGISTER".
- Nav (`NavLink`): Schemas · Clusters · **Record** (audit) · **Amendments** (platform migrations). Labels restyled; hrefs unchanged (`/schemas`, `/clusters`, `/audit`, `/platform-migrations`).
- Target seal (right): reads `dbTarget()` exactly as today.
  - **LIVE** (`!isLocal`): seal pressed — filled `--seal`, "LIVE", rubric "writes are permanent", the band tinted `--danger-subtle` / `--danger-border`.
  - **LOCAL**: seal blank-embossed — `--border-strong` outline, "LOCAL", calm `--surface` band.
- Host string in IBM Plex Mono.
- Mobile: wordmark + seal on row one; nav collapses to the existing horizontal-scroll row below.

## 7. Signature — the seal (press-to-stamp confirmation)

The one place we spend boldness. Applies to every irreversible action: DROP
schema, DELETE / batch-delete rows, TRUNCATE, cascade delete, and any write
statement executed against a LIVE target from the SQL console.

**Ceremony (two steps = matches the weight):**

1. **Type the exact confirm phrase** — keep the existing safeguard verbatim (this is a real guard, not decoration). Correct phrase → the seal becomes *armed*.
2. **Press-and-hold the seal** (~700 ms; a progress ring fills as you hold). Release-on-complete → the die **stamps**: a brief ink-press, an oxblood mark blooms, the action fires. This is the submit affordance — it replaces the destructive submit button.

**Persistence → ties the signature to the app's real job (audit):** after a
sealed op, the audit entry and the streaming operation log render a
`.stamp-mark` glyph + "SEALED BY `<operator>` · `<timestamp>`".

**Streaming ops:** the existing NDJSON `streamOperation()` path is unchanged; the
seal press is simply what *starts* the stream. `<OperationProgress>` renders each
NDJSON line as an entry "struck from the register."

**Accessibility & reduced motion:**

- Fully keyboard operable: focus the seal, hold Space/Enter to fill the ring.
- `prefers-reduced-motion`: the ring fills without the bounce; the ink-press is a simple opacity swap, no travel.
- The two-step (type + hold) is deliberate friction proportional to consequence; it must never be bypassable.

**Component:** new `components/seal-confirm.tsx` (client) encapsulating phrase
input + armed state + press-and-hold ring + stamp callback. `confirm-delete.tsx`,
`[schema]/[table]/delete`, `delete-batch`, schema drop, and the SQL console's
LIVE-write path all compose it. Existing confirm-phrase logic and streaming
wiring are reused, not rewritten.

## 8. Motion (restrained, functional only)

- **Page-load (one orchestrated moment):** the masthead double rule "draws"
  left→right once (~200 ms); main content fades up 4px. Nothing else.
- **Hover:** row gets a faint `--surface-hover` tint; its underline rule
  thickens to `--border-strong`. Links thicken their underline.
- **The seal press is the only expressive motion in the app.**
- All of the above gated behind `@media (prefers-reduced-motion: no-preference)`;
  reduced-motion users get instant states and a non-bouncing seal.

## 9. Per-surface application

| Surface | Files | Ledger treatment |
| --- | --- | --- |
| Chrome | `app/(god)/layout.tsx` | masthead + target seal (§6) |
| Schemas | `app/(god)/schemas/page.tsx` | list on a leaf; double-rule under "Schemas"; counts oldstyle-tabular; LIVE registers carry a small seal; `→` folio-turn affordance |
| Tables | `app/(god)/[schema]/tables/page.tsx`, `components/schema-banner.tsx` | "register header" showing the opened register; tenant warning becomes an aged-amber stamped band, not a loud banner |
| Row grid | `app/(god)/[schema]/[table]/page.tsx`, `components/row-grid.tsx` | densest surface: hairline column verticals, tabular figures, sticky column-heading band, null = faint "—" |
| Insert / Edit | `.../insert`, `.../edit`, `components/row-form.tsx` | "form of entry" — rubric labels; primary button "Record entry"; edit lightly strikes the prior value |
| Delete / batch | `.../delete`, `.../delete-batch`, `components/confirm-delete.tsx` | **seal ceremony** (§7) |
| SQL console | `app/(god)/[schema]/sql/page.tsx`, `components/sql-console.tsx` | "the scriptorium": Plex Mono + light syntax tint; results as a ledger grid; a write statement against LIVE arms the seal |
| Audit = The Record | `app/(god)/audit/page.tsx` | ordinal seq (oldstyle, true chronological order), ts (Plex Mono), actor, action + `.stamp-mark` when sealed, day-separator double rules |
| Clusters | `app/(god)/clusters/**`, `components/clusters-table.tsx`, `business-units-table.tsx` | register of clusters via re-tokened `ui/table` |
| Amendments | `app/(god)/platform-migrations/page.tsx`, `components/platform-migrations.tsx`, `operation-log.tsx` | migrations = "amendments"; each posted line stamped when applied |
| Login | `app/login/**` | "front matter / title page": centred leaf, Fraunces "The Register of Carmen", ledger tabs, faint seal watermark |

## 10. Code scope

**Most of the work is re-tokening, not rewriting** — the `ui/*` primitives
already consume CSS variables, so they inherit the new palette for free.

1. `app/globals.css` — replace `:root` / `.dark` token blocks; swap `@theme inline` font vars; switch base body font to Newsreader; replace `.eyebrow`→`.rubric`, add `.rule-double`, `.seal`, `.stamp-mark`; delete `.hazard-tape` and target-dot pulse.
2. `app/layout.tsx` — load Fraunces + Newsreader + IBM Plex Mono via `next/font/google`; replace the three `variable`/`className` wirings; keep the pre-paint theme script.
3. `app/(god)/layout.tsx` — rebuild masthead + target seal (§6).
4. `components/seal-confirm.tsx` — new signature component (§7).
5. `components/confirm-delete.tsx` + delete/batch/SQL-write paths — compose `SealConfirm`.
6. `ui/*` (`button`, `badge`, `alert`, `card`, `table`, `page-header`, `input`, `textarea`, `checkbox`, `tabs`, `empty-state`, `skeleton`) — verify each against the new tokens; adjust radius/rule/typographic details where a component hard-codes them.
7. Page-level compositions (§9) — apply rubric labels, double rules, tabular figures, folio-turn affordances.
8. Tests — update assertions that reference `.eyebrow`, hazard-tape, target-dot, Martian Mono, or instrument-console copy to the Ledger vocabulary. **Behaviour assertions stay untouched.**

## 11. Quality floor

- Responsive to mobile: masthead stacks; row-grid and SQL results scroll horizontally; nav uses the existing scroll row.
- Visible keyboard focus everywhere (`--ring`); the seal is fully keyboard-operable.
- `prefers-reduced-motion` respected (masthead draw, hover, and seal all degrade gracefully).
- Full dark mode parity.
- WCAG: every text/bg pair ≥ 4.5:1 (3:1 large); no pure black/white.
- `bun run typecheck`, `bun run lint` (clean repo-wide — keep it), and all 176 `bun run test` cases green. Playwright E2E (`e2e/streaming-delete.spec.ts` and friends) still pass; update any selector/copy they assert against.

## 12. Open questions

None blocking. Font choices (Fraunces / Newsreader / IBM Plex Mono) are the
recommended set; if any fails a licensing or loading check against
`next/font/google`, the nearest substitutes are Petrona (display), Source Serif
4 (body), and JetBrains Mono (data) — swap without changing the token or layout
design.
