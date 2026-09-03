# Continuum Design System

**Continuum** is a self-hosted household-finance server by Pandorica Scientific (Robert Kiewisz, AGPL-3.0). One SvelteKit web app, one shared ledger for a two-adult household: bank statements from any bank (CSV/XLSX/PDF/CAMT/MT940/OFX/scans) read and verified against their own balances, then connected to accounts, property, tenancies, loans with fixation periods, investments, payslips, tax, a calendar, contacts and a document archive. It never calls home: no cloud, no telemetry, no CDN — every font and icon ships in the bundle.

Tagline: *Your household's whole financial picture, on hardware you own.*

## Sources

- Codebase (attached local folder): `continuum/` — authoritative. `src/lib/styles/app.css` (tokens), `src/lib/components/` (primitives), `src/lib/icons.ts` (icon set), `src/lib/modules/registry.ts` (navigation), `src/routes/(app)/` (screens), `docs/ui-guidelines.md` (rules).
- GitHub: https://github.com/pandorica-scientific/continuum — same tree. Its `design_system/` folder is the **historical handoff** (`README.md`, `Continuum v4.dc.html`, `colors_and_type.css`); the ui-guidelines state that where it disagrees with code, code wins. Explore the repo for deeper rationale.
- Product screenshots: `docs/screenshots/` (copied to `assets/screenshots/`).

## Products / surfaces

One product with two layouts:
1. **Web app (desktop, ≥1024px)** — 252px sticky sidebar + main column. Seven areas: Overview, Money (Cash flow · Accounts · Transactions · Salary · Tax · Import · Rules), Assets (Property · Investments · Loans), Retirement, Home, Calendar & Contacts, Documents. Settings sits behind a gear next to the wordmark.
2. **Phone layout (<1024px)** — the sidebar becomes a drawer behind a ☰ button bottom-right; quick-add stacks above it. Same components.
Plus a sign-in screen and an error-page family.

## Content fundamentals

- **Second person, dry, concrete.** "Balances stay in their own currency. Only totals convert." Numbers before qualifiers: "filing at 70% confidence and above", never "quite confident".
- **Captions teach.** Every screen title has a one-line caption below it explaining the rule of the screen: *"Every row the ledger holds. Search it, narrow it, file what the rules missed."* — *"What each yearly statement said — recorded, never computed."*
- **Sentence case everywhere** — titles, buttons, tabs, pills ("Cash flow", "Add account", "needs a look"). Eyebrows are the one uppercase element (CSS transform, 0.1em tracking).
- **British spelling**: customise, colour, licence, categorised.
- **No exclamation marks, no marketing adjectives.** Empty states say what would fill them: "Matched pairs from imported statements will appear here."
- **Refusals explain themselves**: "A statement is filed only once it agrees with its own arithmetic."
- **Emoji**: yes, but bounded. Screen-title prefixes in the old handoff; today they survive on rows that own an editable emoji (accounts 🏦, shelves, subjects), module toggles (📥 🏢 📈 💳 🎯 💼 🏠 📅 🧾 🗂️ 📇), card eyebrows via `Eyebrow emoji=`, the theme toggle (🌙 Dark / ☀️ Light), and action buttons like "➕ Add account", "📎 Receipt". Never as decoration in prose.
- **Unicode glyphs as controls**: ✕ close/remove, ✎ edit, ‹ › pager, ↑ ↓ move, ⋯ menu, "Open →", "Something else…".
- **Numbers**: space thousands separator, currency after the figure (`6 479 322.83 Kč`), ISO dates (`2026-08-25`), negative with a real minus sign. Always mono.
- **Names in fixtures**: Czech household (Novák, Karlín, Vinohrady, Fio, ČS, XTB, SVJ). Base currency CZK; EUR/USD/PLN alongside.

## Visual foundations

