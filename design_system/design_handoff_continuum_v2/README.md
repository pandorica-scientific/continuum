# Handoff: Continuum v2 UI

## Overview
A full visual refresh of Continuum (SvelteKit household-finance server, `pandorica-scientific/continuum`, **branch `v0.8.0-shelves` @ 0.8.0**). Same information architecture, same copy voice, same data — a warmer, more colourful and more legible skin: area hues used as identity, wash-tinted metric tiles, big sans headline figures, colour-filled charts, quiet card shadows, larger radii, one 150 ms motion curve. Three layouts (sidebar / icon rail / bottom tab bar) so the same screens work on a monitor, a tablet and a phone. Every screen in the app is covered, plus Settings and the v0.8.0 Documents model (shelf = one question, one unit, one template; four engines: queue, wallet, completeness, dossier).

## About the design files
Everything under `prototype/` is a **design reference built in HTML** — a clickable prototype showing intended look and behaviour. It is not production code. The task is to **recreate these designs inside the existing SvelteKit codebase** (`src/lib/components`, `src/lib/overview`, `src/lib/documents`, `src/routes/(app)`), using the tokens in `src/lib/styles/app.css` plus the additions in `tokens/app.v2.css`. Do not port the prototype's inline styles or its React runtime.

Open `prototype/Continuum v2.dc.html` in a browser (serve the folder; it loads sibling files). `prototype/Continuum Current.dc.html` is a faithful recreation of today's UI for side-by-side comparison. Resize the window to see the three layouts (≥1180 sidebar · 720–1179 rail · <720 bottom bar).

## Fidelity
**High-fidelity.** Colours, type, spacing, radii, shadows and states are final and every value is a token or a `color-mix()` of tokens. Recreate pixel-accurately with the codebase's components. Fixture numbers in the prototype are demo data; the Retirement model and Rules trust figures are illustrative, not the app's real maths.

## Mapping onto the v0.8.0 screen frame
v0.8.0 already draws every screen from one frame — `ScreenHeader` → `SummaryBand` (of `MetricTile` / `tiles.ts`) → `ControlRow` → content — and `tests/unit/screen-frame.test.ts` fails a screen that draws its own figures. **Keep that frame; restyle its primitives.** Every "tiles" row in this README is the `SummaryBand`; every "search + actions" row is the `ControlRow`. Concretely:

| v2 spec | v0.8.0 home |
| --- | --- |
| Metric tile (wash ground, display figure, nowrap) | `MetricTile.svelte` — swap `.value` to `--font-display` 650/−0.03em, add optional `wash` prop (hue token) for the ground; `Tile` in `tiles.ts` gains `wash?: string` |
| Tile row | `SummaryBand.svelte` — gap `--space-6`, columns = tiles; unchanged |
| Search + primary action | `ControlRow.svelte` — unchanged; v2 restyles the inputs/buttons it holds |
| Icon tile (26/30/44/46 px hue tile) | new `IconTile.svelte` in `components/` |
| Screen title 30/650 with 46 px tile | `ScreenHeader.svelte` — `.mark` becomes the tile; `emoji` prop stays for shelves |
| Card / panel | `.card` in `app.css` + `Panel.svelte` (overview) — radius `--radius-2xl`, `--shadow-card` |
| Switch | new `Switch.svelte` |

Design-token rules that v0.8.0 finalised and this handoff **keeps**: no colour literal outside `app.css`/`app.v2.css`; every figure mono except the display figures named here (add `--font-display` as the one sanctioned exception, documented in `ui-guidelines.md`); radii and gaps from the scale (`--radius-card` = `--radius-2xl` 16, `--radius-tile` = `--radius-xl` 12, `--radius-ctl` = `--radius-lg` 10 — alias them rather than adding raw px); `design/no-raw-shadow` needs `--shadow-card` and `--shadow-hero` added to its allow-list. Ink values in v0.8.0 `app.css` (indigo/brand lifted for AA) are the source of truth — `app.v2.css` does not touch them.

## Design system update
The bound design system ("Continuum Design System", project `bfc9d5…`) is a read-only mirror of `app.css` + primitives. It should absorb, verbatim:
1. `tokens/app.v2.css` (new tokens, light-theme rework) — load after `app.css`; adds tokens, and under `html[data-ledger-theme='light']` overrides the light surface set (surfaces, borders, fg2/fg3, shadows including `--shadow-float`, washes, hero).
2. The seven rule changes in `CHANGES.md § Rules that change` → `docs/ui-guidelines.md`.
3. New primitives listed under *Components to add* below.

