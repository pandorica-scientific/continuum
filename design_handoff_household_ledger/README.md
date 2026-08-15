# Handoff: Continuum — self-hosted household finance server

## Overview

**Continuum** — a self-hosted web dashboard for a two-adult household to track everything financial in one
place: bank accounts across five institutions and four currencies, imported bank statements,
two flats (one lived in, one rented out), investments, loans with fixation periods, a
retirement projection, a household calendar that syncs two ways with iCal/Google, Home
Assistant device control for the flat they live in, and a document archive.

It is intended to ship as an **npm package that people self-host**, so everything visible —
people, currencies, accounts, properties, and whole feature modules — is configuration, not
hard-coded content. The Settings screen is the contract for that: switching a module off
removes it from the sidebar entirely.

Primary questions the product answers, in priority order:

1. What is our total net worth right now, and is it going up?
2. Where did the money go, by category?
3. How is each flat's value doing against its mortgage?
4. How have our salaries grown over the years?

## About the design files

The files in this bundle are **design references created in HTML**. They are prototypes that
show intended look, layout, copy and behaviour — they are **not production code to copy
directly**.

The task is to **recreate these designs in the target codebase's existing environment**
(React, Vue, Svelte, SwiftUI, native, whatever is already in use) using its established
patterns, component library, routing, and data layer. If no environment exists yet, choose
the framework most appropriate for a self-hostable single-user web app with a small backend
(a Next.js or SvelteKit app over SQLite/Postgres would suit this product) and implement the
designs there.

Two specific things in the prototype are prototype-only scaffolding and should be replaced,
not ported:

- The prototype is a single self-contained HTML file with an inline template + a logic class.
  Split it into real routed screens and components.
- All data is hard-coded in the logic class as static getters (`FLOWS`, `PROPS`, `LOANS`,
  `DOCS`, `ROOMS`, …). These are **fixtures illustrating shape and realistic magnitude**, not
  seed data. Replace with real models and queries.

The one piece of logic worth porting closely is the **Sankey/waterfall layout algorithm**
(`buildFlow` and its label-relaxation pass) — it is non-obvious, was iterated on heavily,
and is described in detail below.

## Fidelity

**High fidelity.** Colours, typography, spacing, radii, states and copy are final. Recreate
the UI pixel-accurately using the codebase's existing primitives where they exist, and match
the token values below where they don't.

The one deliberate exception: the prototype uses **Unicode emoji as its entire icon system**
(a constraint inherited from the design system it was built against). If the target codebase
already has an icon set, substitute equivalents — but keep the *semantic* colour mapping
(green/amber/red as state, never decoration).

---

## Design system it was built against

Stock Watcher Design System — a dark-first, engineer-pragmatic dashboard system. Key
inherited rules:

- **Dark is the default and the primary theme.** The light theme here is an addition the
  product needed; it is a warm oat-paper palette, not a cold white one.
- **Traffic-light semantics.** Green/amber/red always mean state (good / watch / bad).
  Never used decoratively.
- **Flat-UI accent palette** for data series. Series colours are deterministic and should
  not be reassigned — users read by colour.
- **1px borders, two strengths.** Soft for cards, strong for inputs and emphasis. Coloured
  1px borders appear only on traffic-light pills.
- **Almost no shadows.** Depth comes from background tints, not elevation.
- **No animation.** The product feels static and precise. Do not add motion.
- **Copy is dry and technical**, second person, concrete numerics before qualifiers
  ("Composite 64/100", not "quite high"). Captions teach — they explain the maths.

---

## Design tokens

Defined as CSS custom properties on `:root`, overridden under
`html[data-ledger-theme="light"]`. Theme choice persists in `localStorage` under
`ledger-theme`; **dark is the default when nothing is stored** (no system-preference
fallback — this was an explicit decision).

