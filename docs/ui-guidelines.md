# Building UI in Continuum

Read this before writing or changing interface code. It describes the system a new screen
or component has to fit into.

## Where things live

- `src/lib/styles/app.css` — every token, plus the base layer for controls, buttons and
  the small shared marks. The source of truth for any value.
- `src/lib/components/` — the primitives. `src/lib/charts/` — charts and their geometry.
- `src/routes/(app)/` — the screens, under one layout that owns the navigation frame.
- `src/lib/modules/registry.ts` — the areas, their screens, their icons and their hues.
- `design_system/` — design canvases and handoff notes, plus `TOKENS.md`, generated from
  `app.css` by `scripts/design-tokens.mjs`. Read it for rationale; when it disagrees with
  the stylesheet the stylesheet wins. Run `npm run design:tokens` after changing a token.

## Three rules that are never bent

1. **Never write a colour literal.** Every colour comes from a token in `app.css`. A hex
   in a component is wrong in one of the two themes, and nobody notices until a
   screenshot.
2. **Every number is set in mono, except a headline figure.** Balances in a table,
   percentages, dates in lists, counts and tickers take `class="mono"`. A **headline**
   figure — the net-worth hero, a `MetricTile` value, a month's net, an account balance —
   takes `class="display"`: the sans at 650 with `-0.03em` and tabular figures. Nothing
   else. A figure in a table row that reaches for `display` breaks the column's alignment.
3. **Reuse before you create.** Check `src/lib/components/` first. Two near-identical
   cards slowly diverging is this codebase's most common defect.

## The screen frame

Every screen draws the same things in the same order and nothing else above its content.

1. **`ScreenHeader`** — the title with its mark, a one-line caption, and a sub-tab row
   where the area has more than one screen. It takes the area's icon and hue from the
   registry and sets the browser tab title. An `actions` snippet holds the screen's single
   primary action. Pass `emoji` instead of an icon where the screen IS a record the
   household named — a shelf, an account — because drawing the area's icon beside its
   emoji is two marks for one thing. An area with one screen renders no tab row: a lone
   pill is a label pretending to be a choice.
2. **`SummaryBand`** — a row of `MetricTile`, and the only way figures appear at the top
   of a screen. It takes `tiles: Tile[]` (`src/lib/components/tiles.ts`). A screen with no
   figures has no band. A tile takes `color` only when the figure is a task: `0 gaps` is
   the state the archive is for, and a red nought is an alarm about nothing. `wash` names
   a hue that grounds the tile — identity, not state.
3. **`ControlRow`** — `left` and `right` snippets, one row at control height. Search on
   the left, actions on the right. One primary action per screen, never two.
4. **The content.**
5. **The navigation**, drawn by `src/routes/(app)/+layout.svelte`: a 264px `Sidebar` at
   ≥1180px, a 76px icon rail at 720–1179px, and below 720px a `BottomBar` with the sidebar
   becoming a 264px drawer. One markup, three layouts — the shape is a function of the
   viewport, so it is media queries rather than a `variant` prop the server would have to
   guess. The layout also owns the floating quick-add button and the skip link.

`tests/unit/screen-frame.test.ts` reads every `+page.svelte` and fails the build on a
screen that draws its own row of figures or renders a `MetricTile` outside a
`SummaryBand`.

**`FigureGrid` is not a summary band.** The difference is the pencil: a summary tile is
read, a figure grid is read AND written, because a property's value and money-in are
stored on the record rather than computed. Its geometry matches `MetricTile` to the pixel.

## Primitives

- **`IconTile`** — a hue mixed into the ground behind a stroke icon or an emoji, and the
  most repeated shape in the product: before a screen title, a panel title, a row, a card
  head, a nav row. Props: `hue` (a token name, dashes optional), `size`, `icon`, `emoji`,
  `active`, `label`. The named sizes are 26 (panel title) · 30 (row, the default) · 44
  (card) · 46 (screen title); the radius and glyph size follow `size` rather than being
  props. The ground is the hue at `--tile-alpha`, or `--tile-alpha-active` when `active`.
