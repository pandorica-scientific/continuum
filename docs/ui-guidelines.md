# Building UI in Continuum

Read this before writing or changing any interface code in this repository.

Building the v0.3.8 ingest UI? The elements to build — queue and progress, the
single-question resolver, the mapping wizard, drift, arbitration review, provenance — are
specified in [`v0.3.8-ui-spec.md`](./v0.3.8-ui-spec.md). This document covers *how*; that
one covers *what*.

## Source of truth

**The codebase is the design system.** `src/lib/styles/app.css` holds the tokens,
`src/lib/components/` holds the primitives, and the routes under `src/routes/(app)/` hold
the screens. When anything disagrees with them, they win.

`design_system_V3/` is a **historical handoff**, not a specification. It records the design
intent the product was built against and has since drifted from the code in measurable
ways. Treat it as background and as a source of *rationale* — it explains why things are
the way they are far better than the code does — but never as the authority on a value.

---

## Task zero: refresh the design system from the code

Before doing design work here, reconcile the handoff with reality. Confirmed drift, as a
starting worklist — each verified against the code:

| `design_system_V3/README.md` claims | The code does |
|---|---|
| Inter "loaded from Google Fonts"; "self-host them in the real implementation" (L242, L919) | Already self-hosted — `@fontsource-variable/inter` and `@fontsource/source-code-pro` imported in `src/routes/+layout.svelte`. **The CDN sentence now contradicts the product's "Nothing calls home" promise.** |
| Inter weights 400/500/600/700; Source Code Pro 400/500/600 (L242) | Inter is the **variable** face (full range); Source Code Pro loads 400/500/600 only |
| Traffic-light pill `padding: 3px 11px` (L281) | `Pill.svelte` → `padding: 2px 10px`, plus `font-weight: 600`, `line-height: 1.2`, `white-space: nowrap`, none of which the handoff records |
| Tints "0.18 alpha dark, 0.12 light" (L279) | Dark tints 0.18 ✓; **light tints are 0.13–0.16**, and the bright-hue mixing rule is missing from the pill section entirely |
| Metric tile card padding `14px 16px` (L267) | `MetricTile.svelte` → `12px 14px` |
| "Seven areas hold twelve screens" (L291, L338) | **19 route directories** under `src/routes/(app)/` — `calendar`, `contacts` and `files` arrived in v0.3.6–0.3.7 and are undocumented |
| Sidebar fixed `252px` (L265) | ✓ still accurate — `src/routes/(app)/+layout.svelte:213` |

**Method for the refresh:**

1. Extract every token from `app.css` — both themes — and regenerate the colour and
   typography tables from the file rather than editing prose. Keep the long explanatory
   comments; they carry reasoning the values cannot.
2. Read each component in `src/lib/components/` and record its *actual* geometry. The
   components are the primitives; the handoff's numbers are aspirations.
3. Walk `src/routes/(app)/` for the real screen inventory and navigation structure.
4. For each drift, decide explicitly: **was the code right, or the design?** Fix whichever
   is wrong. Do not silently rewrite the doc to match a value that was a mistake — the
   metric-tile padding may be drift worth reverting, while the font change is the code
   correctly outgrowing the doc.
5. Delete claims that are now false. A handoff that says "self-host them in the real
   implementation" reads as an open task when it is finished work.

Keep everything below in sync as you go — it is written from the code as of this pass.

---

## The three non-negotiables

1. **Never write a colour literal.** Every colour comes from a token in `app.css`. A hex in
   a component is a bug: it will be wrong in one of the two themes, and nobody notices
   until a screenshot.
2. **Every number is set in mono.** Balances, percentages, dates in lists, counts, tickers.
   `class="mono"` or `font-family: var(--font-mono)`. Load-bearing for scannability, not
   taste.
3. **Reuse before you create.** Check `src/lib/components/` first. Drift between two
   near-identical cards is this codebase's most common defect.

---

## Themes

Dark is the **default and the base**; light is an **explicit opt-in** with no system
fallback, deliberately.

```css
:root { color-scheme: dark;  /* dark tokens */ }
html[data-ledger-theme='light'] { color-scheme: light; /* light tokens */ }
```

Define nothing theme-specific inside a component — style through tokens and both themes
follow. If you need a value that differs by theme, add a token; do not branch in the
component.

`color-scheme` is set so the **browser** paints its own chrome, scrollbars above all.
Without it a white scrollbar track runs down every scrollable page, and since nothing in
the app draws that bar it is very hard to find.

### The tint rule — the counter-intuitive one

In light theme, tints are mixed from **bright hues that appear nowhere else**, never from
the ink used for text. Two reasons, and the second bites:

- a tint mixed from dark ink is mud — amber from `#8a5900` reads olive;
- a brighter tint is a **lighter ground**, so dark ink on it measures *higher* contrast.

So **if a pill fails contrast, darken the ink and leave the tint alone.** Re-mixing the tint
from the darkened ink chases its own tail: the ground falls with the text.

Three levels per hue, not interchangeable:

| Token | Alpha | Use |
|---|---|---|
| `--<hue>` | — | text, or a 1px border |
| `--<hue>-tint` | 0.18 dark / 0.13–0.16 light | pill fills |
| `--<hue>-wash` | ~0.06 | tile and card grounds carrying a hue without becoming a pill |

---

## Type

Inter variable for text, Source Code Pro for figures — **both self-hosted**, imported in
`src/routes/+layout.svelte`. Body base 16px / 1.55.

