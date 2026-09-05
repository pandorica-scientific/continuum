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
2. **Every number is set in mono, except a headline figure.** Balances in a table,
   percentages, dates in lists, counts and tickers are `class="mono"`. The one exception,
   added in v0.8.1: a **headline** figure — the net-worth hero, a `MetricTile` value, a
   month's net, an account balance — is `class="display"`, which is the sans at 650 with
   `-0.03em` and tabular figures. Nothing else. A figure in a table row that reaches for
   `display` is a bug: the column stops aligning.
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

## The screen frame

Every screen draws the same things in the same order, from the same primitives,
and nothing else above its content:

1. **`ScreenHeader`** — the title with its mark, a one-line caption, and a
   sub-tab row where the area has more than one screen. Pass `emoji` instead of
   an icon where the screen IS a record the household named — a shelf, for
   instance — because drawing the area's icon beside its emoji is two marks for
   one thing.
2. **`SummaryBand`** — a row of `MetricTile`, and the only way figures appear at
   the top of a screen. A screen with no figures has no band. A figure takes a
   colour only when it is a task: `0 gaps` is the state the archive is for, and
   a red nought is an alarm about nothing.
3. **`ControlRow`** — search on the left, actions on the right. One primary
   action per screen, never two.
4. **The content.**
5. **The navigation** — a 264px sidebar at ≥1180, a 76px icon rail at 720–1179, a
   bottom bar below that, and on Documents a rail beside the content. One markup,
   three layouts: the shape is a function of the viewport and nothing else, so it
   is media queries inside `Sidebar.svelte` rather than a `variant` prop the
   server would have to guess.

**The primitives those five are built from**, added or reworked in v0.8.1:

- **`IconTile`** — a hue mixed into the ground behind a stroke icon or an emoji.
  The most repeated shape in the product: before a screen title, a panel title,
  a row, a card head, a nav row. Four sizes — 26 (panel title) · 30 (row) · 44
  (card) · 46 (screen title) — and the radius follows the size rather than being
  a prop, because a 26px tile at radius 14 and a 46px tile at radius 8 are both
  wrong and a caller choosing freely will eventually pick one.
- **`Switch`** — a form's submit button wearing a track and a knob, with
  `role="switch"` and `aria-checked`. A button and not a checkbox: every switch
  in the product sits alone in a `<form method="POST">` and IS the submission,
  and a checkbox would need script to submit anything.
- **`LineChart`** — lines over slots, optionally with stacked bars in their own
  band above them, each band on its own axis. It measures its box and draws at
  real pixel sizes; a scaled viewBox stretches the stroke and the type with the
  width. All the geometry is in `charts/line.ts`, which has no DOM and a test
  beside it.
- **`Segmented`**, **`Pill`**, **`MetricTile`**, **`Eyebrow`** — restyled, same
  contracts. `Eyebrow` takes `icon`, a name from `src/lib/icons.ts`, and never
  an emoji: an emoji is data the household chose (a shelf, an account), and
  `design/no-emoji-eyebrow` fails a build that passes one.
- **`DataTable`** — the one table. A screen brings `columns` (key, label,
  width, `hideBelow`), `groups` (key, open, rows) and the cells as snippets;
  the table draws the header strip (`--table-head`), the row line, the open
  group's ground (`--table-open`) with the hue's edge, the summary row and the
  hover. A group head is a button, or a link when `href` is given (the
  register, whose open month lives in the URL). `rowLayout="block"` hands a
  row the full width for a component with a grid of its own; `flat` draws
  rows with no heads. Transactions, Rules, Salary, Tax, Retirement and
  Holdings adopt it; a screen drawing its own `.thead` is the drift this
  exists to stop.
- **`select`** — skinned once in `app.css`: `appearance: none`, the stroke
  chevron from `--select-chevron` (one per theme, the one place a colour is
  written into a data URI), `--card` ground, hover `--surface-2`. A component
  sets a select's width or height and nothing else.

`tests/unit/screen-frame.test.ts` fails the build on a screen that draws its own
row of figures — three screens had grown their own summary band at three
different type sizes, which is what "the app looks different in different
places" actually looks like.

**`FigureGrid` is not a summary band**, and the difference is the pencil: a
summary tile is read, and a figure grid is read AND written. Property's value
and money-in are stored on the record rather than computed, and the place to
correct a figure is where it is wrong.

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

| Role                  | Size      | Weight           | Notes                                                |
| --------------------- | --------- | ---------------- | ---------------------------------------------------- |
| Screen title `h1`     | 30px      | 650              | `--font-display`, `-0.025em`, 46px area tile         |
| Screen caption        | 13.6px    | 400              | `--fg3`                                              |
| Section heading       | 22px      | 600              | `letter-spacing: -0.01em`                            |
| Section / panel title | 14px      | 600              | sentence case, behind a 26px hue tile                |
| Eyebrow (label only)  | 11px      | 400              | uppercase `0.1em` `--fg3` — column heads, hero label |
| Metric value          | 22–28px   | 650              | **`display`**, never mono                            |
| Metric label          | 12px      | 400              | `--fg3`                                              |
| Body / list row       | 13–13.5px | 400              |                                                      |
| Small caption         | 11.5–12px | 400              | `--fg3`                                              |
| Sidebar nav item      | 13.5px    | 500 (600 active) |                                                      |
| Sidebar group label   | 10.5px    | 400              | uppercase, `letter-spacing: 0.1em`                   |

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