---

## Layout & shell

### Breakpoints
| Width | Nav | Notes |
| --- | --- | --- |
| ≥1180 px | Sidebar 264 px, sticky, `100dvh` | `grid-template-columns: 264px minmax(0,1fr)` |
| 720–1179 px | Icon rail 76 px | labels via `title`; theme, settings, avatar at foot |
| <720 px | Fixed bottom bar, 5 items | brand row moves to top of `main`; quick-add 86 px up |
| `wide` = ≥900 px | two-column card grids collapse below | tables drop columns below 760 px |

Main column padding `26px 32px 60px` (phone `16px 14px 90px`). Section gap 16 px, card grid gap 16 px, metric-tile gap 12 px.

### Sidebar (`Sidebar.svelte`)
- Brand row: 32 px tile `color-mix(brand 16%)` radius 10 with the mark; wordmark 17/650/−0.015em; gear (16 px icon) right, 30 px hit area radius 9, hover `--surface-2`.
- **Net-worth hero**: `--hero-bg` gradient card, radius `--radius-card`, `--shadow-hero`, white text. Eyebrow 11/uppercase/0.1em @ .75 opacity · figure 26 px `--font-display` 650 −0.03em tabular · delta pill `rgba(255,255,255,.16)` 11 px mono · caption 11 px @ .7.
- Nav rows: 42 px, `grid 32px 1fr auto`, gap 12, radius 12. Icon tile 32 px radius 9: `--surface-2` idle / hue 28 % active. Row bg hue 14 % active, 9 % hover. Label 13.5 px, 500 → 600 active, `--fg2` → `--fg1`. Import badge: 7 px yellow dot.
- Foot: segmented theme control (`🌙 Dark` / `☀️ Light`, 3 px padding, radius `--radius-ctl`, active `--surface-3`), person row (28 px avatar in the person's series hue at 26 %, name 13/500, household 11 `--fg3`, `Sign out` link), version line 11 px mono `--fg3`.

### Screen header (`ScreenHeader.svelte`)
46 px area tile (hue 16 %, radius 14, 24 px icon in the hue) + title 30/650/−0.025em (24 px on phone) + caption 13 `--fg3`. Actions right-aligned, wrap on phone: chips (`synced 2026-08-30`, 12 px, `--card`, 1 px `--bd`), ghost button, primary button.
Sub-tabs: 34 px pills, 15 px screen icon, gap 4; active = hue 18 % bg, hue icon, 600; hover `--surface-2`.

### Buttons & controls
| Control | Spec |
| --- | --- |
| Primary | `--blue` bg, `--fg-inverse` text, 0 border, radius `--radius-ctl`, 34–36 px, 12.5–13 px 600, hover opacity .9 |
| Ghost | `--card` bg, 1 px `--bd2`, `--fg1`, radius `--radius-ctl`, 34 px, 12.5 px, hover `--surface-2` |
| Danger ghost | ghost with `--red` text, hover `--red-tint` |
| Segmented | container `--card`, 1 px `--bd`, 3 px padding, radius `--radius-ctl`; items radius 8, 5–6 × 11 px, 12 px; active `--surface-3`, `--fg1`, 600; idle `--fg3` |
| Filter chip | 999 radius, 32 px, 12 px, `--card` + `--bd2`; active hue 16 % bg + hue 45 % border + hue text |
| Search field | 36–38 px, `--card`, 1 px `--bd2`, radius `--radius-ctl`, 15 px search icon `--fg3`, 13 px input |
| Number input (in a bordered span) | reset UA padding; mono 12.5 px; no spinner (`appearance:textfield`) |
| Switch | 38×22, radius 22; off `--card2` + `--bd2`, knob `--fg3` at left 2; on `--green-tint` + `--green` border, knob `--green` at left 18 |
| Icon tile | `color-mix(hue var(--tile-alpha))` bg, hue stroke icon; 26 px/r8 (panel title), 28–30 px/r9 (rows), 44 px/r13 (cards), 46 px/r14 (screen title) |
| Pill | unchanged `Pill.svelte` (hues green/yellow/red/blue/grey) |
| Card / panel | `--surface`, 1 px `--bd`, `--radius-card`, `--shadow-card`, padding 18/20; header: 26 px hue tile + title 14/600 + quiet 12 px `--fg3` sub; `Open →` 12 px `--fg3` right |
| Metric tile | `<hue>-wash` bg (or `--surface`), 1 px `--bd`, radius card, padding 16/18 (12/14 inside panels); label 12 `--fg3` · value 24–28 px display 650 tabular (22 px <900) with 12 px unit `--fg3` · note 11 `--fg3`. **Figures never wrap** (`white-space:nowrap`; grid `minmax(200px,1fr)`) |
| Table | header 11 px uppercase 0.1em `--fg3` padding 12/18; rows 12–13 px mono figures, 1 px `--bd` dividers, hover `--surface-2`; summary row `--surface-2` + 600 |
| Row emoji tile | 28–34 px radius 8–10, `color-mix(series 18%)` |

Focus ring stays `2px solid var(--blue)` offset 2. Disabled opacity .45.

---

## Screens

### Sign-in
≥900 px two columns `1.1fr 1fr`: left `--hero-bg` panel (brand tile 40 px `rgba(255,255,255,.14)`, tagline 38/650/−0.03em, sub 14 @ .82, three fact pills `No cloud · No telemetry · AGPL-3.0`); right centred card ≤380 px: title 24/650, person radio cards (32 px hue avatar, 16 px radio, selected border `brand` 55 % / bg `brand` 12 %), password input, primary `--brand` button 40 px.

### Overview (board)
12-column CSS grid, gap 16. Each panel is a grid item with `grid-column: span 12|6|4` and CSS `order`. Panels: **Needs you** (yellow, briefing cards: 30 px hue tile, kind 12 `--fg3`, pill, title 14/500, body 12.5 `--fg3`, `<hue>-wash` ground, hover −1 px), **Where the money goes** (teal; period segmented `Month · YTD · 12 m`; four wash tiles In/Out/Saved/Kept; Sankey), **What it is made of** (purple; stacked share bar 10 px + list with 10 px square swatches, mono values in series colour), **Next 30 days** (indigo; 44 px indigo calendar chip month/day), and five optional panels: **Accounts**, **Investments** (value + gain + holdings share bar), **Loans** (owed, fixation bar, next instalment), **Expiring documents**, **Energy this month** (30 mini bars, orange above average).

**Customise mode** (`Customise` ↔ `Done`, button bg `--surface-3` when on; panel borders turn `--brand`):
- Tray at the top (dashed `brand` 45 % border, `brand` 6 % ground): "Add a panel" + one chip per hidden panel (18 px hue tile + name) · hint "⅓ · ½ · 1 set the width, arrows the order" · `Reset layout`.
- Per-panel toolbar (brand 10 % strip inside the card): grip `⋮⋮`, name, width segmented `⅓ ½ 1` (mono), `↑ ↓` 26 px ghost squares, `✕` (hover `--red-tint`/`--red`).
- Below 900 px every panel is full width regardless of its setting; ⅓ becomes ½ between 900 and 1180.
- State: `{ order: string[], width: Record<key,'third'|'half'|'full'> }` — persist per person (today's board API already stores order).

**Sankey** (`src/lib/charts/`) — `charts/sankey.js` is a JS port of `sankey.ts`/`flow-graph.ts`; keep the Svelte engine, apply: node bars 12 px solid; ribbons `linear-gradient` of the series colour 22 → 62 %; hover on a node lights every ribbon on the whole path in both directions (upstream to sources, downstream to leaves) at 100 % and dims the rest to 12 %; flame effect: `v2-flame-a/b` keyframes (see helmet CSS) on the lit ribbons, disabled under `prefers-reduced-motion`. Labels keep the `--bg` text-shadow halo.

### Cash flow
Four metric tiles → **Month by month** panel: 6 paired bars (in `--green`, out `--red`, vertical gradient to 55 %), width 38 % max 34 px, radius 6/6/3/3, hover brightness 1.15, month labels 12 px (current 600). → two columns `1.3fr 1fr`: **Where it went** (12 px share bar; rows `30px 1fr auto auto`: hue tile w/ group icon, name 13/500 + leaf line 11.5 `--fg3`, mono amount 600, hue % chip 11 px mono 16 % bg 999) · **Where it came from** (source bars 8 px `--card3` track, series fill) + footnote.

### Accounts
Columns `1.35fr 1fr`. Account cards: `grid 44px minmax(0,1fr) auto`, 44 px emoji tile on the account's series hue 18 %, name 14/600 + ✎, meta 12 `--fg3`, share bar 5 px + mono %; balance 22 px display + 12 px currency, sub 11 mono. Right: **Where the cash sits** panel — header shows the total (18 px display) right; 140 px conic-gradient **pie (no centre disc)** + legend with 10 px square swatches and mono %.

### Transactions
Search + chips `All · Needs a look · Money in · Money out` + `More filters` (opens the full filter form). Month header row: teal chevron tile, month 14/600, count 12, display net, 120 px in/out bar. Row: 8×22 px category swatch, merchant 13/500, category hue chip (≥900 only), mono amount coloured by sign, `needs a look` pill. Expanded row indents to the merchant column and shows the category picker, split, "Make a rule", receipt `📎`.

### Salary
Tiles (Earned since / Average year / Last year) · centred person segmented (`Both · Jana · Petr`) · **Average month** panel with view segmented `Average month · Yearly total · Change`. Bars: base = `--series-health` gradient, bonus = hatched `--series-bills` foot, net = 2 px `--fg1` line. `Change` view uses the **line chart** (below). Table: `Year · Base · Bonus · Gross · Net` (net `--green`); a year row expands to its payslips (one row per month; every value and the bonus `—` is a click-to-edit cell; currency switch `Kč · EUR · PLN` in the header). Header actions: `Add several` ghost, `Add payslip` primary.

### Tax
Tiles (Earned since 2021 · Tax paid `--red` · Blended rate `--yellow` · Latest year `--green`) · person segmented left, currency `Kč · PLN` right · **Earned & paid** stacked bars (Czechia `--series-health-soft`, Poland `--series-income-soft`, hatched tax foot, effective rate 11 px mono `--yellow` under the year) with view segmented `Earned & paid · Effective rate` (line chart). Table rows expand into **one card per jurisdiction**: person, `filed` pill, facts grid (Gross · Tax paid `--red` · Effective `--yellow` · Currency), **Filed documents** list (28 px teal receipt tile, name 12.5/500, sub 11, ext mono) + dashed `Attach a document`.

### Line chart (new primitive — `charts/line.js`)
Measures its box (ResizeObserver), y-axis from data with nice ticks (1/2/2.5/5 × 10ⁿ), 12 % headroom, optional zero line `--bd2`; grid `--bd`; series 2.5 px round-capped stroke, 4.5 px points with `--surface` 2 px ring, end label mono 11 px 600 in the series colour; first/last points inset ≤56 px from the plot edges; x labels 12/500 `--fg2` + sublabels mono 11 `--fg3`; null points break the line. Pad left 56, right 96.

### Import
Dashed teal drop zone (`teal-wash` ground, 48 px teal inbox tile, title 15/600, format chips mono 11 999 `--surface-2`) · "Assign to account" select + hint · tiles (Files this month · Transactions read · Filed automatically · Transfers paired) · two panels: **Needs a decision** (yellow bell; empty state green check tile "Everything filed itself") · **Statements** (rows: emoji tile, name, sub, days mono, `overdue` yellow pill).

### Rules
Header line "13 rules · filing at `50%` confidence and above" + `New rule` primary. Search + filter chips `All · Below the floor · Disabled`. **Confidence floor** panel: 8 px slider track `--card3`, fill `yellow → green` gradient, 18 px `--fg1` thumb with 3 px `--bg` ring, value 22 px display. **Rules table** grouped by category, **groups collapsed by default**; group header row aligned to columns: chevron ▸/▾, 10 px colour swatch, name 13/600 + note (`n below the floor · n disabled`), `n rules` mono, average trust bar (5 px; ≥80 green / ≥50 yellow / <50 red) + %, `kept · overridden` mono. Expanded rule rows (indent 42 px): name + `disabled` grey pill, when-clause 11.5 `--fg3`, category hue chip, trust bar + %, kept·overridden, `⋯` menu. Disabled rows opacity .55. Columns `minmax(0,1.6fr) 170px 160px 130px 32px` (phone `minmax(0,1fr) 120px 32px`).

### Property
Flat switcher: buttons with 28 px purple buildings tile, name, state mono 11 (`you live here` / `rented out`), selected = purple 12 % bg + 45 % border; dashed `Add property`. Name row + `Add a tag…` input. Tiles per flat (Est. value · Mortgage owed `--red` · Equity `--green` · Money in / Rent `--teal` · Appreciation / Yield `--green`). Two columns: **Floor plan** (6×3 grid, 72 px rows, rooms `color-mix(purple 6–14%, --surface)`, name 12/500 + area mono 10; `✎ Edit plan`) · **You live here** (orange-wash card, Home Assistant note) + **Monthly bills** (total 18 px display in header; rows with 8×22 series swatch, mono amount).

### Investments
Tiles (Portfolio · Money in · Gain `--green` · Annualised `--teal` · Tax on 2026 gains `--fg3`) · **Value against money in** area chart (teal 2.5 px actual with 35→0 % fill, money-in dashed `--fg3`, 5 %/yr dotted `--orange`, year axis mono 11) · columns `1fr 1.4fr`: **What you own** (120 px pie + mono ticker legend) · **Holdings** table (`Holding · Units · Value · Gain`; 8×22 swatch, ticker 600 + name 11 ellipsis, gain coloured).

### Loans
Wash metric tiles; loan card: 44 px purple card tile, 15 px mono facts, repaid bar (green → teal), **fixation timeline** (26 px band: past grey, current teal `4.44%`, unknown hatched purple; caption row `Fixation · 4.44% to Aug 2028 — 2024 → 2049`), ghost actions; dashed `Add loan` card.

### Retirement (live model)
- **Verdict hero** (`blue-wash`, `blue` 30 % border, `1.3fr minmax(360px,1fr)` ≥1100): 124 px **SVG stroke gauge** (r 55, 12 px stroke, track `fg1` 10 %, arc red <50 / yellow <100 / green, minimum visible 2.5 %), 30 px display % + "covered today"; sentence with mono highlights; reach line with 22 px target tile (green if reached, red if never); three tiles Capital pays · Pension adds · You need (+ "a pot of X M").
- ≥1280 two columns `380px 1fr`: **What you assume** — Target (need input Kč + withdrawal segmented `3.0 · 3.5 · 4.0 %`), Growth (three `<input type=range>` accent `--blue`, 0–8 / 0–6 / 0–6 %, step .5), The flats (segmented `Keep · Rent out · Sell and invest` + one-line consequence), State pension (person cards: 30 px hue avatar, age/years-to line, `a month` and `from age` number fields). Right: **The pot against what the target requires** (line chart: capital `--blue`, capital + flats `--purple`, required pot dashed `--fg3`; labels today/10y/20y/30y/40y) and **Where that leaves you** table (When · Ages · Capital (red if negative) · Flat equity (hidden <760) · Income / month · Against target = 5 px coverage bar + %; today row `--surface-2` 600; pension-start note 11 px `--blue` under the label).
- Every control recomputes: `income = capital·w/12 + pensions(after start age) + rent(if renting after first pension)`; `sell` adds equity to capital at the first pension.

### Home
Tiles (Energy `--orange` · Water `--blue` · Devices online · Bills) · **Energy this month** (30 daily bars, orange above the average else teal, hover brightness 1.2, mono day labels every 5) · **Meters** (34 px hue tiles, reading mono 14/600, delta mono 11).

### Calendar
Filter pills `Ledger` (yellow dot) `Ours` (indigo dot) + "no calendar connected yet". `1.5fr 1fr`: month panel (‹ › 34 px ghost squares, title 17/650, 7-col grid, cells ≥64 px radius 10 `--card` + `--bd`, today indigo 14 % + 50 % border, 7 px yellow event dot; agenda foot + `Add event`) · **What the ledger puts here by itself** (green switches per feed) + **Connected calendars** (`Connect Google or iCloud`, `ledger.ics` row with `published` pill + token warning).

### Contacts
Search + `New contact`; `Address book · 2 contacts`; cards `minmax(320px,1fr)`: 44 px initials avatar in series hue 24 %, name 15/650, role 12.5 `--fg3`, `Edit`; mono phone/email links `--blue`; link chips indigo 12 % with key icon.

### Documents (v0.8.0 shelf model)
Frame: `ScreenHeader` with the **shelf's emoji as the mark, its label as the title, its question as the caption** (`SHELF.question`) → `SummaryBand` of three tiles from `shelfTiles(engine)` / `archiveTiles` (colour only when a task: red missing/expired/gaps > 0, amber waiting/reminder-window) → `ControlRow` (search left; engine|List switch (`ENGINE_LABELS`: Queue · Wallet · Completeness · Cards), Group segmented on Everything only, `Add document` primary) → engine. Columns `230px minmax(0,1fr)`; rail wraps to a row <900.

**Rail** (`DocumentsRail.svelte`) — exactly v0.8.0's content: `📥 Inbox 2` (count amber when >0) · divider · `SHELVES` + ✎/Done · seeded shelves in `sort_order`: 🪪 IDs · 🧾 Statements · 🏛️ Income & Tax · 🩺 Health · 🔧 Inventory · 🏠 Property · 🚗 Vehicles · divider · `Everything 62` · `🏷️ Tags`. **No subjects or organisations sections** — those are cards on their shelf. Edit mode: grip, type-tag icon and ✎ per row, dashed `New shelf` (opens the template/unit/question dialog). Rows `grid minmax(0,1fr) auto`, 22 px emoji slot, 13 px, radius 10, active `--surface-2` 600, count mono 11.

**Engines**
- *Queue* (Inbox, `QueueView.svelte`): `minmax(0,1fr) 380px` (<1100 one column). Left: name 16/600 + mono `PDF · waiting 4 days` + `1 of 2` right; letterboxed sheet ≥420 px (`--surface-3→--card` gradient, radius card); the waiting documents as chips under it. Right decision card (`--surface`, radius card): **proposal strip** (`--blue-tint`, 1 px `--blue`, check icon, "A rule matched: **Acme s.r.o.** · Payslip") or contested strip (`--surface-2`, alert icon); Name; `1 · SHELF` chips (selected `--surface-3` + `--bd2`); `2 · WHICH CARD / WHO` chips + dashed `＋ New card` on subject/organisation shelves (+ name field); `3 · LANE` radio rows (History · each lane with cadence phrase, selected `--surface-3`); Type select shortened to the shelf's types (lane implies one) + `Show all types…`; Expiry verb + date; Tags; Restricted; foot `File it` primary · `Skip` · quiet `Delete` right.
- *Wallet* (IDs): unchanged from above.
- *Completeness* (Statements): year stepper `‹ 2026 ›` + count; **four cell states** exactly as `coverageRow`: filled (account series colour, bands join), gap (1 px solid `--red`), not-arrived (1 px dashed `--bd2`), before-account (`--bd` at .35). Legend shows three. Gap `title` → Import with account + month.
- *Dossier* (Income & Tax · Health/timeline · Inventory/kit · Property/obligations · Vehicles/obligations — `DossierView.svelte`): year stepper + `n cards`; **Not filed against anyone yet** proposals block (Income & Tax only: doc link, blue-tint org·lane chip, `File it` / `Not this one`); one **card** per unit: head (36 px emoji tile on the card hue, name 15/650 as collapse toggle, kind grey pill, right-aligned mono count — collapsed it reads the finding `1 missing · Payslip` in `--red` —, ⋯ menu (rename / archive|remove), chevron); meta chips (current role · since; a promotion is a second chip); pinned document row (contract/lease/purchase); **lanes**: label · person · cadence phrase · `filed/expected` mono (red when short); cells grid `repeat(n, minmax(34px,1fr))` with column labels, `span` for every-2-years windows (`2023–24`), states filled/gap/not-arrived/before as the ribbon, `2` in a cell holding two documents; `once` lanes draw **slots** (name + date, or name in `--red` + "not filed", dashed red border); `none` lanes and **History / Records** (oldest first on timeline shelves) as loose rows (emoji tile, name, type, mono date). Dashed `New card` on subject/organisation shelves.
- *List*: grouped list cards (entity groups, `n soon` pill); Everything shows the type table + Type/About/Tag filters.

### Settings (gear)
`200px minmax(0,1fr)` (nav becomes a wrapping row <900): section list with 26 px hue tiles — Modules `brand/layers` · Currencies `teal/coins` · Household `purple/people` · Backups `green/inbox` · Self-hosting `fg3/gear` · Calendars `indigo/calendar` · API tokens `orange/key` · Categories `teal/tag` · Open instance `yellow/lock`; one section shown at a time. Section card: title 15/650 + caption 12.5 `--fg3`.
- **Modules**: card grid (3 cols ≥1400 · 2 ≥900 · 1) — 32 px emoji tile, label 13.5/500, note 11.5, switch.
- **Currencies**: base-currency select + Save; rate chips (`EUR 24.62 Kč` + `ČNB fixing` green / `approximate` yellow pill).
- **Household**: person rows (36 px hue avatar, name + `admin`/`member` pill, meta, `Passkeys · n`, ✎) + `Add a person`; `YOUR PASSWORD` three fields + `Change password` (grid `repeat(3,1fr) auto`), note about signing out devices.
- **Backups**: destination input (mono) · cadence segmented `Off · Weekly · Monthly` · Save; `Back up now` primary + last-backup line (green check) + detected sync folders note.
- **Self-hosting**: 6 fact tiles (`--card`; mono value 15/600) — Version, Database, Uploads, Backups, Uptime, Base URL; `⬇️ Export settings` / `⬆️ Import settings…`.
- **Calendars**: connected account row (36 px indigo tile, name + `last synced` green pill, "Syncing with **Household** · every 30 minutes", `Sync now` / `Change calendar` / `Disconnect` red); dashed connect row for Google (`Authorise with Google`); marker switch + "Check every [30] minutes".
- **API tokens**: label input + `Create token`; rows with 32 px orange key tile, mono created/last-used, `Revoke`.
- **Categories**: card grid like Modules — 12 px colour square, group name 13/600, role 11, `⋯` menu (Colour / Rename / Delete group); chips (grip icon 11 px, name, `✕`), catch-alls pinned with no grip at .85 opacity; dashed `＋ Add` chip; footer `New group` input + role select + `Add group` + palette note.
- **Open instance**: closed = explanatory text + password field + `Open the instance` ghost; open = `yellow-wash` card, `--yellow` border, bold warning, `Close it` primary.

---

## Interactions & motion
- One easing `--ease: cubic-bezier(.2,0,.2,1)`; `--dur` 150 ms for background/colour/transform hovers; `--dur-slow` 260 ms for screen fade-in (`v2-in`: opacity 0→1, translateY 4→0) and chart dash transitions. Press stays 90 ms `--card3` + `translateY(1px)`. `prefers-reduced-motion` collapses all to 1 ms.
- Cards that open something lift `translateY(-1px)` on hover; bars brighten 1.15–1.2.
- Quick-add: 36 px `--brand` disc, `--shadow-hero`, scales 1.45 and brightens on hover, plus rotates 45° when the menu (opaque `--bg2`, `--shadow-float`, 28 px hue tiles) is open.
- Sankey path highlight and flame described under Overview.
- Expand/collapse (tax years, salary years, rule groups, Overview panels) has no height animation — content appears; chevrons ▸/▾.
- Theme: dark default; light via `html[data-ledger-theme="light"]` (existing endpoint). Prototype flips the attribute on `<html>`.

## State
Per person, persisted: theme; board `{order, width}`; Documents rail edit is transient; Documents URL state is v0.8.0's: `?view=list|tags|shelf` (`centreView`), `?year=` for the completeness/dossier steppers, and a non-empty search forces `view=list`. The engine|List switch writes `view`; `Group` is transient. Transient UI state: expanded rows (salary/tax years, rule groups), filter chips, period, Settings section, Retirement assumptions (persist these — they are inputs).

## Design tokens
All in `tokens/app.v2.css` (dark values first, light overrides under `html[data-ledger-theme='light']`). Summary:

| Token | Dark | Light |
| --- | --- | --- |
| `--radius-card / -tile / -ctl` | `var(--radius-2xl / -xl / -lg)` = 16 / 12 / 10 | same |
| `--surface / -2 / -3` | white 4.5 % / 7.5 % / 11 % | `#ffffff` / `#f3efe7` / `#e4ded2` |
| `--bg / --bg2 / --side` | app.css | `#eeeae2` / `#e6e1d7` / `#f5f2ec` |
| `--card / -2 / -3` | app.css | `#f9f7f2` / `#f1ede5` / `#e6e0d4` |
| `--bd / --bd2` | app.css | `rgb(60 52 40 / .11)` / `.22` |
| `--fg2 / --fg3` | app.css | `#3d3a34` / `#75705f` |
| `--shadow-card` | `0 1px 2px rgb(0 0 0/.28), 0 12px 32px -16px rgb(0 0 0/.55)` | `0 1px 2px rgb(60 52 40/.08), 0 14px 36px -18px rgb(60 52 40/.32)` |
| `--shadow-hero` | `0 18px 44px -22px brand 70%` | `… brand 55%` |
| `--shadow-float` | app.css (unchanged) | overridden: `0 8px 28px -8px rgb(60 52 40/.35), 0 1px 3px rgb(60 52 40/.12)` |
| `--tile-alpha / -active` | 16 % / 28 % | 17 % / 28 % |
| `--<hue>-wash` (light) | app.css | hue 11–16 % into `#fff` |
| `--hero-bg` | brand 46 % → indigo 26 % → teal 18 % over `--surface` | brand 92 % → indigo 78 % → teal 72 % over deep navy |
| `--font-display` | Inter (var(--font-sans)), 650, `--display-tracking` −0.03em | same |
| `--ease / --dur / --dur-slow` | cubic-bezier(.2,0,.2,1) / 150 / 260 ms | same |

Area hues unchanged: Overview `--brand`, Money `--teal`, Assets `--purple`, Retirement `--blue`, Home `--orange`, Calendar `--indigo`, Documents `--fg3`. Series palette unchanged. Person hues: Jana `--series-health`, Petr `--series-savings`.

Type scale used: 30/24 screen title · 26 hero figure · 24–28 tile figure (22 <900) · 20 banner stat · 17–18 panel figure · 16 banner title · 15 section title · 14 panel title/row title · 13–13.5 body · 12–12.5 secondary · 11–11.5 notes/eyebrows · 10–10.5 micro. Mono: every tabular number, date, ID, %.

## Components to add / change (Svelte)
| Component | Change |
| --- | --- |
| `Sidebar.svelte` | hero net worth, tile nav rows, rail + bottom-bar variants, segmented theme |
| `ScreenHeader.svelte` | area tile, display title, pill sub-tabs, actions slot |
| `Panel.svelte` (overview) | v2 card, hue-tile header, customise toolbar, width/order props |
| `Board.svelte` | 12-col grid, order/width state, add-panel tray, 5 new panels |
| `BriefingCard.svelte` / `MetricTile.svelte` | washes, display figures, nowrap |
| `Segmented.svelte`, `Button` (`.btn`) | new radii/heights/hover |
| **new** `IconTile.svelte` | hue + size |
| **new** `LineChart.svelte` | port of `charts/line.js` |
| `Sankey.svelte` | gradient ribbons, bidirectional path highlight, flame |
| `TransactionRow.svelte` | swatch, chips, month header |
| **new** `Switch.svelte` | 38×22 |
| `DocumentsRail.svelte`, `QueueView.svelte`, `WalletView.svelte`, `DossierView.svelte`, Statements ribbon | restyle per Documents section — the v0.8.0 engines already exist; no new document components |
| `SummaryBand.svelte`, `MetricTile.svelte`, `tiles.ts`, `ControlRow.svelte` | see *Mapping onto the v0.8.0 screen frame* |
| `settings/+page.svelte` | section nav, card grids, switch |

## Order of work
1. `app.v2.css` tokens (+ light rework) → 2. Shell: Sidebar / rail / bottom bar, ScreenHeader → 3. Card, IconTile, MetricTile, Segmented, Switch → 4. Overview Board + panels + customise → 5. Money screens (Transactions, Accounts, Cash flow, Salary, Tax, Import, Rules) + LineChart → 6. Assets (Property, Investments, Loans) → 7. Retirement → 8. Home, Calendar, Contacts → 9. Documents layouts → 10. Settings → 11. Sign-in → 12. `docs/ui-guidelines.md` update per `CHANGES.md`.

## Files
- `prototype/Continuum v2.dc.html` — the full clickable prototype (all screens, both themes, three layouts). Logic class at the bottom holds all fixture data and state.
- `prototype/Continuum Current.dc.html` — today's UI, recreated, for comparison.
- `prototype/charts/sankey.js`, `prototype/charts/line.js` — chart engines (JS; port to Svelte).
- `prototype/data/demo.js` — demo household fixtures.
- `prototype/handoff/app.v2.css` = `tokens/app.v2.css` — the token file to ship.
- `prototype/_ds/` — design-system tokens/bundle the prototype loads (reference only).
- `CHANGES.md` — component-by-component change list and rule changes for `docs/ui-guidelines.md`.
- `V080_RECONCILIATION.md` — what changed between the first handoff (0.7.9) and this one (0.8.0).

## Assets
No imagery. Icons are the app's own `src/lib/icons.ts` set (new usages: `grip`, `alert`, `lock`, `search`, `key`, `sliders`, `bars`, `trend`, `layers`, `coins`, `target`, `bolt`; the dossier uses `dots`, `pin`, `chevronDown` which v0.8.0 already has). Emoji stay data-level (accounts, shelves, subjects, organisations, modules, theme toggle). Wallet card faces are CSS gradients standing in for the repo's country card art.