- **Themes.** Dark is default and base (`#0e1117 → #11161f` vertical gradient, fixed attachment; sidebar `#0a0d13`). Light is an explicit opt-in (`html[data-ledger-theme="light"]`): warm oat paper `#f3f0e9` with crisp **white** cards. No system-preference fallback.
- **Surfaces are tints, not colours.** Dark cards are `rgba(255,255,255,0.03)`, hover `.06`, active `.09`. Depth comes from ground tint + 1px border, never from elevation.
- **Borders**: always 1px. `--bd` (0.08) on cards and dividers, `--bd2` (0.18) on inputs and emphasis. Coloured borders appear **only** on traffic-light pills (and the 3px orange left edge of the approximate-rate banner, 2px active panel edge).
- **Shadows**: none in the document flow. Two tokens exist for things that float — `--shadow-float` (menus, hint bubbles, quick-add menu) and `--shadow-raise`. Floating surfaces are painted with opaque `--bg2`, never a translucent card tint.
- **Radii**: 8px buttons/inputs, 10px cards/tiles/panels, 12px pills, 14px modal, 20px sub-tab chips, 999px avatars and the 52px quick-add.
- **Type**: Inter Variable for text, Source Code Pro for **every number** (load-bearing, not taste). Body 16/1.55 on `body`, but nearly all UI text is 12–13px. Screen title 28/600/−0.02em with a 26px icon in the area's hue; section heading 22/600/−0.01em; eyebrow 11px uppercase 0.1em `--fg3`; metric value 19/600 mono; caption 13px `--fg3`.
- **Colour semantics**: green/yellow/red = state (good/watch/bad), never decoration. blue = links, primary action, housing series. teal/purple/orange/indigo = data series and area identity. `--brand #4a86c8` (dark) / `#1b4f8a` (light) is separate from `--blue` and used only on the mark, the Overview area and the quick-add button. Three levels per hue: ink → `-tint` (pill fill, 0.18 dark / 0.13–0.16 light) → `-wash` (card ground, ~0.06). In light mode tints are mixed from bright hues, never from the dark ink.
- **Area identity hues** (sidebar icon + title mark): Overview brand · Money teal · Assets purple · Retirement blue · Home orange · Calendar indigo · Documents fg3. Active nav row = `color-mix(hue 22%)`, hover 14%.
- **Series palette**: nine OKLCH-generated category colours validated for protan/deutan separation, in waterfall order (income, taxes, bills, subscriptions, health, transport, living, housing, savings) + ten reserve slots.
- **Spacing**: main `26px 32px 60px`, section gap 26px, card grid gap 16px, metric-tile gap 12px, tile padding `12px 14px`, content card `14px 16px`, panel `14px 16px`. Scale `--space-1…8` = 2·4·6·8·10·12·14·16; padding is deliberately unpoliced.
- **Controls**: one height, `--control-h: 36px`, for inputs, selects and `.btn`. Focus ring `2px solid var(--blue)` offset 2px.
- **Hover**: background steps one tint (`--card` → `--card2`); text `--fg3` → `--fg1`; primary button opacity .9. **Press**: `--card3` + `translateY(1px)`, 90ms ease-out — the only transition in the product. Disabled: opacity .45.
- **Animation**: none. The product is static and precise. Reduced-motion is honoured; the press stays.
- **Backgrounds/imagery**: no photography, no illustration, no patterns in the app. Error pages use generated `.webp` art (in the repo's `design_system/assets/error-pages/`). User-fillable image slots exist for floor plans and photos.
- **Charts**: SVG ribbons/bars with HTML labels; chart labels carry a text-shadow halo in `--bg` (`0 0 8px` ×2, `4px`, `2px`) instead of plates. Waterfall node bars 11px, `rx=2`; ribbon opacity 0.18 trunk / 0.28 expenses.
- **Transparency/blur**: translucent tints only; no backdrop blur anywhere. Modal backdrop `rgb(0 0 0 / .55)`.
- **Layout fixed elements**: sticky sidebar (`100dvh`), fixed quick-add bottom-right 24px at z-30, approximate-rate banner at top of main when a currency has no fixing.
- **Cards**: `--card` fill, 1px `--bd`, 10px radius, no shadow. Metric tile = label 12 `--fg3` / value 19 mono 600 / note 11.

## Iconography

- **Own inline-SVG set** — 42 glyphs in `src/lib/icons.ts`, copied to `assets/icons.js` (`window.CONTINUUM_ICONS`) and wrapped by the `Icon` component. Geometry: 24 viewBox, `fill:none`, `stroke:currentColor`, `stroke-width:1.7`, round caps and joins. Phosphor-like, hand-drawn per glyph with written rationale (six-dot grip not three lines; closed padlock; two-figure people).
- **Sizes**: 19px sidebar rows, 26px screen title (area hue), 16px header buttons and menu items, 14px panel eyebrows, 13px inline lock, 24px quick-add plus.
- **No icon font, no CDN, no library** — the product must not call out. Do not link Lucide/Heroicons; add paths to the set instead.
- **Emoji** are used as data-level markers (accounts, shelves, modules, card eyebrows) — see Content fundamentals. **Unicode glyphs** (✕ ✎ ‹ › ↑ ↓ ⋯ → ☰ ⓘ-style) serve as small controls.
- **Brand mark** "time layers": three nested arcs opening right (opacity 1 / .62 / .34) around a filled point, `currentColor` in `--brand`, 22px in the sidebar beside a 16px/600 "Continuum" wordmark. Source: `assets/logo.svg` (from `docs/logo.svg`) and the `BrandMark` component. Below 16px the outer arc is dropped.

## Intentional additions

- `Icon` wrapper component (the product has one too; ours reads `assets/icons.js`).
- Semantic alias tokens (`--surface-*`, `--text-*`, `--state-*`) — conveniences that resolve to product tokens.

## Index

- `styles.css` → `tokens/{fonts,colors,typography,geometry,base}.css`
- `assets/` — `logo.svg`, `icons.js`, `fonts/`, `screenshots/`
- `guidelines/` — foundation specimen cards (Colors, Type, Spacing, Brand)
- `components/core/` — BrandMark, Icon, Button, Pill, PersonTag, MetricTile, Eyebrow, Segmented, Field, ActionError, InfoHint, ListPager, UploadDropzone, Modal
- `components/shell/` — Sidebar, ScreenHeader, Panel, QuickAdd, RateBanner
- `components/data/` — TransactionRow, AccountRow, DocumentsCard, BriefingCard
- `ui_kits/continuum-app/` — Overview, Transactions, Accounts, Loans, Sign-in as one click-through
- `thumbnail.html`, `SKILL.md`, `github.md`

## Not recreated (and why)

The waterfall chart's layout algorithm (`buildFlow` + label relaxation), the scan engine, floor-plan editor and error-page art are subsystems, not primitives — the UI kit shows a static stand-in for the waterfall. See the repo's `design_system/README.md` for the full spec if you need to port them.