### Colour — dark (default)

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0e1117` | canvas top |
| `--bg2` | `#11161f` | canvas bottom (body is a vertical gradient, fixed attachment) |
| `--side` | `#0a0d13` | sidebar |
| `--card` | `rgba(255,255,255,0.03)` | card and metric-tile fill |
| `--card2` | `rgba(255,255,255,0.06)` | hover, secondary button fill |
| `--card3` | `rgba(255,255,255,0.09)` | active nav item, progress track |
| `--bd` | `rgba(255,255,255,0.08)` | card borders, dividers |
| `--bd2` | `rgba(255,255,255,0.18)` | inputs, emphasised borders |
| `--fg1` | `#e6e9ef` | primary text |
| `--fg2` | `#c5ccd6` | body text |
| `--fg3` | `#8a96a6` | captions, muted |
| `--fg-inverse` | `#0e1117` | text on a bright accent fill |
| `--green` | `#2ecc71` | income, gains, "on" state |
| `--red` | `#e74c3c` | debt, losses, outflow |
| `--yellow` | `#f1c40f` | needs attention, transport series |
| `--blue` | `#3498db` | housing series, links, primary action |
| `--purple` | `#9b59b6` | food & lifestyle series, person 2 |
| `--orange` | `#e67e22` | bills & utilities series |
| `--teal` | `#1abc9c` | investments series |
| `--plate` | `rgba(14,17,23,0.86)` | label halo base |
| `--*-tint` | `rgba(<hue>,0.18)` | traffic-light pill fills (green/yellow/red/blue/teal/purple) |
| `--grey-tint` | `rgba(138,150,166,0.16)` | neutral pill fill |
| `--brand` | `#4a86c8` | logo mark only — see *Brand* |

### Colour — light

| Token | Value |
|---|---|
| `--bg` / `--bg2` / `--side` | `#edeae3` / `#e6e2d9` / `#e9e5dd` |
| `--card` / `--card2` / `--card3` | `#f6f4ef` / `#eeebe3` / `#e2ddd2` |
| `--bd` / `--bd2` | `rgba(58,50,38,0.13)` / `rgba(58,50,38,0.26)` |
| `--fg1` / `--fg2` / `--fg3` | `#23201b` / `#4b463d` / `#7d766a` |
| `--fg-inverse` | `#ffffff` |
| `--green` | `#12945a` |
| `--red` | `#cf3b2c` |
| `--yellow` | `#a8800a` |
| `--blue` | `#2478b5` |
| `--purple` | `#7c4795` |
| `--orange` | `#bd6317` |
| `--teal` | `#0f8a72` |
| `--plate` | `rgba(237,234,227,0.9)` |
| `--*-tint` | same hues at `0.12`–`0.14` alpha |
| `--brand` | `#1b4f8a` |

The light accents are darkened from the dark-theme hues to hold contrast on paper. Do not
reuse the dark values on light.

---

## Brand

**Name:** Continuum. Set in Inter 600, title case, 15.5px, `letter-spacing: -0.01em`.
The name is a quiet Doctor Who nod — finances as one unbroken line through time — and was
chosen over trademark-adjacent options (TARDIS, Gallifrey, Time Lord are BBC marks and must
not be used on a public package).

**Mark — "time layers":** three nested arcs opening right, sharing a centre, with a filled
point at that centre. Read as concentric strata of time, or as an orbit seen edge-on.

```svg
<svg viewBox="0 0 56 56">
  <g fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round">
    <path d="M18 18 A10 10 0 0 1 18 38"/>
    <path d="M18 10 A18 18 0 0 1 18 46" opacity="0.62"/>
    <path d="M18 3  A25 25 0 0 1 18 53" opacity="0.34"/>
  </g>
  <circle cx="18" cy="28" r="3.6" fill="currentColor"/>
</svg>
```

Rendered at 22px in the sidebar, 9px gap to the wordmark. Single colour, `currentColor`,
inheriting `--brand`. The opacity ramp (1 / 0.62 / 0.34) is part of the mark — do not
flatten it. It holds down to 16px; below that, drop the outermost arc rather than shrinking
further.

**Brand colour.** `--brand` is deliberately **separate from `--blue`**. `--blue` is a
functional data-series colour (the Housing band, links, primary actions) and must not change
when the brand does.

- Light: `#1b4f8a` — police-box blue, the chosen brand value.
- Dark: `#4a86c8` — the same navy lifted for legibility. `#1b4f8a` on the `#0e1117`
  canvas fails contrast badly; do not use the light value on dark.

**Lockup:** mark + wordmark, horizontal, vertically centred, in the sidebar header above the
net-worth card. No tagline, no container, no shadow.

---

### Typography

- **Sans:** Inter (variable), weights 400 / 500 / 600 / 700. Loaded from Google Fonts.
- **Mono:** Source Code Pro, weights 400 / 500 / 600. **Every number in the product is
  mono** — balances, percentages, dates in lists, tickers. This is load-bearing for
  scannability; do not set figures in the sans face.
- Body base 16px, line-height 1.55.

