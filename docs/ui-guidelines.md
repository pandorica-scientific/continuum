# Building UI in Continuum

Read this before writing or changing any interface code in this repository.

## Source of truth

**The codebase is the design system.** `src/lib/styles/app.css` holds the tokens,
`src/lib/components/` holds the primitives, and the routes under `src/routes/(app)/` hold
the screens. When anything disagrees with them, they win.

`design_system/` is a **historical handoff**, not a specification. It records the design
intent the product was built against and has since drifted from the code in measurable
ways. Treat it as background and as a source of _rationale_ — it explains why things are
the way they are far better than the code does — but never as the authority on a value.

---

## The handoff, and what it still owes

`design_system/README.md` was refreshed for v0.3.8: it gained the **Ingest**
section (eleven elements, the proof-hue vocabulary, the modal-vs-screen split, the mapping
wizard's four bands) and an error/empty-states chapter. That part is current and
authoritative for _design intent_ — build from it.

The older chapters were **not** reconciled with the code in that pass. Six factual values
have since been corrected in place against the source:

| Was                                         | Now                                      | Verified against            |
| ------------------------------------------- | ---------------------------------------- | --------------------------- |
| Inter "loaded from Google Fonts"            | self-hosted `@fontsource-variable/inter` | `src/routes/+layout.svelte` |
| Pill `padding: 3px 11px`                    | `2px 10px`                               | `Pill.svelte`               |
| Metric tile padding `14px 16px`             | `12px 14px`                              | `MetricTile.svelte`         |
| Tints "0.18 dark, 0.12 light"               | "0.18 dark, 0.13–0.16 light"             | `app.css`                   |
| "Seven areas hold twelve screens"           | nineteen screens                         | `src/routes/(app)/`         |
| "Self-host them in the real implementation" | already done                             | `package.json`              |

**Still outstanding** — worth a design pass, not a code pass:

- `calendar`, `contacts` and `files` have no screen chapter (arrived v0.3.6–0.3.7).
- The bright-hue tint-mixing rule (below) is in `app.css` comments but not in the handoff's
  pill section, which is where a designer would look for it.

When the two disagree on a value, **the code wins** and the handoff gets corrected — never
the reverse, unless the code is the thing that drifted.

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

**Where a new component goes**, since both places are in use and neither was written
down: `src/lib/components/` is the default and holds most of them, including ones only
one screen uses today. A component moves into a feature directory —
`src/lib/charts/`, `src/lib/overview/`, `src/lib/scan/`, `src/lib/documents/` — only
when it ships with its own logic layer and would travel with it. The question is not
"how many screens use this", it is "does this component belong to a subsystem that has
modules of its own".

---

## Themes

Dark is the **default and the base**; light is an **explicit opt-in** with no system
fallback, deliberately.

```css
:root {
	color-scheme: dark; /* dark tokens */
}
html[data-ledger-theme='light'] {
	color-scheme: light; /* light tokens */
}
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
- a brighter tint is a **lighter ground**, so dark ink on it measures _higher_ contrast.

So **if a pill fails contrast, darken the ink and leave the tint alone.** Re-mixing the tint
from the darkened ink chases its own tail: the ground falls with the text.

Three levels per hue, not interchangeable:

| Token          | Alpha                       | Use                                                          |
| -------------- | --------------------------- | ------------------------------------------------------------ |
| `--<hue>`      | —                           | text, or a 1px border                                        |
| `--<hue>-tint` | 0.18 dark / 0.13–0.16 light | pill fills                                                   |
| `--<hue>-wash` | ~0.06                       | tile and card grounds carrying a hue without becoming a pill |

---

## Type

Inter variable for text, Source Code Pro for figures — **both self-hosted**, imported in
`src/routes/+layout.svelte`. Body base 16px / 1.55.

**Sizes come from the ramp, never from a number you picked.** `--text-2xs` 10 · `--text-xs`
11 · `--text-sm` 12 · `--text-md` 13 · `--text-lg` 14 · `--text-xl` 16 · `--text-2xl` 19 ·
`--text-3xl` 22 · `--text-4xl` 28. The table below is what each role resolves to; where it
still shows a half-pixel value, the code has since been snapped to the nearest step. There
used to be twenty-two distinct sizes, four of them within a pixel of each other in 267
declarations — which is what "the app uses different fonts in different places" actually
looks like. Add a step here rather than a one-off px value in a component.

| Role                      | Size      | Weight           | Notes                                       |
| ------------------------- | --------- | ---------------- | ------------------------------------------- |
| Screen title `h1`         | 28px      | 600              | `letter-spacing: -0.02em`, emoji-prefixed   |
| Screen caption            | 13.6px    | 400              | `--fg3`                                     |
| Section heading           | 22px      | 600              | `letter-spacing: -0.01em`                   |
| Eyebrow (section or card) | 11px      | 400              | uppercase, `letter-spacing: 0.1em`, `--fg3` |
| Metric value              | 18–19px   | 600              | **mono**                                    |
| Metric label              | 12px      | 400              | `--fg3`                                     |
| Body / list row           | 13–13.5px | 400              |                                             |
| Small caption             | 11.5–12px | 400              | `--fg3`                                     |
| Sidebar nav item          | 13.5px    | 400 (500 active) |                                             |
| Sidebar group label       | 10.5px    | 400              | uppercase, `letter-spacing: 0.1em`          |

Foreground ramp: `--fg1` primary, `--fg2` secondary, `--fg3` muted. Never dim text with
opacity.

---

## Space, radius, border

**Radius and gap come from the scale**: `--radius-xs/sm/md/lg/xl/2xl/pill` (4 · 6 · 8 · 10 ·
12 · 16 · 999) and `--space-1…8` (2 · 4 · 6 · 8 · 10 · 12 · 14 · 16). `design/no-raw-geometry`
fails the build on a raw px value for `border-radius` or any `gap` **when the scale already
names that number** — including every part of a shorthand, so `gap: 8px 14px` is caught as
surely as `gap: 8px`. A shorthand that already names one axis (`var(--space-4) 3px`) is left
alone: that is a decision about one side, not a number that drifted in. The escape hatch is
`/* geometry-exempt: why */`, deliberate and greppable. Padding is deliberately not policed: 51 distinct pairs, dominated by odd
horizontal values, so a scale there would be a restyle rather than a description.

**One control height.** `--control-h` (36px) is the floor for every input, select, textarea
and `.btn`, applied in `app.css`. A row of controls agrees without any of them being told
about the others.

- Main content padding `26px 32px 60px`; gap between sections `26px`.
- Sidebar `252px` (`src/routes/(app)/+layout.svelte:213`).
- Card padding: `12px 14px` metric tiles (per `MetricTile.svelte`), `16px 18px` content
  cards.
- Grid gaps: `12px` metric rows, `16px` card grids.
- Radii: `8px` buttons and inputs · `9–10px` cards and tiles · `12px` pills · `20px` chips ·
  `999px` avatars.
- Borders are **1px** unless the width is carrying meaning: a panel's active edge (2px), the
  app's current-area marker (3px), and a dashed legend swatch are the whole list. `--bd`
  cards, `--bd2` inputs and emphasis.
- **Coloured borders only on traffic-light pills.** Nowhere else.
- **Nothing in the document flow is raised.** A card is separated by its ground and its
  border; a shadow there is decoration standing in for a boundary that already exists.
- **What floats gets `--shadow-float`**; a subtle lift is `--shadow-raise`. Those two are the
  whole set, and `design/no-raw-shadow` fails the build on any other value. A tooltip, a
  picker or a menu sits over unpredictable content, and its shadow is the only thing telling
  a reader where the page stopped — that is information, not styling.
- **`inset` is not a shadow.** `box-shadow: inset 3px 0 0 var(--teal)` is a left rail marker,
  drawn with the one property that paints inside a cell without taking layout space.
- **A floating element is painted with an opaque token** — `--bg` or `--bg2`, never `--card`,
  `--card2` or `--card3`. Those three are translucent in the dark theme and opaque hex in the
  light one, so a tooltip painted with them looks right until somebody switches themes.
  `design/opaque-floating-surface` fails the build on it.

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
Sizes: 19px sidebar, 26px screen title (`--brand`), 16px header buttons, 14px panel and
briefing-card eyebrows.

**Never link an icon library or any CDN** — this ships self-hosted and must not call out.
Add new glyphs to `$lib/icons` as paths.

Emoji survive only on the rows that carry an emoji of their own — accounts, shelves and
subjects, each a household-editable field over a supplied default — and as screen-title
prefixes. Not as section markers in new UI: the Overview's panel eyebrows and the briefing
cards each name an icon now.

**Panel header.** An Overview panel's eyebrow is `<Icon size={14} />` then the title, on
the left. On the right, a panel that summarises a screen carries a quiet `Open →` link to
it (`--fg3`, no underline) — and only there, never at the foot of the body. While the
board is being customised the link gives way to the move, resize and remove controls: the
header belongs to arranging, and a link there is one more thing a stray tap can follow.

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
border, background, colour, radius, padding, font-size, **line-height and `min-height`**.
**Do not restate any of them**; that duplication caused drift across two screens in a day,
and restating the padding is what made one dialog's file field half again as tall as the
select beside it. The last two are what make a row line up at all: left to the browser, a
text input, a select and a textarea of the same nominal size come out at three different
heights. `input[type='file']` and its `::file-selector-button` are styled there too —
the browser draws that button, it inherits nothing, and its intrinsic height is what a
file field takes unless the stylesheet puts it inside `--control-h`.

A control that is deliberately smaller — an inline toggle inside a sentence, a compact save
on a list row — says `min-height: auto` for itself. That is the opt-out, and it should be
rare enough to notice.

---

## Before you call it done

- [ ] No colour literal in the diff.
- [ ] Every figure is mono.
- [ ] Checked both themes — toggle `data-ledger-theme` on `<html>`, don't assume.
- [ ] Reused an existing component, or can say why a new one was needed.
- [ ] Borders 1px unless the width means something; elevation from a token; coloured
      border only on a pill.
- [ ] Pill hue means state, not decoration.
- [ ] Keyboard focus visible; `prefers-reduced-motion` respected if anything animates.
- [ ] Wide content scrolls in its own `overflow-x: auto` container — the body never scrolls
      sideways.
- [ ] Columns of digits use `font-variant-numeric: tabular-nums`.
- [ ] `npm run lint` and `npm run check` pass.
- [ ] If you changed a primitive, updated `design_system/` in the same pass.

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
- **A row of fields at four different heights** — 42px file field, 36px selects, 34px text
  inputs, 32px button, and the row `align-items: end`, so the tallest rode _up_ rather than
  sitting lower. Every one of them looked individually fine; only side by side does it read
  as "a few pixels too high".
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
in `design_system/`. Both documents are meant to grow; only one of them is authoritative,
and it is the code.
