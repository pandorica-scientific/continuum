# Continuum v2 — component-by-component change list

Companion to `app.v2.css` (token additions; radii aliased to the v0.8.0 geometry scale) and `Continuum v2.dc.html` (clickable prototype).
Every value below is a token or a mix of tokens from `src/lib/styles/app.css`; nothing new is a literal.

## Rules that change (update `docs/ui-guidelines.md`)

| Rule today | v2 |
| --- | --- |
| Nothing in the flow is raised | Cards carry `--shadow-card` (one value, quiet). Floating things keep `--shadow-float`. |
| Coloured borders only on pills | Also: the rate banner border (`orange` 35 %), a selected person row (`brand` 55 %), a customising panel (`--brand`). |
| Radii 8 / 10 / 12 | `--radius-ctl` 10 (buttons, inputs) · `--radius-tile` 12 (icon tiles, inner tiles) · `--radius-card` 16 (cards, panels). Pills stay 999. |
| Animation: none | `--dur` 150 ms / `--dur-slow` 260 ms on `--ease` for hover background, transform and the screen fade-in (`v2-in`). The 90 ms press stays. `prefers-reduced-motion` collapses all of it. |
| Every number in mono | **Headline** figures (hero net worth, metric tiles, month net, account balance) use `--font-display` (Inter) 650 / −0.03 em / `tabular-nums`. **Table** figures, dates, IDs and pills stay mono. |
| Eyebrows uppercase on every card | Panel titles are sentence case 14 / 600 with a 26 px hue tile before them. Uppercase eyebrows survive only on the hero label and small column headers. |
| Emoji as screen-title prefix | Gone. The area icon sits in a 46 px tile in the area hue. Emoji stay where they are data (account rows, module toggles, theme toggle, “➕ Add account”). |

## Shell

**Sidebar (≥1180 px, 264 px)** — `src/lib/components/Sidebar.svelte`
- Brand: mark inside a 32 px `brand` tile, wordmark 17 / 650.
- Net worth: card → hero. `--hero-bg` gradient, `--shadow-hero`, white type, 26 px display figure, delta as a translucent pill.
- Nav row: 42 px, `grid 32px 1fr auto`, radius 12. Icon in a 32 px tile: `--surface-2` idle, hue 28 % active. Row bg hue 14 % active / 9 % hover. Active weight 600.
- Foot: theme toggle becomes a segmented control; person row gains a hue avatar (`personHues`) and household line.

**Rail (720–1179 px, 76 px)** — new
- 44 px icon tiles only, `title` for the label, yellow dot for the Import badge. Theme, settings and avatar at the foot.

**Bottom bar (<720 px)** — replaces the ☰ drawer
- Fixed, 5 items: Overview · Money · Assets · Calendar · Papers. 28 px pill behind the active icon in its hue. Brand row moves to the top of `main`. Quick-add sits 86 px up.

**ScreenHeader** — `ScreenHeader.svelte`
- 46 px area tile (hue 16 %) + title 30 / 650 / −0.025 em (24 px on phone) + caption 13 `--fg3`. Header actions (synced chip, primary button) right-aligned.
- Sub-tabs: 34 px pills with a 15 px screen icon; active = area hue 18 % bg, hue icon, 600.

**RateBanner** — `orange-wash` ground, 28 px `alert` tile, 1 px `orange` 35 % border. Left 3 px edge dropped.

**QuickAdd** — 54 px, `--hero-bg`, `--shadow-hero`, plus rotates 45° when open. Menu items get 28 px hue tiles.

## Overview — `src/lib/overview/`

**Panel** — `--surface`, `--radius-card`, `--shadow-card`, padding 18 / 20. Header: 26 px hue tile + sentence-case title + quiet count/period; `Open →` stays right.
Panel hues: briefing `yellow`, flow `teal`, composition `purple`, upcoming `indigo`, accounts `teal`, networth `blue`.

**BriefingCard** — 30 px tile in the pill’s hue, ground = `<hue>-wash`, hover lifts 1 px.

**FlowPanel** — totals become four wash tiles (`green` / surface / `teal` / `red`) with 24 px display figures. Ribbons fill 22 → 62 % of the series colour with a 12 px solid end bar; leaves list to the right, rail-coloured.

**CompositionPanel** — one stacked share bar above the list; square 10 px swatches.

**UpcomingPanel** — date as a 44 px indigo calendar chip (month / day).

## Money

**Cash flow** (new v2 layout) — four metric tiles → “Month by month” paired bars (green in / red out, gradient fill) → “Where it went” (share bar, per-group row with 30 px tile, mono amount, hue percentage chip) beside “Where it came from” (source bars).

**Accounts** — one card per account: 44 px emoji tile on the account’s series hue, display balance right, share bar with mono %. Donut inner disc `--surface`; legend swatches square.

**Transactions** — filter form collapses to search + quick chips (`All · Needs a look · Money in · Money out`) + “More filters”. Month header card: teal chevron tile, display net, 120 px in/out bar. Row: 8 × 22 px category swatch before the merchant, category as a hue chip (wide only), mono amount, `needs a look` pill unchanged. Open panel indents to the merchant column.

## Assets

**Loans** — metric tiles with washes; loan card with 44 px purple tile, 15 px mono facts, repaid bar (green → teal), **fixation timeline** (past rate grey, current teal, unknown hatched purple); actions as ghost buttons; “Add loan” is a dashed card with a purple plus tile.

## Sign-in

Two-column above 900 px: `--hero-bg` panel with tagline and three fact pills; form card right. Person rows are radio cards with hue avatars. One column below.

## Added since the first list

**Overview customise** — panels carry width (⅓ ½ 1 of a 12-col grid) and order; hidden panels return from an "Add a panel" tray; five new panels (Accounts, Investments, Loans, Expiring documents, Energy this month).

**Salary / Tax** — the "Change" and "Effective rate" views are a data-driven line chart (`LineChart`, see README); year rows expand to payslips / per-jurisdiction cards with filed documents; currency switch in the table header.

**Rules** — grouped by category, collapsed by default, group header is a summary row (count, average trust bar, kept · overridden); filter chips All / Below the floor / Disabled.

**Retirement** — live model: SVG gauge hero, assumptions panel with real range inputs and person pension cards, capital-vs-target line chart, 40-year table with coverage bars.

**Documents (v0.8.0 shelf model)** — rail is Inbox · Shelves · Everything · Tags (subjects and organisations are cards, not rail sections); the shelf emoji/label/question fill the ScreenHeader; three tiles from `shelfTiles(engine)` in the SummaryBand; engines restyled in place: queue (three-step shelf → card → lane, rule proposal pre-answers), wallet, completeness (four cell states), dossier (lanes, spans, `once` slots, history, pinned document, collapse-with-finding). No shelf banner.

**Settings** — section nav; Modules and Categories as responsive card grids; Switch primitive; Open-instance warning state.

**Light theme** — reworked in `app.v2.css`: page a step darker than white cards, sidebar a step lighter, stronger borders/shadows, washes remixed at 11–16 % into white, richer hero gradient.

**Accounts** — pie has no centre disc; total moved to the panel header.

## Order of work

See README.md § Order of work (12 steps).

## Rule change for v0.8.0 lint

- `design/no-raw-shadow`: allow `--shadow-card`, `--shadow-hero`.
- `docs/ui-guidelines.md` type ramp: add `--font-display` (Inter 650 / −0.03em, tabular) as the one sanctioned non-mono figure, used only for headline figures (hero, metric tiles, banner-less shelf tiles).