| Role | Size | Weight | Notes |
|---|---|---|---|
| Screen title (`h1`) | 28px | 600 | `letter-spacing: -0.02em`, prefixed by an emoji |
| Screen caption | 13.6px | 400 | `--fg3` |
| Section heading | 22px | 600 | `letter-spacing: -0.01em` |
| Section eyebrow | 11px | 400 | `letter-spacing: 0.1em`, uppercase, `--fg3` |
| Card eyebrow | 11px | 400 | same treatment |
| Metric value | 18–19px | 600 | mono |
| Metric label | 12px | 400 | `--fg3` |
| Body / list row | 13–13.5px | 400 | |
| Small caption | 11.5–12px | 400 | `--fg3` |
| Sidebar nav item | 13.5px | 400 / 500 active | |
| Sidebar group label | 10.5px | 400 | `letter-spacing: 0.1em`, uppercase |

### Spacing, radii, borders

- Main content padding: `26px 32px 60px`. Gap between sections: `26px`.
- Sidebar: fixed `252px`, padding `20px 14px 22px`, internal gap `22px`,
  `position: sticky; top: 0; height: 100vh; overflow-y: auto`.
- Card padding: `14px 16px` for metric tiles, `16px 18px` for content cards.
- Grid gaps: `12px` for metric rows, `16px` for card grids.
- Radii: `8px` buttons and inputs, `9–10px` cards and tiles, `12px` traffic-light pills,
  `20px` chips, `999px` avatars.
- Borders: always `1px`. `--bd` for cards, `--bd2` for inputs and emphasis. Coloured 1px
  borders **only** on traffic-light pills.
- Shadows: none anywhere. The only "shadow" is the text-halo on chart labels.

### Traffic-light pill (the system's signature element)

```
border: 1px solid <hue>;
background: <hue>-tint;      /* 0.18 alpha dark, 0.12 light */
border-radius: 12px;
padding: 3px 11px;
font-size: 11.5px;
color: <hue>;
```

Used for: briefing countdowns, lease state, mortgage fixation state, the Household
attention strip, and the retirement verdict panel.

---

## Navigation

**Two levels: areas in the sidebar, screens as sub-tabs in the page header.** A flat
twelve-item sidebar was tried first and abandoned — the product has too many screens for one
list to stay legible. Seven areas hold twelve screens.

```
◗ Continuum          (time-layers mark + wordmark)
[net worth card: 10 575 900 Kč, +184 300 this month]

▣  Overview
▤  Money             [badge: 12]
▥  Property
▧  Wealth
▨  Retirement
▩  Household
▤  Admin

[Dark | Light]
[R] Robert & Tereza
```

| Area | Screens (sub-tabs) |
|---|---|
| Overview | — |
| Money | Cash flow · Accounts · Import |
| Property | — |
| Wealth | Investments · Loans |
| Retirement | — |
| Household | Home · Calendar |
| Admin | Documents · Settings |

Property and Retirement stand alone deliberately: Property already carries its own
property switcher inside the screen, so nesting it would mean two rows of tabs, and
Retirement answers a different question from the rest of Wealth.

- Sidebar is a fixed 252px, one row per area, no group headings.
- Clicking an area goes to its first live screen. An area is active when the current screen
  belongs to it.
- Active row: `--card3` background, `--fg1` text, weight 500. Inactive: transparent,
  `--fg2`, weight 400. Hover: `--card2`.
- The Import badge (count of transactions awaiting review) surfaces on the **Money** area.
  Only rendered when non-zero, a pill in `--yellow` with `--fg-inverse` text.
- Every area except Overview and Admin is a **module**. Switching a module off in Settings
  removes its screen; an area with no live screens disappears entirely.
- The net-worth card at the top is present on every screen.
- The person row at the bottom must not wrap — single line, ellipsis on overflow.

### Icons

Line icons drawn as **inline SVG paths**, Phosphor-like: 24 viewBox, `fill: none`,
`stroke: currentColor`, `stroke-width: 1.7`, round caps and joins. 19px in the sidebar,
26px in the screen title (in `--brand`), 16px on header buttons.

No icon library is linked and none should be: this ships as a self-hosted package and must
not depend on a CDN. If the target codebase already has an icon set, substitute equivalents.
Emoji survive only at card level (briefing kinds, account rows) and in `data-` content.

### App header (every screen)

Left: the screen's icon in `--brand` + screen title (28px/600) with a caption below.
Right: a `synced 09:12` status chip and an **Import statement** button.

Below that, when the area has more than one screen, a **sub-tab row**: pills at 13px,
active one on `--card3`, sitting above a 1px `--bd` rule. Areas with a single screen
render no row at all.

### Quick add

A 52px round button fixed at the bottom right, `--brand` fill, a plus glyph, opening
Import. Present on every screen, above all content at `z-index: 30`.

---

## Screens

### 1. Overview — a panel board the user builds