| Role | Size | Weight | Notes |
|---|---|---|---|
| Screen title `h1` | 28px | 600 | `letter-spacing: -0.02em`, emoji-prefixed |
| Screen caption | 13.6px | 400 | `--fg3` |
| Section heading | 22px | 600 | `letter-spacing: -0.01em` |
| Eyebrow (section or card) | 11px | 400 | uppercase, `letter-spacing: 0.1em`, `--fg3` |
| Metric value | 18–19px | 600 | **mono** |
| Metric label | 12px | 400 | `--fg3` |
| Body / list row | 13–13.5px | 400 | |
| Small caption | 11.5–12px | 400 | `--fg3` |
| Sidebar nav item | 13.5px | 400 (500 active) | |
| Sidebar group label | 10.5px | 400 | uppercase, `letter-spacing: 0.1em` |

Foreground ramp: `--fg1` primary, `--fg2` secondary, `--fg3` muted. Never dim text with
opacity.

---

## Space, radius, border

- Main content padding `26px 32px 60px`; gap between sections `26px`.
- Sidebar `252px` (`src/routes/(app)/+layout.svelte:213`).
- Card padding: `12px 14px` metric tiles (per `MetricTile.svelte`), `16px 18px` content
  cards.
- Grid gaps: `12px` metric rows, `16px` card grids.
- Radii: `8px` buttons and inputs · `9–10px` cards and tiles · `12px` pills · `20px` chips ·
  `999px` avatars.
- Borders are **always 1px**. `--bd` cards, `--bd2` inputs and emphasis.
- **Coloured borders only on traffic-light pills.** Nowhere else.
- **No shadows anywhere.** The only halo is the text outline on chart labels.

Lay out sibling groups with flex or grid and `gap`, not per-element margins.

---

## The traffic-light pill

The signature element, and the one with real semantics:

- **green / yellow / red always mean state** — good, watch, bad. Never decorative.
- **blue / teal / purple carry a data series.**
- **grey is neutral.**

Use `<Pill hue="green">`; the hue union lives in `$lib/ui/hue.ts` so pills and Overview
panels name one set without drifting. Do not hand-roll a pill.

---

## Icons

Inline SVG only, through `<Icon name="..." />`. One geometry: 24 viewBox, `fill: none`,
`stroke: currentColor`, `stroke-width: 1.7`, round caps and joins. Colour from context.
Sizes: 19px sidebar, 26px screen title (`--brand`), 16px header buttons.

**Never link an icon library or any CDN** — this ships self-hosted and must not call out.
Add new glyphs to `$lib/icons` as paths.

Emoji survive only at card level (briefing kinds, account rows) and as screen-title
prefixes. Not as section markers in new UI.

Pass `Icon` a `label` **only** when it carries meaning no nearby text repeats.

---

## Svelte conventions

Runes mode is forced project-wide.

```svelte
<script lang="ts">
	import type { Snippet } from 'svelte';
	let { label, value, children }: { label: string; value: string; children?: Snippet } = $props();
	const display = $derived(value.trim());
</script>
```

- `$props()` with an inline type, `$derived` for computed values, `$state` for local state.
- `children: Snippet` with `{@render children()}` for slots.
- Component-scoped `<style>`; no global CSS from a component.
- `style:prop={...}` for genuinely dynamic values (a hue), not for layout.

Base control styling for `input`, `select` and `textarea` already lives in `app.css` —
border, background, colour, radius, padding, font-size. **Do not restate those six
properties**; that duplication caused drift across two screens in a day.
`input[type='file']::file-selector-button` is styled there too, because the browser draws
that button and it inherits nothing.

---

## Before you call it done

- [ ] No colour literal in the diff.
- [ ] Every figure is mono.
- [ ] Checked both themes — toggle `data-ledger-theme` on `<html>`, don't assume.
- [ ] Reused an existing component, or can say why a new one was needed.
- [ ] Borders 1px; no shadows; coloured border only on a pill.
- [ ] Pill hue means state, not decoration.
- [ ] Keyboard focus visible; `prefers-reduced-motion` respected if anything animates.
- [ ] Wide content scrolls in its own `overflow-x: auto` container — the body never scrolls
      sideways.
- [ ] Columns of digits use `font-variant-numeric: tabular-nums`.
- [ ] `npm run lint` and `npm run check` pass.
- [ ] If you changed a primitive, updated `design_system_V3/` in the same pass.

---

## Traps this codebase has already hit

Each cost a debugging session. They are in the code with comments; they are here so you
don't rediscover them.

- **A white bar down the right of long pages** — missing `color-scheme`, so the browser drew
  its scrollbar in the light scheme.
- **Content jumping sideways between screens** — pages short enough not to scroll are ~15px
  wider without `scrollbar-gutter: stable`, and anything anchored right moves.
- **A light grey chip inside a dark card** on four upload forms — the file input's
  browser-drawn button inherits nothing.
- **A lone sub-tab pill** — an area with one screen renders no tab row. A single pill is a
  label pretending to be a choice.
- **A wrapping tab row** shifting content down by a variable amount — the Money area's seven
  pills scroll sideways instead.
- **A pill failing contrast in light theme** — darken the ink, never the tint.

---

## When the system does not cover it

Say so, and choose deliberately rather than defaulting. Derive the new value from a
neighbour already in the system — the next step on the type scale, an existing radius —
rather than inventing a number. If it will recur, add a token, record it here, and record it
in `design_system_V3/`. Both documents are meant to grow; only one of them is authoritative,
and it is the code.