- **`Eyebrow`** — a section head: a 26px `IconTile`, the name in sentence case at
  `--text-lg`/600, and a `caption` and/or a `right` snippet. It takes `icon`, a name from
  `src/lib/icons.ts`, never an emoji — `design/no-emoji-eyebrow` fails a build otherwise.
- **`Pill`** — the traffic light. `<Pill hue="green">`; the union lives in
  `$lib/ui/hue.ts` so pills and Overview panels name one set. Mono, `--text-xs`/600, the
  hue as ink and border over `--<hue>-tint`. Do not hand-roll one.
- **`MetricTile`** — label, `display` value, optional `unit` and `note`, `color` for a
  state, `wash` for identity, `compact` for a tile inside a panel.
- **`Segmented`** — a bindable choice of short options at `--radius-ctl`, the chosen one
  lifted onto `--surface-3`.
- **`Switch`** — a form's submit button wearing a track and a knob, with `role="switch"`,
  `aria-checked` and a required `label`. A button and not a checkbox: every switch sits
  alone in a `<form method="POST">` and IS the submission, and a checkbox would need
  script. Green when on, because it reads as "running".
- **`Modal`** — `title`, `onclose`, children, `use:overlayFocus` for the focus trap, an
  opaque ground, and `titleAside` for a badge beside the title.