Caption: *August 2026 · everything reconciled to 31 July*

The Overview is **not a fixed layout**. It is a twelve-column dashboard grid the user
arranges themselves, and this is a core requirement rather than a nicety.

**Grid.** `grid-template-columns: repeat(12, minmax(0, 1fr)); grid-auto-rows: 40px;
gap: 16px`. Every panel is placed absolutely on that grid by `grid-column: x+1 / span w`
and `grid-row: y+1 / span h`. Row pitch is therefore 56px; a panel of h rows is
`56h − 16` pixels tall.

**Layout model.** One array, persisted to `localStorage` under `continuum-overview`:

```json
[{ "k": "briefing", "x": 0, "y": 0,  "w": 12, "h": 6  },
 { "k": "flow",     "x": 0, "y": 6,  "w": 12, "h": 19 },
 { "k": "composition", "x": 0, "y": 25, "w": 6, "h": 6 },
 { "k": "upcoming",    "x": 6, "y": 25, "w": 6, "h": 7 }]
```

That array is also the default layout. In the real implementation it belongs to the user
record, not the browser — a self-hosted install should carry the layout across devices.

**Edit mode.** A **Customise** button in the section header toggles it. While on:

- Panels get a `--bd2` border and a `grab` cursor.
- **Drag a panel by its body** to move it anywhere on the grid. The dragged panel gets a
  `--brand` border, lifts to `z-index: 5`, and shows a live `n/12` width badge.
  Target cell = pointer delta ÷ (column + gap), rounded; x clamps to `0 … 12 − w`, y to ≥ 0.
  A 5px threshold separates a drag from a click.
- **Corner handle** (bottom right, `nwse-resize`) reshapes: horizontal drag sets width in
  columns (minimum 4), vertical sets height in rows (minimum 3).
- **✕** removes the panel.
- An **Add a panel** tray lists whatever is not currently placed; adding drops the panel in
  the first free slot that fits its default size (scan rows top to bottom, columns left to
  right).
- **Reset to default** restores the array above.

**Collision rule — push down, never pull up.** On drop, the moved panel keeps its cell and
every other panel is walked in y order; anything overlapping something already settled is
pushed to `y = other.y + other.h`, cascading. Nothing is ever compacted upward: a panel
left in the middle of the board stays there, gaps included. That is deliberate — free
placement means the user's empty space is theirs to keep.

**Panels are fixed boxes.** `overflow-x: hidden; overflow-y: auto`, and the title
truncates with an ellipsis. Content taller than the box scrolls inside it. Default heights
are tuned so every panel in the default layout measures exactly its content — verify this
after any content change; an inner scrollbar on first load is a bug.

**The eight panels**, with default size in columns × rows:

| Key | Title | Default | Content |
|---|---|---|---|
| `briefing` | Needs you | 12 × 6 | The generated attention cards (see *Briefing rules*) |
| `flow` | Where the money goes | 12 × 19 | The waterfall chart, its In/Out/Kept stats, period toggle and breakdown strip |
| `composition` | What it is made of | 6 × 6 | Net worth decomposed, each row a bar scaled to the largest component |
| `upcoming` | Next 30 days | 6 × 7 | Dated money events, mono dates left, amounts right coloured by direction |
| `networth` | Net worth over time | 6 × 5 | Filled sparkline, 2019 → 2026 |
| `accounts` | Where the cash sits | 6 × 6 | Five accounts, share and balance, bar scaled to the largest |
| `equity` | Flats against mortgages | 6 × 5 | Equity as a green bar against value |
| `energy` | Energy this month | 6 × 5 | 14-day bars, days above average in `--orange` |

**A naming trap worth recording:** the panel data must not reuse a key already returned for
another screen. `cashSplit` was defined twice — once for the Accounts donut legend
(label + percentage only) and once for this panel (label, percentage, value, width, colour)
— and the later definition silently won, so the panel rendered names with no figures and
five identical full-width bars. The panel's data is `cashPanel`.

**b. "Where the money goes" — the waterfall chart.** Section heading 22px with the period
caption beside it, and a segmented `Year to date | This month` control on the right. Full
spec in *The waterfall chart* below.

**c. Two cards side by side** (`repeat(auto-fit, minmax(300px, 1fr))`):

- **What it is made of** — net worth decomposed into flats net of mortgage (8 200 000),
  investments (1 672 500), cash (921 400), other loans (−218 000). Each row is a label,
  a mono value in its series colour, a 6px progress bar scaled to the largest component,
  and a detail line.
- **Next 30 days** — a dated list of upcoming money events, mono dates on the left,
  mono amounts on the right coloured by direction. Links to Calendar.

