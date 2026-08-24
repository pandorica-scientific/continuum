# Handoff: Tax tab — one currency, one chart, one row per year

## Overview

The Tax screen records what each yearly tax statement said. It does not compute tax —
no brackets, no allowances, no residency logic. `src/lib/tax.ts` says this in its header
comment and that contract does not change here.

What changes is **how the records are arranged**. Today the screen groups by
person · country, which is the axis the rows were _entered_ on, not the axis they are
_read_ on. A household that has filed in four jurisdictions over eight years sees 2024 in
three separate places on one page, so "what did 2024 cost me" is a question the layout
cannot answer. Every new filing adds a card; the page grows without bound.

This redesign regroups on **year**, converts money to one display currency for
comparison while keeping the filed figures native, and replaces the six per-currency
charts with one.

Three concrete outcomes on the current fixture data (13 statements, 8 years, 4
jurisdictions):

|                                       | Before                                          | After                   |
| ------------------------------------- | ----------------------------------------------- | ----------------------- |
| Statement list height                 | ~1 400px, 13 cards, 4 group headings            | ~420px, 8 rows + footer |
| Charts                                | 6 panels (2 per currency × 3 currencies + rate) | 1 panel, 2 toggle modes |
| Rows added by 10 more years of filing | ~40 cards                                       | ~10 rows                |

---

## About the design files

The files in this bundle are **design references created in HTML**. They are prototypes
showing intended look, layout, copy and behaviour — they are **not production code to
copy directly**.

The target is the existing SvelteKit app in this repository. Recreate the design using
its established patterns: `ScreenHeader`, `Eyebrow`, the `.card` / `.btn` / `.field`
base layer in `src/lib/styles/app.css`, `$state`/`$derived` runes, and the `--*` tokens.
Do not introduce a chart library — the product draws its own SVG.

Two things in the prototype are prototype-only scaffolding:

- It is a single self-contained HTML file with an inline template plus a logic class.
  The real screen is `+page.svelte` plus components.
- All data is hard-coded in the logic class as the `S` array. These are **fixtures
  transcribed from two screenshots of the live screen**, illustrating shape and realistic
  magnitude. The real data comes from `loadStatements()`.

The parts worth reading closely are the **grouping/conversion logic** (`byYear`,
`perCountry`) and the **chart geometry** (the `pct`/`vpct` helpers and the segment
stacking) — both are described in full below.

## Fidelity

**High fidelity.** Colours, typography, spacing, radii, states and copy are final. Every
type and geometry value is an existing token in `src/lib/styles/app.css` — do not
introduce a raw px value for either, `design/no-raw-geometry` fails the build.

**One exception, and it is deliberate:** the four `--series-*-soft` colour tokens the
chart draws with do not exist in `app.css` yet and must be added. See Design tokens for
their values, their parents, and the one property of them still unmeasured.

---

## Screens / views

There is one screen, `/tax`, with four stacked sections. Section order matters: the band
answers "how much, overall", the chart answers "what is the shape", the matrix answers
"which year, which country", and the expanded row answers "what exactly did that
statement say". Each is more specific than the one above it.

### 1. Screen header

Unchanged. `<ScreenHeader title="Tax" caption="What each yearly statement said — recorded, never computed." />`

The `Add statement` button moves from a `.toolbar` div below the eyebrow row up into the
header's right-hand slot, as `.btn.btn-primary`. It is the screen's only primary action
and belongs beside the title, not buried between the eyebrow and the first row.

### 2. Summary band — new

A single `.card` with `background: var(--teal-wash)` and a
`repeat(auto-fit, minmax(190px, 1fr))` grid of four figures, `align-items: end`,
`gap: var(--space-8)`.

| Figure                     | Value                                  | Sub-line                            |
| -------------------------- | -------------------------------------- | ----------------------------------- |
| Earned since `<firstYear>` | `--text-4xl` mono 600, `--fg1`         | "across N jurisdictions"            |
| Tax paid                   | `--text-4xl` mono 600, `var(--red)`    | "declared, not estimated"           |
| Blended rate               | `--text-4xl` mono 600, `var(--yellow)` | "lifetime, weighted by income"      |
| Latest year · `<lastYear>` | `--text-4xl` mono 600, `--fg1`         | delta, `var(--green)` when positive |