**An edit form's Save and Cancel replace the control that opened it.** Pressing Edit at the
top of a panel and then scrolling fifteen fields to find Save is two journeys for one
decision, and on a long record the buttons are off the screen entirely.

- Main content padding `26px 32px 60px`; `22px 22px 60px` on a rail-width screen;
  `16px 14px 90px` on a phone, where the bottom bar owns the last 62px plus the
  safe area. Gap between sections `16px`.
- Navigation `264px` sidebar · `76px` rail · bottom bar (`src/routes/(app)/+layout.svelte`).
- Card padding: `18px 20px` content cards and panels, `16px 18px` metric tiles
  (`12px 14px` for one inside a panel).
- Grid gaps: `12px` metric rows, `16px` card grids. A summary band lays its tiles
  out as `repeat(auto-fit, minmax(200px, 1fr))` — a headline figure must never
  wrap, and equal `1fr` columns will squeeze five of them until it does.
- Radii, by what wears them (v0.8.1): `--radius-ctl` (10) buttons, inputs and segmented
  controls · `--radius-tile` (12) icon tiles and inner tiles · `--radius-card` (16) cards
  and panels · `--radius-pill` (999) pills, chips and avatars. All three are aliases of
  the scale — `--radius-2xl`, `--radius-xl`, `--radius-lg` — not new numbers.
- Borders are **1px** unless the width is carrying meaning: a panel's active edge (2px), the
  app's current-area marker (3px), and a dashed legend swatch are the whole list. `--bd`
  cards, `--bd2` inputs and emphasis.
- **Coloured borders on traffic-light pills, and on four states that are modes**: the rate
  banner (`orange` 35%), the selected person on sign-in (`brand` 55%), a panel being
  customised (`--brand`), and the retirement verdict (`blue` 30%). Nowhere else.
- **A card in the flow carries `--shadow-card`** — one value, quiet, and the same one
  everywhere. This reverses the pre-0.8.1 rule that nothing in the flow is raised: with
  white cards on light paper the 10% border alone was not telling a reader where a card
  began. It is still one value, and it is still from a token.
- **What is lit gets `--shadow-hero`** — the net-worth panel and the quick-add, and
  nothing else. **What floats gets `--shadow-float`**; a subtle lift is `--shadow-raise`.
  Those four are the whole set, and `design/no-raw-shadow` fails the build on any other
  value. A tooltip, a
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
subjects, each a household-editable field over a supplied default. **Not as a screen-title
prefix**: since v0.8.1 the area's icon sits in a 46px tile in the area hue, and a shelf's
emoji goes inside that same tile rather than in front of the sentence a screen reader
reads as the heading.

**Icon tiles.** A hue mixed into the ground behind a stroke icon, drawn by
`IconTile.svelte` and never by hand. Four sizes, and the radius follows the size rather
than being chosen: 26 (panel title) · 30 (row) · 44 (card) · 46 (screen title).

**Panel header.** An Overview panel's head is a 26px `IconTile` in the panel's own hue
then the title in sentence case at 14/600, on the left. On the right, a panel that summarises a screen carries a quiet `Open →` link to
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

## The net-worth tide

The hero's swell is two rotating near-circles in `--tide-up` or `--tide-down`,
fixed in both themes because the panel is dark in both (the light theme's
`--green` is darkened for AA on white and disappears on navy). It draws
whenever a month's delta exists: against the biggest month on record, or
against net worth itself in a household's first month. Reduced motion stops it
after one frame.

## Before you call it done

- [ ] No colour literal in the diff.
- [ ] Every figure is mono, except a headline figure, which is `display`.
- [ ] Checked both themes — toggle `data-ledger-theme` on `<html>`, don't assume.
- [ ] Reused an existing component, or can say why a new one was needed.
- [ ] Borders 1px unless the width means something; elevation from one of the four
      tokens; a coloured border only on a pill or one of the four named modes.
- [ ] Motion is `var(--dur)`/`var(--dur-slow)` on `var(--ease)`, and nothing else.
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
- **Two scrollable things taking turns** — a panel that scrolls inside a page that also
  scrolls hands the wheel on when it reaches its own end, so scrolling the inspector quietly
  scrolls the archive behind it, and scrolling back moves the wrong one first. **Anything
  with `overflow-y: auto` sitting over other scrollable content gets
  `overscroll-behavior: contain`** — the inspector, the rail, the modal, the sidebar, and
  every picker or chip list bounded by a `max-height`.

---

## When the system does not cover it

Say so, and choose deliberately rather than defaulting. Derive the new value from a
neighbour already in the system — the next step on the type scale, an existing radius —
rather than inventing a number. If it will recur, add a token, record it here, and record it
in `design_system/`. Both documents are meant to grow; only one of them is authoritative,
and it is the code.