### 2. 💸 Cash flow

The same waterfall chart at full width, plus:

- **Four metric tiles**: Money in, Money out, Saved and invested, Biggest single line.
- **Every month on record** — a 168px-tall paired bar chart, one pair per month
  (green earned / red spent), 91 months from Jan 2019 to Jul 2026, year labels beneath,
  and a legend with the count of months that spent more than they earned.

### 3. 🏦 Accounts

- **Accounts list** — one row per account: emoji, name, meta line (currency · owner ·
  statement freshness), then the balance **in its own currency** with the CZK equivalent in
  smaller mono beneath. CZK accounts show no second line.
- **Where the cash sits** — a 148px conic-gradient donut with a hollow centre showing the
  total, and a legend of five accounts with percentages. Excludes the brokerage.
- **Transfers between your own accounts** — matched pairs that are deliberately excluded
  from income and expenses. This is a core requirement: money moving between the household's
  own accounts must never appear as income or spending.

### 4. 📥 Import

- A dashed drop zone: *CSV, XML, OFX, ABO or PDF, any of the five banks. The layout is
  detected, transfers between your own accounts are paired and dropped, and categories come
  from what you corrected last time.*
- Four stat tiles: files this month, transactions read, filed automatically (97%),
  transfers paired.
- **Needs a decision** — only the ambiguous rows surface. Each shows date, merchant, the
  *reason* it is ambiguous, amount, and two one-click category buttons. Correcting a row is
  what trains the categoriser.

### 5. 🏢 Property

A property switcher at the top (one button per flat, showing whether it is lived in or
rented), then per-property content.

- **Five metric tiles**: estimated value, mortgage owed, equity, money in, appreciation
  (or rent yield / cash flow for the rented flat).
- **Floor plan + photos** — a 300px drag-and-drop floor-plan slot and three 144px photo
  slots. These are user-fillable; the prototype uses a drop-target component that persists
  the dropped image.
- **Tenancy card** (rented flats only) — tenant avatar, name, phone and email, a lease-state
  pill (`ends in 49 days`, amber), and four facts: rent, deposit held, lease end date, since.
  Actions: lease agreement, renewal reminder, rent ledger.
- **You live here card** (lived-in flat only) — explains that Home Assistant is bound to this
  flat so its meter readings become the bills below. Links to Household.
- **Monthly bills** — SVJ fee and repair fund, energy (from meter), water and heating,
  internet.
- **Mortgage** — fixation pill, a repayment progress bar, and a link to the schedule.

### 6. 📈 Investments

- Four metric tiles: portfolio, money in, gain, annualised real return.
- **Value against money in** — a line chart with four series: actual (teal, solid), money in
  (grey, dashed), and two benchmarks at flat 5% and 10% a year (orange and purple, dashed)
  computed on the *same contribution dates*. Y-axis in millions Kč, labelled outside the plot
  in HTML, not SVG text.
- **Holdings table** — ticker (mono), name, units, value in native currency, CZK equivalent,
  gain percentage coloured by sign. Sourced from a manually uploaded XTB report;
  **duplicates are dropped by trade id** — this is a stated requirement, since the same
  report gets uploaded repeatedly.

### 7. 💳 Loans

- Four metric tiles: total owed, monthly payments, interest this year (with the deductible
  portion), debt-free year.
- One card per loan: name, lender/rate/security line, a **fixation pill**, four facts
  (owed, payment, rate, ends), a repayment progress bar, and three actions —
  *Interest vs. principal*, *Extra repayment*, *Pay off in full*.
- An `➕ Add loan` dashed tile.

**Fixation is a first-class concept.** A mortgage can be fixed for a period and then
refinanced at a different rate. The model must distinguish:

- `fixed_period` — rate fixed until a date, then re-fixed (the two mortgages here).
- `fixed_term` — rate fixed for the whole life of the loan (the car loan).
- `floating` — rate tracks a reference.

Interest must be booked **per fixation period**, so a later re-fix never rewrites history.
The pill states which regime applies and until when.

### 8. 🎯 Retirement

Three full-width bands stacked, not a sidebar-plus-column layout:

- **Verdict panel** — a prose sentence with the key figures inline on tinted chips:
  *"If you stopped working today, your capital would pay about X a month and the state
  pension would add Y. That covers Z% of the N Kč you say you would need."* Plus a verdict
  line beneath.
- **Assumptions card** — monthly spending needed, withdrawal rate (3.0 / 3.5 / 4.0
  segmented), real return (slider, 0–8%), what happens to the flats (keep / rent out / sell
  and invest), and four state-pension fields (amount and start age per person).