- **`DataTable`** and **`Icon`** — see [Tables](#tables) and
  [Icons and emoji](#icons-and-emoji). The rest of the shared vocabulary is `Field`,
  `TagField`, `TagInput`, `EmojiPicker`, `CategoryPicker`, `PersonTag`, `ListPager`,
  `PageSize`, `InfoHint`, `UploadDropzone`, `Lightbox`, `FileViewer`, `ErrorScreen` and
  `ActionError`. Read the one you need before writing a near-copy of it.

Marks defined once in `app.css` rather than per component: `.card`, `.mono`, `.display`,
`.quiet`, `.section`, `.field`, `.btn`, `.btn-primary`, `.icon-btn`, `.eyebrow`,
`.eyebrow-row`, `.eyebrow-caption`, `.chips`, `.pick-chip`, `.chip-x`, `.skip-link`. A
component may override any of them locally; Svelte's scoping wins.

## Colour

Surfaces run `--bg` and `--bg2` (the page), `--side` (the navigation), `--card`,
`--card2`, `--card3` (a card, something on a card, something on that), and `--surface`,
`--surface-2`, `--surface-3` (the lit grounds a card, a hover and an active segment sit
on). `--plate` is a themed scrim. Ink runs `--fg1` primary, `--fg2` secondary, `--fg3`
muted, `--fg-inverse` on a filled button; never dim text with opacity. Borders are `--bd`
on cards, `--bd2` on inputs and anything emphasised.

The hue set is `--green --yellow --red --blue --purple --orange --teal --indigo --brand`,
plus grey, which exists only as a tint and a wash. Each hue has three levels, and they are
not interchangeable:

| Token          | Use                                                      |
| -------------- | -------------------------------------------------------- |
| `--<hue>`      | text, or a 1px border                                    |
| `--<hue>-tint` | pill fills — 0.18 dark (grey 0.16), 0.13–0.16 light      |
| `--<hue>-wash` | tile and card grounds carrying a hue without being pills |

Washes are 0.07 in the dark theme and mixed 10–16% into white in the light one: values
tuned against a dark ground vanish on paper.

**The traffic light has semantics.** Green, yellow and red always mean state — good,
watch, bad — and are never decorative. Blue, teal and purple carry a data series. Grey is
neutral.

A coloured border belongs on a pill, and otherwise only where it marks a state or an
identity — a selected row, a dropzone under a drag, a verdict. Write it as
`color-mix(in srgb, var(--hue) N%, transparent)`. Everything else takes `--bd` or `--bd2`.

Category series are their own family — `--series-income`, `--series-taxes`,
`--series-bills`, `--series-subscriptions`, `--series-health`, `--series-transport`,
`--series-living`, `--series-housing`, `--series-savings` — with a `-soft` step for
jurisdictions and `--series-r1`…`--series-r10` in reserve for groups a household adds,
assigned in order. They are generated in OKLCH and measured for separation under normal,
protan and deutan vision. A series colour used as **ink** — a category chip, a tag name,
an initials avatar — is darkened by mixing `--series-ink-mix` of `--fg1` into it: the
bright values are right for a bar and too light for eleven-pixel text on paper.

## Type

Inter Variable for text, Source Code Pro for figures, both self-hosted from
`@fontsource-variable/inter` and `@fontsource/source-code-pro`, imported in
`src/routes/+layout.svelte`. Body is `--text-xl` (16px) at 1.55.

**Sizes come from the ramp, never from a number you picked**: `--text-2xs` 10 ·
`--text-xs` 11 · `--text-sm` 12 · `--text-md` 13 · `--text-lg` 14 · `--text-xl` 16 ·
`--text-2xl` 19 · `--text-3xl` 22 · `--text-4xl` 28 · `--text-5xl` 30. Add a step here
rather than a one-off px value in a component.

Headline figures have their own set: `--font-display` (the sans), `--display-tracking`
(`-0.03em`), and `--display-hero` 26 · `--display-figure` 24 · `--display-sm` 20 ·
`--display-xs` 17. The `.display` class binds them with 650 weight, tabular figures and
`white-space: nowrap` — a figure that wraps stops being a figure.

| Role                  | Size                             | Weight | Notes                                     |
| --------------------- | -------------------------------- | ------ | ----------------------------------------- |
| Screen title `h1`     | `--text-5xl` (`--text-4xl` <720) | 650    | `--font-display`, `-0.025em`, 46px tile   |
| Screen caption        | `--text-md`                      | 400    | `--fg3`                                   |
| Section / panel title | `--text-lg`                      | 600    | sentence case, behind a 26px tile         |
| `.eyebrow` label      | `--text-xs`                      | 400    | uppercase `0.1em`, `--fg3` — column heads |
| Metric value          | `--text-4xl`                     | 650    | `display`, never mono                     |
| Metric label          | `--text-sm`                      | 400    | `--fg3`; the note is `--text-xs`          |
| Pill                  | `--text-xs`                      | 600    | mono                                      |
| Body / list row       | `--text-md`                      | 400    |                                           |
| Quiet caption         | `--text-sm`                      | 400    | `--fg3` — `.quiet`                        |

## Space, radius, border

Radius and gap come from the scale: `--radius-xs/sm/md/lg/xl/2xl/pill` (4 · 6 · 8 · 10 ·
12 · 16 · 999) and `--space-1…8` (2 · 4 · 6 · 8 · 10 · 12 · 14 · 16).
`design/no-raw-geometry` fails the build on a raw px value for `border-radius`, `gap`,
`row-gap` or `column-gap` **when the scale already names that number**, including every
part of a shorthand. A shorthand mixing a token with a number (`var(--space-4) 3px`) is
left alone: that is a decision about one axis. The escape hatch is
`/* geometry-exempt: why */` on the line above, and it must give a reason. Padding is
deliberately not policed — the product uses odd horizontal values in dozens of places.

Three radii are named by what wears them, as aliases of the scale: `--radius-ctl` (10) for
buttons, inputs, selects and segmented controls; `--radius-tile` (12) for inner tiles;
`--radius-card` (16) for cards, panels and metric tiles. `--radius-pill` (999) is for
anything fully rounded — a sub-tab, an avatar, a switch knob, the quick-add.

**One control height.** `--control-h` (36px) is the floor for every input, select,
textarea and `.btn`, applied in `app.css`, so a row of controls agrees without any of them
being told about the others.

- Main content padding `26px 32px 60px`, `22px 22px 60px` at rail width, `16px 14px 90px`
  on a phone, where the bottom bar owns the last 62px plus the safe area. `--space-8`
  between sections.
- Card padding `18px 20px`; metric tiles `var(--space-8) 18px`, and
  `var(--space-6) var(--space-7)` for one inside a panel.
- A summary band is `repeat(auto-fit, minmax(200px, 1fr))` with `--space-6` between: a
  headline figure must never wrap, and equal `1fr` columns will squeeze five of them until
  it does. Below 720px it folds to two columns.
- Borders are 1px unless the width carries meaning — a 2px dashed legend swatch, a 2px
  resize edge on an Overview panel. A group's open edge is
  `box-shadow: inset 3px 0 0 var(--hue)`, which paints inside a cell without taking layout
  space; `inset` is not elevation and the shadow rule leaves it alone.

Lay out sibling groups with flex or grid and `gap`, not per-element margins.

## Elevation

Four values, and `design/no-raw-shadow` allows nothing else besides `none`, `inherit` and
any `inset` (`/* shadow-exempt: why */` is the escape hatch and must give a reason):

- `--shadow-card` — a card in the document flow. One quiet value, the same everywhere.
- `--shadow-hero` — what is meant to read as lit: the net-worth panel, the sign-in panel,
  the quick-add. Nothing else.
- `--shadow-float` — a tooltip, a picker, a menu. Its shadow is the only thing telling a
  reader where the page stopped, which is information rather than styling.
- `--shadow-raise` — a subtle lift.

**A floating element is painted with an opaque token** — `--bg` or `--bg2`, never
`--card`, `--card2` or `--card3`, which are translucent in the dark theme and opaque hex
in the light one, so a tooltip painted with them looks right until somebody switches
themes. `design/opaque-floating-surface` fails the build on a `position: absolute` or
`fixed` rule that paints its background with one.

## Motion

`--dur` (150ms) and `--dur-slow` (260ms) on `--ease`, and nothing else. A button press is
90ms, short enough to register on a fast click. `app.css` collapses animations _and_
transitions to 1ms under `prefers-reduced-motion`, re-asserting only the button's 90ms
colour feedback, which is the part carrying the information. The net-worth tide in the
sidebar is two rotating near-circles in `--tide-up` or `--tide-down`; reduced motion stops
it after one frame.

## Charts

`src/lib/charts/` holds the components — `LineChart`, `Sankey`, `SalaryYearChart`,
`TaxYearChart`, `LoanSchedule`, `FlowCard`, `ShareBar`, `MonthPairs`, `Delta`,
`PeriodControls` — and, separately, the geometry: `line.ts`, `sankey.ts`, `donut.ts`,
`delta.ts`, `flow-graph.ts`, `salary-chart-geometry.ts`, `tax-chart-geometry.ts`, each
with no DOM in it and a test beside it. Put a new chart's arithmetic there and keep the
component as markup over it.

- `plot.ts` holds the band every chart draws into — `VIEW_W` 1000, `X_LEFT` 56, `X_RIGHT`
  992, and `slotFor` for the centre of a categorical slot. The gutter is shared because
  two charts on one screen with different left margins reads as a rendering fault.
- `ticks.ts` decides axis labels: months below two years of history, years at or above.
- `tone.ts` gives the colour token for a signed figure. Zero is green — flipping to red at
  exactly break-even reports a rounding artefact as bad news.
- `LineChart` draws lines over slots, optionally with stacked bars in their own band above
  them, each band on its own axis. It measures its box and draws at real pixel sizes; a
  scaled viewBox stretches the stroke and the type with the width. It takes a `title` for
  a screen reader, a `readout` snippet for the slot under the pointer, and a `legend`.
- Colour comes from the `--series-*` families. Never spend a traffic-light hue on a
  series, and never rely on colour alone: the legend names every series and the hover
  readout repeats the name beside its figures.

## Tables

`DataTable` is the one table, and `data-table.ts` holds the shapes it is fed. A screen
brings `columns` (`key`, `label`, `align`, `width` as a grid track, `hideBelow` of 760 or
900), `groups` (`key`, `open`, `rows`) and the cells as snippets. The table draws the
header strip (`--table-head`), the row line, the open group's ground (`--table-open`) with
the hue's inset edge, the summary row and the hover.

- Groups, not rows, are the unit: every adopter is a table of things you open — a month, a
  category, a year, a type.
- A group head is a button, or a link when `href` is given, for a table whose open group
  lives in the URL. A head may not contain a control: nested interactive content is
  invalid HTML and reads as one control to a screen reader. Put it in the `aside` snippet,
  which draws under the open head.
- `rowLayout="block"` hands a row the full width, for a row that is a component with a
  grid of its own. `flat` draws every row on the grid with no heads.
- Columns hide by breakpoint, and the snippets receive the set of visible keys, so a cell
  that is not drawn is not rendered either.
- `summary`, `foot` and `empty` cover the totals row, a pager and the no-rows case.

Transactions, Rules, Investments, Retirement, `SalaryMatrix` and `TaxMatrix` use it. A
screen drawing its own header strip is what this exists to stop.

## Forms and controls

The base look of `input`, `select` and `textarea` lives in `app.css`: border, background,
colour, `--radius-ctl`, padding, `--text-md`, and — the two that make a row line up at all
— `line-height: 1.35` and `min-height: var(--control-h)`. Left to the browser, a text
input, a select and a textarea of the same nominal size come out at three different
heights. **Do not restate any of it in a component.** The selector wraps its exclusions in
`:where()`, which contributes no specificity, so this stays a floor an ordinary component
rule can still stand on.

- `select` is skinned once: `appearance: none`, the stroke chevron from
  `--select-chevron` (one per theme — a data URI cannot read a custom property, and it is
  the one place a colour may be written outside a token), `--card` ground, hover
  `--surface-2`. A component sets a select's width and nothing else.
- `input[type='file']` and its `::file-selector-button` are styled there too: the browser
  draws that button, it inherits nothing, and its intrinsic height is what a file field
  takes unless the stylesheet puts it inside `--control-h`.
- `.btn` and `.btn-primary` carry the same floor and line box, as `inline-flex` because
  half the button-shaped things are anchors. `.icon-btn` is a square control holding one
  glyph.
- A control that is deliberately smaller — an inline toggle inside a sentence, a compact
  save on a list row — says `min-height: auto` for itself. That is the opt-out, and it
  should be rare enough to notice.
- **An edit form's Save and Cancel replace the control that opened it.** Pressing Edit at
  the top of a panel and then scrolling fifteen fields to find Save is two journeys for
  one decision, and on a long record the buttons are off the screen entirely.

## Themes

Dark is the default and the base; light is an explicit opt-in with no system fallback. The
dark tokens sit on `:root`, the light ones on `html[data-ledger-theme='light']`, and each
block sets its own `color-scheme`.

Define nothing theme-specific inside a component — style through tokens and both themes
follow. If you need a value that differs by theme, add a token; do not branch in the
component. `color-scheme` is set so the browser paints its own chrome, scrollbars above
all: without it a white scrollbar track runs down every scrollable page, and since nothing
in the app draws that bar it is very hard to find.

**The tint rule.** In the light theme, tints and washes are mixed from bright hues that
appear nowhere else, never from the ink used for text. Two reasons, and the second bites:
a tint mixed from dark ink is mud — amber from `#8a5900` reads olive — and a brighter tint
is a _lighter_ ground, so dark ink on it measures _higher_ contrast. So **if a pill fails
contrast, darken the ink and leave the tint alone.** Re-mixing the tint from the darkened
ink chases its own tail: the ground falls with the text.

Two things stay fixed across both themes: the net-worth hero, which is dark in both
(`--tide-up` and `--tide-down` are the dark-theme green and red, because the light theme's
`--green` is darkened for AA on white and disappears on navy), and the scan flow's scrim
over the camera feed, where the backdrop's luminance is unknown.

## Icons and emoji

Inline SVG only, through `<Icon name="..." />`, whose names come from `$lib/icons.ts`. One
geometry for the whole set: 24 viewBox, `fill: none`, `stroke: currentColor`,
`stroke-width: 1.7`, round caps and joins, colour from context, default size 19. Add new
glyphs to `$lib/icons.ts` as paths. **Never link an icon library or any CDN** — this ships
self-hosted and must not call out.

Emoji survive only on the rows that carry an emoji of their own — accounts, shelves,
subjects, modules — each a household-editable field over a supplied default. Never as a
screen-title prefix and never as a section mark: the area's icon sits in a 46px `IconTile`
in the area hue, and a record's emoji goes inside that same tile rather than in front of
the sentence a screen reader reads as the heading.

An Overview panel's head is a 26px `IconTile` in the panel's own hue then the title in
sentence case; on the right, a panel that summarises a screen carries a quiet `Open →`
link to it, and only there, never at the foot of the body. While the board is being
customised that link gives way to the move, resize and remove controls.

## Accessibility

- The layout's skip link is the first focusable thing in the shell and jumps to
  `#content`. Nine sidebar rows is a long way to tab to the first heading.
- Focus is always visible: `outline: 2px solid var(--blue)` at `outline-offset: 2px`.
  Never remove an outline without replacing it.
- Pass `Icon` a `label` only when it carries meaning no nearby text repeats; the same goes
  for `IconTile`. Without a label both are `aria-hidden`.
- A control that toggles reports its state: `Switch` is `role="switch"` with
  `aria-checked`, a current sub-tab is `aria-current="page"`, `Modal` is `role="dialog"`
  with `aria-modal`, `DataTable` takes a `label` and a chart takes a `title`.
- Anything with `overflow-y: auto` sitting over other scrollable content gets
  `overscroll-behavior: contain` — the modal, the sidebar, the documents rail, every
  picker or chip list bounded by a `max-height` — or the wheel is handed on at its end and
  scrolling back moves the wrong thing. **Not an Overview panel:** one whose content fits
  is still a scroll container, and `contain` there stops the wheel over the whole board.
- Wide content scrolls in its own `overflow-x: auto` container; the body never scrolls
  sideways. Columns of digits use `font-variant-numeric: tabular-nums`.

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
- Every `.ts` and `.svelte` file under `src/` carries the SPDX licence header, enforced by
  lint and auto-fixable.

## Where a new component goes

`src/lib/components/` is the default and holds most of them, including ones only one
screen uses today. A component moves into a feature directory — `src/lib/charts/`,
`src/lib/overview/`, `src/lib/documents/`, `src/lib/scan/`, `src/lib/statements/` — only
when it ships with its own logic layer and would travel with it. The question is not "how
many screens use this", it is "does this component belong to a subsystem that has modules
of its own".

## What is enforced

Four ESLint rules run on `src/**/*.svelte`: `design/no-raw-geometry`,
`design/no-raw-shadow`, `design/no-emoji-eyebrow` and `design/opaque-floating-surface`.
They live in `eslint-rules/`, read the `<style>` block as text (ESLint does not parse CSS
inside a Svelte component), and are themselves tested by `tests/unit/design-rules.test.ts`
and `tests/unit/no-raw-geometry.test.ts`. `tests/unit/screen-frame.test.ts` holds the
frame and `tests/unit/palette-contrast.test.ts` the tint contrast.

`npm run design:tokens:check` verifies that `design_system/` is current with the
stylesheet, and is **run by hand, not by `npm run lint`**. `design_system/` is the design
workspace and is not in the repository, so on a fresh checkout — which is every CI run —
there is nothing for it to compare. Run it after changing a token, alongside
`npm run design:tokens`.

## Before you call it done

- [ ] No colour literal in the diff.
- [ ] Every figure is mono, except a headline figure, which is `display`.
- [ ] Checked both themes — toggle `data-ledger-theme` on `<html>`, don't assume.
- [ ] Reused an existing component, or can say why a new one was needed.
- [ ] Borders 1px unless the width means something; elevation from one of the four tokens;
      a coloured border only on a pill or something marking a state or identity.
- [ ] Motion is `var(--dur)`/`var(--dur-slow)` on `var(--ease)`, and nothing else.
- [ ] Pill hue means state, not decoration.
- [ ] Keyboard focus visible; anything scrollable over scrollable content contains its
      overscroll; wide content scrolls in its own container.
- [ ] Columns of digits use `font-variant-numeric: tabular-nums`.
- [ ] `npm run lint`, `npm run check` and `npm run test` pass; if you added or changed a
      token, `npm run design:tokens` was run.

## When the system does not cover it

Say so, and choose deliberately rather than defaulting. Derive the new value from a
neighbour already in the system — the next step on the type scale, an existing radius —
rather than inventing a number. If it will recur, add a token in `app.css` with a comment
saying why, regenerate `design_system/TOKENS.md`, and record the rule here.