Labels are `--text-sm` `--fg3`; sub-lines `--text-xs` `--fg3`. The currency code follows
each value at `--text-md` `--fg3` with `margin-left: 6px`.

**Blended rate is weighted by income, not a mean of the yearly rates.** `totalTax /
totalGross` over the whole record. A mean of eight yearly percentages gives a 2018 filing
of €924 the same vote as a 2025 filing of €174 000, which is wrong by two orders of
magnitude.

### 3. The chart — replaces `TaxCharts.svelte` entirely

One `.card`, containing an eyebrow row, one plot, and a legend row.

**Eyebrow row:** `<Eyebrow emoji="📈" label={…} />` on the left, two segmented controls
on the right — mode (`Earned & paid` / `Effective rate`) and currency (`EUR` / `CZK`,
built from the household's configured currencies with base first). Use the existing
`Segmented.svelte` component.

**Plot geometry.** `viewBox="0 0 1000 322"`, split into two panels sharing one x axis:

|             | y range in viewBox | Purpose             |
| ----------- | ------------------ | ------------------- |
| Money panel | 26 → 222           | stacked bars        |
| Rate strip  | 242 → 292          | effective-rate line |
| x axis      | 56 → 992           | 8 year slots        |

`slot = (992 − 56) / years.length`, `barW = min(58, slot × 0.5)`, bar centred in its slot.

**Bar construction — one bar per year.** The bar's full height **is** that year's gross.
Its foot is the tax, hatched, stacked by jurisdiction; what stands above is what was
kept, solid, in the same jurisdiction order. Stack from the baseline up: all tax
segments first, then all kept segments.

Two bars side by side (gross beside tax) was tried and rejected — it makes the reader
measure one against the other to see the share, where a single bar makes the share a
proportion of one shape, which needs no measuring.

**Bar fill.** Follow the pill and tile treatment, not `LoanSchedule.svelte`'s opaque
fills. The hue is the jurisdiction's pastel step (see Design tokens):

- Kept: `linearGradient` of the jurisdiction hue, `stop-opacity` 0.62 → 0.42 top to
  bottom, plus a 1px stroke of the same hue at full strength.
- Tax: `<pattern>` per jurisdiction, 7×7 `userSpaceOnUse`, `rotate(45)`, a ground rect
  of the hue at `fill-opacity 0.12` and a 2.6px line at `stroke-opacity 0.5`, plus the
  same 1px stroke.
- `rx="2"`, and a shared `feDropShadow dx=0 dy=1 stdDeviation=2 flood-opacity=0.3`.

At full saturation these bars were the loudest thing on a page whose washes sit at 0.07
and tints at 0.18. The hatch is what separates two _kinds_ of money within one hue
without spending a second colour on it.

**Sub-pixel segments must not get a border.** A rect thinner than its own stroke paints a
~2px band at full strength, so a €174 segment can cap a €37 000 bar in solid colour —
making the loudest pixels in the chart its least significant number. Rule: clamp segment
height to `max(0.8, raw)`, and apply the stroke only when `raw >= 2.5`. Below that the
segment is a hairline of translucent fill: present, and findable in the hover readout.

**Rate strip.** `RATE_TOP = 25`%, a 2px `var(--yellow)` polyline with 3.5px dots ringed
`stroke="var(--bg)" stroke-width="1.5"` so they sit on top of the line. It shares the x
axis rather than taking a second y axis, because a dual axis is a chart asking to be
misread.

**Effective-rate mode** replaces the bars with one line per jurisdiction in its own hue,
plus the household blended line at 3px in `var(--yellow)`. Runs break where a
jurisdiction has no filing — a one-year run draws a dot and no line. Do not bridge the
gap; a connected line across a year with no filing asserts a figure that does not exist.

**Axes are HTML, not SVG `<text>`.** See "Implementation traps" — this is not a
preference.

Both panels get: y spine, x spine, 5px tick marks at every gridline and every year,
rotated axis titles (`Thousands €` / `Millions Kč`, following the currency toggle, and
`Rate`), and an `Tax year` caption centred under the x axis.

**Legend row.** `border-top: 1px solid var(--bd)`, `padding-top: var(--space-6)`. One
swatch per jurisdiction, then `bar = earned · hatched foot = tax paid` with a dashed
`--fg3` swatch, then `effective rate` in yellow. A footnote right-aligned in `--fg3`:
"Converted at today's rate — comparison, not a filed figure" in bar mode, "Rates need no
conversion, which is why this line was always the honest one" in rate mode.

**Hover: one readout per column, not per mark.** An absolutely-positioned transparent
span per year slot, full plot height, sets `hover = index` on enter and `null` on leave.
When set, draw a 1px `var(--bd2)` vertical guide at the slot centre and a card:
`var(--bg2)`, 1px `var(--bd2)`, `--radius-md`, `box-shadow: 0 10px 30px rgba(0,0,0,0.55)`,
`pointer-events: none`, min-width 250px. It lists the year, then per jurisdiction: swatch,
name, effective rate, `earned` and `tax` in display currency, and `filed <amount>` in the
native currency. Then the year's blended total when more than one jurisdiction is present.

This is Plotly's `hovermode: "x unified"`, which the design system names as this
product's chart hover behaviour. It answers something a per-mark tooltip cannot: which
country a segment is _and_ what the others in that year were, in one look. Past the
midpoint the card flips to the other side of its guide line so it never runs off the
right edge.

**Do not also put SVG `<title>` on the marks.** The hit spans sit above the SVG and cover
it, so any `<title>` underneath is an unreachable second tooltip.

### 4. The matrix — replaces the grouped card list

A bordered container, `--radius-lg`, `overflow: hidden`, `background: var(--card)`, with
`grid-template-columns: 92px repeat(<nJurisdictions>, minmax(0, 1fr)) 196px` repeated on
the header, every row, and the footer.

**Header row.** `var(--card2)`, `border-bottom: 1px solid var(--bd2)`. Cells are
`--text-xs` uppercase `0.1em` `--fg3`: `Year`, then one per jurisdiction — full country
name with an 8px `--radius-xs` hue swatch, right-aligned — then `Year total · <CUR>`.

Use country **names**, not ISO codes. The codes are in the data, but a header row is read
once and a name costs nothing.

**Year rows**, newest first. `border-bottom: 1px solid var(--bd)`,
`box-shadow: inset 3px 0 0 <accent>` where accent is `var(--teal)` when open and
`transparent` otherwise, `style-hover` to `var(--card2)`, `cursor: pointer`.

- Year cell: `--text-lg` mono, with a 9px chevron (`▶` / `▼`) in `--fg3` / `var(--teal)`.
- Jurisdiction cells: right-aligned, two lines — gross compacted (`4.37M Kč`, `41k €`)
  in `--text-md` mono, and the effective rate in `--text-xs` `--fg3`.
- Empty cells render `·` in `var(--bd2)`. **Not an em dash and not `0`** — no filing means
  "lived elsewhere that year", not "earned nothing".
- Flagged cells (see below) take `var(--yellow)` on both lines and prefix the rate with
  `⚠`.
- Year total cell: rate in `--text-xs` `--fg3` then the converted total in `--text-xl`
  mono 600, right-aligned, above a 3px magnitude bar — `var(--card3)` track,
  `var(--teal)` fill at `max(2, gross / maxGross × 100)%`.

**The magnitude bar belongs only in the total column.** It is the one column where every
row is in the same currency, so the only column where comparing bar lengths is honest.

**Numerics are right-aligned.** The whole point of the matrix is scanning a column;
left-aligned numbers of different lengths cannot be scanned.

**Footer row.** `var(--card2)`, `border-top: 1px solid var(--bd2)`. `All`, then per
jurisdiction its lifetime gross and a year count, then the record's total and blended
rate. Eight years is few enough that the column sums are worth having in the grid.

### 5. Expanded row — where the current cards go

The existing statement cards are not deleted, they become the row's expansion:
`var(--bg2)`, `box-shadow: inset 3px 0 0 var(--teal)`, `padding-left: 106px` to align
under the year column.

One `.card` per statement in that year: `96px minmax(0, 1fr) auto` grid — country with
swatch, then the figures, then the actions.

The figures block keeps every field the current row shows, in this order:
`gross <mono> · tax <mono> · <rate> effective`, then the converted equivalent or
"filed in `<CUR>`", then the `🗂️ documentName` link when present, then `note`, then
`diverges` in `var(--yellow)`. `lines` render as they do now, `--text-sm` `--fg3`.

**Actions: `Edit` as `.btn`, and Delete behind a `⋯` menu button.** Twenty-six
permanently-visible Edit and Delete buttons for a record touched once a year is the
current screen's worst density problem, and Delete especially should not be one misclick
from a filed tax statement.

A `detailNote` in `--text-sm` `--fg3` closes the expansion: with more than one statement,
"Two filings in one year is a move, not a mistake — the year total above is the only
place they add up."; otherwise a line noting Delete's new location.

---

## Interactions & behaviour

| Trigger              | Result                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Click a year row     | Toggles that year open; clicking the open row closes it. One at a time.                                                   |
| Hover a chart column | Guide line + readout card for that year. Clears on leave.                                                                 |
| Mode toggle          | Swaps bars for the per-jurisdiction rate lines. Chart only.                                                               |
| Currency toggle      | Reconverts the band, the chart, the year totals and the footer. **Native figures in cells and expansions do not change.** |
| `Add statement`      | Opens `TaxStatementDialog` with `existing = null`, as now.                                                                |
| `Edit`               | Opens `TaxStatementDialog` with that row.                                                                                 |
| `⋯` → Delete         | Posts `?/remove` with the row id, via `use:enhance`, as now.                                                              |

Default open row: the most recent year. It is the one a person opening this screen is
most likely to want, and it makes the expansion discoverable without a hint.

**No animation.** The design system is explicit that the product has effectively none;
expansion is an instant layout change.

**Responsive.** Below roughly 900px the matrix's jurisdiction columns stop fitting. Let
the grid container scroll horizontally with the year column and total column pinned if
the codebase already has a pattern for that; otherwise scroll the whole grid. Do not
reflow the matrix into cards — that recreates the problem this redesign removes.

## State management

Four pieces of local component state, all `$state`:

```ts
let openYear = $state<number | null>(latestYear); // matrix expansion
let hover = $state<number | null>(null); // chart column index
let mode = $state<'stack' | 'rate'>('stack'); // chart mode
let display = $state(data.baseCurrency); // display currency
let editing = $state<Row | null | 'new'>(null); // unchanged, existing
```

`mode` and `display` are worth persisting per user — they are preferences, not transient
UI. Follow whatever the Overview board uses for its layout persistence rather than
inventing a mechanism.

No new data fetching. See below.

---

## Server-side changes

**Everything needed already exists.** `convertOrFace` is imported on this very route for
the payslip prefill, and `loadRateTable()` / `getBaseCurrency()` are already awaited in
`load`. Only the series builder groups by currency.

### `src/lib/tax.ts`

`taxSeries()` keys by `${personId}|${country}|${currency}` and its doc comment says
"never merged or converted". That function still has a caller if anything else wants it,
but the screen needs a new one beside it:

```ts
export interface YearRow {
	year: number;
	/** One entry per jurisdiction that filed in this year. */
	byCountry: {
		country: string;
		/** Converted to the display currency, minor units. */
		grossMinor: bigint;
		taxMinor: bigint;
		ratePct: number | null;
		/** The filed figures, untouched — for the expansion and the readout. */
		native: { currency: string; grossMinor: bigint; taxMinor: bigint }[];
	}[];
	grossMinor: bigint; // converted year total
	taxMinor: bigint;
	ratePct: number | null;
}

export function taxByYear(
	statements: StatementLike[],
	displayCurrency: string,
	convert: (amount: bigint, from: string, to: string, day: string) => bigint
): YearRow[];
```

Notes for the implementation:

- Convert **at year end** — pass `` `${s.year}-12-31` `` as the day. A yearly statement
  is not a dated transaction; using today's rate for a 2018 filing restates history every
  time the rate table updates.
- Keep the ratio in bigint via the existing `effectiveRatePct`. Never divide floats.
- Sum in minor units before converting where the currency is shared, and convert each
  statement separately where it is not.
- Sort years ascending in the returned array; the matrix reverses for display and the
  chart wants ascending.

`effectiveRatePct` and both `payslipYearTotal` functions are unchanged.

### `src/routes/(app)/tax/+page.server.ts`

Replace `series: taxSeries(statements)…` with `years: taxByYear(statements, base, convert)`,
serialised to display-grade numbers the same way the current `series` mapping does.
`convert` is already defined a few lines above. Also return the household's available
currencies for the toggle — `currencies` is already loaded and returned.

Everything else in `load` and both actions stay exactly as they are. The `statements`
array is still needed, unchanged, for the expansions.

---

## Open question — two people

**This is the one thing the design does not settle, and it needs your answer before
implementation.**

The real data is person × country × year: `loadStatements()` returns `personName`, and
`taxSeries` labels series `"Jana · CZ"`. The fixtures behind this prototype are a single
person's record, so the matrix is country × year.

A two-person household filing in four jurisdictions gives eight columns, which is past
what a matrix can hold legibly.

Recommended: **a person segmented control above the matrix** — `Both · <A> · <B>` —
where `Both` sums the household per country per year and the individual views filter.
That keeps four columns at all times and matches how the rest of the product handles
two people (the Documents shelf splits by person the same way).

The alternatives, for completeness: columns as `person · country` (legible at one person,
not at two); or two stacked matrices, one per person (loses the household total, which is
the figure the band exists to show).

---

## Design tokens

Every value below is already defined in `src/lib/styles/app.css`. No new token is needed.

**Jurisdiction hues** — a pastel step of a `--series-*` hue, deliberately not the
traffic-light hues, which must keep meaning good/watch/bad:

| Jurisdiction | Token drawn            | Parent                      | Value     | Reads as   |
| ------------ | ---------------------- | --------------------------- | --------- | ---------- |
| Czechia      | `--series-health-soft` | `--series-health` `#7189f3` | `#a8b5f7` | periwinkle |
| Germany      | `--series-income-soft` | `--series-income` `#75a322` | `#b3cc7d` | sage       |
| Spain        | `--series-bills-soft`  | `--series-bills` `#da7306`  | `#f0b27a` | apricot    |
| Poland       | `--series-taxes-soft`  | `--series-taxes` `#ac2f3b`  | `#d99098` | dusty rose |

**The four `*-soft` tokens do not exist in `app.css` yet and must be added** beside the
`--series-*` set, with light-theme values of their own — the same treatment every other
series token gets. Each is a higher-lightness, lower-chroma step at its parent's hue
angle. Nothing in the chart paints a raw hex; every fill, stroke and swatch resolves a
`var()`.

**Czechia does not use `--series-housing`.** That token is a deep cold teal-blue
(`#006b98`) with no warm pastel step — it lightens to an ice blue that reads against the
other three rather than with them. `--series-health` is a periwinkle: it stays the cool
anchor the set needs for separation while belonging to a warm family.

**Colour-vision separation is unverified for these steps.** The `--series-*` palette was
measured for protan and deutan separation; because each soft step holds its parent's hue
angle, the hue separation carries over, but the lightness separation does not — the
pastels sit closer together in lightness by construction. **Re-measure the four soft
values, alpha-flattened, before shipping**, and adjust lightness rather than hue if a
pair falls under the threshold. This is the one open item in the palette.

Assign further jurisdictions by taking the next `--series-*` entry and adding a soft step
the same way, continuing into the ranked `--series-r1…r10` reserve. Do not hard-code a
country-to-hue map beyond what the data needs.

**Semantic:** `var(--yellow)` flags and the blended rate line; `var(--red)` tax paid in
the band; `var(--green)` a positive delta; `var(--teal)` the open-row accent and the
magnitude bar.

**Surfaces:** `--card` container, `--card2` header/footer/hover, `--card3` magnitude
track, `--bg2` expansion and readout card, `--teal-wash` band, `--bd` / `--bd2` borders.

**Type:** `--text-4xl` band figures · `--text-xl` year totals · `--text-lg` year cell ·
`--text-md` cell figures and prose · `--text-sm` labels and sub-lines · `--text-xs`
eyebrows, rates, axis labels · `--font-mono` every figure, ticker and ISO date.

**Geometry:** `--radius-lg` container and cards · `--radius-md` buttons, inputs, readout
card · `--radius-xs` swatches · `--space-3` … `--space-8` gaps · `--control-h` on the
toggles.

## Assets

None. No images, no icon files. The two emoji (`🧾` `📈`) are the existing `Eyebrow`
component's `emoji` prop, and `🗂️` is already in the statement row. The design system
is explicit that emoji are this product's icon system.

## Implementation traps

Four bugs cost real time in the prototype. All four involve getting a computed value into
SVG. The Svelte port will hit 1 and 3 differently or not at all, but 2 and 4 are
CSS/SVG facts that apply to any implementation.

1. **Do not put dynamic text in SVG `<text>` in this environment.** The prototype
   runtime wraps every interpolated value in an HTML `<span>`, and an HTML span inside
   SVG `<text>` paints nothing — so every computed axis label was in the DOM at zero
   width while hard-coded ones rendered fine. Svelte does not have this problem, but the
   design keeps axis labels as absolutely-positioned HTML anyway: they are selectable,
   directly editable, and inherit the page's font stack without an extra `fill`.

2. **An SVG with a fixed pixel height letterboxes its own viewBox.** `height: 322px` with
   a `0 0 1000 322` viewBox scales to fit and centres, so anything positioned in
   percentages drifts — about 70px, in our case. Pin the wrapper to the viewBox's aspect
   ratio (`aspect-ratio: 1000 / 322`) and give the SVG `height: 100%`.

3. **A `calc()` inside an interpolated style value may not survive the parser.** The
   readout card's flip silently stopped working. Fold the offset into the positioning
   value instead of writing `translateX(calc(-100% - 12px))`.

4. **An SVG _attribute_ does not resolve `var()`.** `stopColor="var(--x)"`,
   `fill="var(--x)"` and `stroke="var(--x)"` paint nothing. `stop-color`, `fill` and
   `stroke` are also CSS properties, so set them through `style` — which is how the
   prototype's gradient stops, `<pattern>` fills, bar borders and rate lines all resolve
   their tokens. Svelte has the same constraint; it is a CSS/SVG fact, not a runtime one.
   A `url(#gradient-id)` reference is fine as an attribute.

## Files

| File                            | What it is                                                                                                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Continuum Tax Rethink.dc.html` | The design. Opens standalone in a browser. Contains the diagnosis of the current screen, the redesign, and a card documenting where it departs from the codebase's existing chart conventions and why. |
| `support.js`                    | Runtime the design file loads. **Must sit beside it** for the HTML to open — without it every value renders as a literal `{{ band.gross }}` placeholder. Prototype scaffolding; nothing to port.       |
| `README.md`                     | This document.                                                                                                                                                                                         |

The design file reads top to bottom as: what is wrong with the current screen → the
redesign → what it departs from. The diagnosis section is worth reading before the
implementation, because several of the layout decisions only make sense as answers to a
specific named problem.

## Existing code this touches

| Concern                      | File                                                            |
| ---------------------------- | --------------------------------------------------------------- |
| Screen                       | `src/routes/(app)/tax/+page.svelte`                             |
| Loader and actions           | `src/routes/(app)/tax/+page.server.ts`                          |
| Grouping and rate arithmetic | `src/lib/tax.ts`                                                |
| Charts — **replaced**        | `src/lib/charts/TaxCharts.svelte`                               |
| Statement editor — unchanged | `src/lib/components/TaxStatementDialog.svelte`                  |
| Persistence — unchanged      | `src/lib/server/tax/`                                           |
| Conversion                   | `src/lib/server/fx/table.ts` (`convertOrFace`, `loadRateTable`) |
| Tokens                       | `src/lib/styles/app.css`                                        |
| Primitives                   | `src/lib/components/{ScreenHeader,Eyebrow,Segmented}.svelte`    |

## Data bug the design surfaces

The fixtures are transcribed from the live screen, and two filings are two orders of
magnitude below every other one: PL 2025 says gross `368 PLN` and PL 2024 `155.07 PLN` —
annual incomes of about €85 and €36.

This is either a units error on entry (thousands) or a part-year filing the statement does
not describe. The current layout has nowhere to say so; the matrix makes it the one
flagged cell in the grid, with the explanation in the expansion.

Worth checking the underlying rows before implementing, since a units error there would
also be skewing the blended rate.