- **Projection table** — rows for today, +5, +10, +15, +20 years: ages, capital, flat
  equity, monthly income, and the gap against target coloured by sign.
- **Projection chart** — pot over twenty years against the pot the target requires, both
  recomputed live from the assumptions, with a line stating when (or whether) they meet.

All figures are in today's money; returns are real, after inflation.

### 9. 🏠 Home (Household)

**Bound to the flat the household lives in only** — explicitly not the rentals.

- **Five tiles**: power now, this month (kWh and the cost that feeds the budget), water,
  indoor temperature, air quality.
- **Attention strip** — a traffic-light band listing open items (door left open, low sensor
  battery). Only rendered when there are any.
- **Rooms** — one card per room with its climate reading and a grid of device buttons.
  Devices toggle: on shows an active border and fill plus a green state line, off is
  transparent with muted text. Lights, blinds, radiators, appliances, air purifier.
- **Energy into the budget** — a 14-day bar chart with days above threshold in orange, plus
  month-to-date meter readings. Caption: *These readings replace the estimated energy line
  on Karlín's bills, so the budget follows what the meter actually did.*
- **This week at home** — the next few household events, linking to Calendar.

### 10. 📅 Calendar

- Source chips: Ledger (amber), Google · family (blue), iCal · work (purple).
- **Month grid**, 7 columns. Each day cell shows its number and coloured dots for events.
  Today is highlighted. **Clicking a day filters the agenda below it; clicking again clears.**
- **Agenda list** beneath the grid: date, source dot, full label, source name.
- **What the ledger puts here by itself** — five toggle rules:
  statement import reminder (first working day of the month), loan and card payment dates,
  property inspections and SVJ meetings, investment report update (quarterly), and
  contract/document expiry (lease, fixation, passports, policies).
- **Connected calendars** — Google (read/write), iCal (read only, webcal), and the ledger's
  own published `ledger.ics` feed.

### 11. 🗂️ Documents

- Search field over name, person, flat, year and tag; plus an `➕ Add document` action.
- **Shelves** in a left rail: Everything, Payslips, Tax, Identity, Family, Property,
  Tenancy, Loans, Insurance — each with a count.
- The document area **splits into columns by subject**, derived from the documents actually
  present — one column per person, flat or vehicle the shelf's documents are about, plus a
  final column for anything not tied to a single subject. A third flat or a new child creates
  a column by itself; no configuration.
- Each row: a file-type chip, the name, and a meta line. **Documents with an expiry date show
  it in amber instead of the added date.**

### 12. ⚙️ Settings

- **Modules** — eight toggles (Property, Investments, Loans, Retirement, Home Assistant,
  Calendar, Documents, Import). Caption: *Everything is optional. Switch off what you do not
  have and it leaves the sidebar entirely.* This must actually be true.
- **Currencies** — CZK base plus EUR, USD, PLN with their rates and what uses them. Caption:
  *Balances stay in their own currency everywhere. Only the totals at the top of a screen
  convert, at the day's rate.*
- **Household** — people with initials, role and birth year; an add-a-person action.
- **Self-hosting** — states that every label, currency, person, module and integration is
  configuration, filled from the user's own `ledger.config.json`.

---

## The waterfall chart

The centrepiece, and the piece worth porting most carefully. It replaced a conventional
four-column Sankey because a plain Sankey did not answer "what actually survives".

### Concept

Money flows **left to right in the order it is committed**, and the surviving trunk narrows
at each step:

```
income sources → Income → After tax → After bills → After transport
              → After living → Saved & invested
```

At each stage one expense group peels away downward in its own colour. The green trunk is
"money still in your hands". The stage labels sit **above** the trunk (name on one line,
amount in mono beneath); expense labels sit to the **right** of their endpoint.

Stage order, and their colours:

| Stage | Peels off | Colour |
|---|---|---|
| After tax | Taxes & fees | `--red` |
| After bills | Bills & utilities | `--orange` |
| After transport | Transport | `--yellow` |
| After living | Food & lifestyle | `--purple` |
| Saved & invested | Housing | `--blue` |

Food & lifestyle is a single group (groceries, eating out, travel, kids, everything else) —
they were named together, and it is purple so it does not read as surviving money.

### Geometry

- viewBox `1240 × H`, laid out at a fixed **880 × 592** and then **scaled to fit its
  container**, never scrolled. A `ResizeObserver` on the outer box sets
  `scale = clamp(0.18, width / 880, 1)`; the inner box carries
  `transform: scale(s); transform-origin: top left` and the outer box's height is
  `592 × s`, so there is no dead space beneath it.
- **Compute the initial scale synchronously** from `getBoundingClientRect()` when the ref
  attaches, and let the observer handle only later resizes. `ResizeObserver` never fires in
  a hidden document, so an observer-only implementation renders the chart unscaled and
  clipped in a background tab.
- The chart therefore shrinks with its panel, labels and all. Below about half width the
  leaf labels get genuinely small — an open question, not a defect.
- Node bars: 11px wide, `rx="2"`.
- Ribbons are cubic-bezier bands: control points at the horizontal midpoint, so
  `M x0,y0 C xm,y0 xm,y1 x1,y1 L x1,y1+h C xm,y1+h xm,y0+h x0,y0+h Z`.
- Ribbon opacity: `0.18` for the income fan-in and the trunk (they must match exactly —
  a mismatch renders as a hard vertical seam across the trunk), `0.28` for expense ribbons.
- The whole diagram is inset ~11 units top and bottom so no band runs flush to the edge —
  this is what lets edge labels sit on their band instead of being clamped.

### Labels — the hard part

Labels are **HTML absolutely positioned over the SVG**, not SVG `<text>`. This is deliberate:
SVG text scales with the viewBox and became illegibly small at narrow widths. HTML labels
stay at a real 12.5px/11px regardless of chart width.

Each label carries a **halo** rather than a background plate:
`text-shadow: 0 0 8px var(--bg), 0 0 8px var(--bg), 0 0 4px var(--bg), 0 0 2px var(--bg)`.
Plates were tried and rejected — they drew boxes all over the chart.

Placement runs a **block-relaxation pass**:

1. Place each label at its band's vertical centre.
2. Walk the column; where consecutive labels are closer than one line-height, treat only
   that colliding run as a block and centre the block on the run's own average position.
3. Clamp to `[EDGE, H − EDGE]` where `EDGE = 12/592 × H`.

Measured result on the current data: **zero collisions, zero clipped labels, worst drift
from true band centre 5px**. Any reimplementation should hold to that standard — verify it,
because thin bands make it easy to regress.

### Breakdown strip

Below the chart, a `repeat(auto-fit, minmax(174px, 1fr))` grid, **in the chart's own order**
(Taxes & fees → Bills & utilities → Transport → Food & lifestyle → Housing → Saved &
invested), each column headed by a colour dot, the group name and its percentage, with its
categories and amounts listed beneath. A group whose only leaf shares its name shows no
leaf list.

The seventeen leaf categories live here rather than as chart labels — crowding them onto
thin ribbons was tried and abandoned.

### Period toggle

`Year to date` (default, by explicit request) and `This month`. Both redraw the whole chart
including the breakdown. Year to date covers January–July 2026; This month is July 2026.

---

## Interactions and behaviour

| Interaction | Behaviour |
|---|---|
| Sidebar item | Switches screen. No route animation. |
| Theme toggle | Sets `data-ledger-theme` on `<html>`, persists to `localStorage`. Dark unless light was explicitly chosen. |
| Waterfall period toggle | Recomputes layout and breakdown for the selected period. |
| Sub-tab | Switches screen within the current area. |
| Quick-add button | Opens Import. |
| Customise (Overview) | Toggles panel edit mode. |
| Drag a panel | Moves it anywhere on the grid; overlapped panels are pushed down. |
| Panel corner handle | Resizes in columns and rows. |
| Add / remove panel | Adds into the first free slot; removal leaves the gap. |
| Property switcher | Swaps the whole property body, including image slots and tenancy card. |
| Home Assistant device button | Toggles the device; border, fill and state line update. |
| Calendar day cell | Filters the agenda to that day; clicking again clears. |
| Calendar auto-event rule | Toggles whether the ledger writes that event class to the connected calendars. |
| Settings module toggle | Adds/removes the screen from the sidebar. |
| Document shelf | Filters; the subject columns recompute from what remains. |
| Document search | Matches name, subject and expiry text. |
| Retirement inputs | Every control recomputes the verdict, the table and the chart live. |
| Image slot | Drag-and-drop or click to browse; the image persists. |
| Hover | Cards and buttons lift to `--card2`; borders go to `--bd2`. No transform, no scale. |

There are **no animations or transitions** anywhere. This is intentional.

---

## State

| State | Shape | Notes |
|---|---|---|
| `screen` | enum of 12 | current screen; its area drives the sidebar and sub-tabs |
| `layout` | `[{k, x, y, w, h}]` | Overview panels, persisted to `continuum-overview` |
| `customising` | boolean | Overview edit mode |
| `ghost` | `{i, x, y, w, h}` or null | live preview while dragging or resizing a panel |
| `flowScaleA/B` | number | fit scale of each waterfall instance |
| `theme` | `'dark' \| 'light'` | persisted |
| `period` | `'ytd' \| 'month'` | waterfall period |
| `propKey` | property id | selected property |
| `docShelf` | shelf key or `'all'` | |
| `docQuery` | string | |
| `calDay` | day number or null | agenda filter |
| `retire` | `{spend, swr, realReturn, plan, pensionOne, pensionTwo, ageOne, ageTwo}` | drives the projection |
| `devices` | `{deviceId: boolean}` | Home Assistant device states |
| `rules` | `{ruleKey: boolean}` | calendar auto-event rules |
| `modules` | `{moduleKey: boolean}` | which screens exist |

---

## Data model notes for the real implementation

These are the domain rules the design encodes. They matter more than the pixels.

**Multi-currency.** Balances are stored and displayed in their own currency (CZK, EUR, USD,
PLN). Only screen-level totals convert, at the day's rate, and they say so. Never
re-denominate a stored amount.

**Transfers.** Movements between the household's own accounts must be paired and excluded
from both income and expenses. The importer attempts this automatically; unpaired legs
surface in the review queue.

**Import.** Multiple formats per bank (CSV, XML, OFX, ABO, PDF), five banks (Fio,
Raiffeisenbank, Česká spořitelna, Revolut, mBank Polska) plus an XTB investment report.
Design the parser layer generically — format detection, then a per-bank adapter. Categorise
automatically and learn from corrections; only surface genuinely ambiguous rows.

**Investments.** Updated by uploading an XTB report. Deduplicate by trade id, since the same
report will be uploaded repeatedly.

**Mortgage fixation.** See the Loans section. Three rate regimes; interest booked per
fixation period.

**Property.** Each property carries value history, mortgage, monthly bills, documents,
floor plan and photos. A property is either lived in or rented. A rented one carries a
tenancy: tenant identity and contact, rent, deposit, start and end dates, and a renewal
notice deadline.

**Home Assistant.** Bound to the lived-in property only. Read: energy, water, climate,
sensors. Write: device control. Meter readings replace estimated bill lines for that
property.

**Calendar.** Two-way with Google (read/write) and iCal (read-only subscription). The ledger
also publishes its own generated events as `ledger.ics`. Generated event classes are
individually switchable.

**Expiry warnings** surface in three places at once: the calendar, the Overview briefing
strip when near, and a badge on the screen the item belongs to.

**Everything is a module.** Adding a person, a property, a currency or an account must
require no code change.

### Briefing rules

The Overview strip is generated by scanning for things that need attention, ranked by
urgency. Sources: lease expiry and renewal-notice deadlines, unreviewed imported
transactions, mortgage fixation end dates, document expiry, insurance renewal, and
overspend against a category's twelve-month average. Show the top four. The pill states the
horizon; the tone stays calm — the strip says *"four things, none of them urgent today"*
when nothing is pressing.

---

## Assets

- **Fonts**: Inter and Source Code Pro, both from Google Fonts. Self-host them in the real
  build — this ships as a self-hosted package and should not depend on a CDN.
- **Icons**: inline SVG paths in the Phosphor manner (24 viewBox, 1.7 stroke, round caps),
  written directly into the markup — no icon library, no CDN. Emoji survive only at card
  level. Substitute the target codebase's icon set if it has one, keeping the sizes above.
- **Images**: none shipped. Floor plans and property photos are user-supplied through drop
  slots. `image-slot.js` in this bundle is the prototype's drop-target component — reference
  only; use the target framework's file-upload pattern.
- **No illustrations, no photography, no decorative SVG.** All imagery in this product is
  data.

---

## Files in this bundle

| File | What it is |
|---|---|
| `Household Ledger v3.dc.html` | The design. Open it in a browser — it runs standalone. All twelve screens, both themes, all interactions. |
| `support.js` | Runtime the design file loads. Must sit beside it for the HTML to open. Prototype scaffolding — nothing to port. |
| `image-slot.js` | The drop-target component the property image slots use. Reference only. |
| `colors_and_type.css` | The Stock Watcher design system's token file, for the values the design inherits. |
| `README.md` | This document. |

`Household Ledger v3.dc.html` is a single self-contained file: an HTML template followed by
a JavaScript logic class. The chart maths, the label relaxation, the retirement model and
all fixtures live in that class. Search it for `buildFlow`, `retModel`, `FLOWS`, `PROPS`,
`ROOMS` and `DOCS`.
