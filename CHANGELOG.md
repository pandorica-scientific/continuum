# 📓 Changelog

✨ Added · 🔧 Changed · 🐛 Fixed · 🔒 Security

## 0.9.1 — 2026-09-13

> Regions you can actually name and reach, places worth the detour, and a scratch you can take back.

### ✨ Added

- 🪙 **Places worth seeing** — a curated set of places for each country sits under its map as gold coins, each rubbing off to reveal an engraving of the place itself.
- 👁️ **Seeing a place is recorded on its own** — rubbing a coin records that place and never colours the country, which keeps visits the only answer to where the household has been.
- 🧭 **A trip suggests what is worth seeing there** — the curated places for a trip's destinations are offered beneath its list and become rows only when one is tapped.
- ↩️ **A scratch can be taken back for five seconds** — Undo restores the selected region and removes the manual visit without affecting trip-derived visits.
- 🗿 **Attribution for the artwork and data the map ships** — NOTICE.md records the engravings, typefaces and geographic sources with their licences.
- 🏠 **The demo household arrives with its smart home already connected** — rooms, devices that switch and a month of energy, held in memory rather than reached over the network.

### 🔧 Changed

- 🌏 **A continent coin is scratched away in the shape of each country visited** — Australia clears the share of the Oceania coin it actually covers instead of a fixed dot.
- 📐 **Continent progress is weighted by land area** — and the bar is held back from a hundred per cent until every country on that continent has been visited.
- 🧩 **Far-flung regions are drawn in panels of their own** — Svalbard, the Azores, Madeira and the French overseas régions keep a legible scale instead of shrinking their country into a sliver.
- 🕐 **Time-zone offsets are labelled along the band they mark** — the labels read up the map edge rather than stacking into rows above it.

### 🐛 Fixed

- 🗺️ **Country regions now use the correct administrative level** — regional boundaries are dissolved consistently, including for France, Italy, Spain and the United Kingdom.
- ✨ **Scratching a region no longer reloads the whole map** — the country outline and foil state remain stable while the visit is recorded.
- 🔍 **A region smaller than a fingertip can now be scratched** — Jervis Bay, the District of Columbia, Moscow, Luxor and every atoll of the Maldives are drawn as a disc large enough to reach.
- 🏝️ **Pacific countries are on the right continent** — Kiribati, Palau, Guam, French Polynesia and the Northern Marianas were filed under North America or Asia, so scratching one moved the wrong coin.
- 📊 **A continent counts every country the map can draw** — Oceania read a hundred per cent at seven countries because the rest were in no denominator at all.
- 🇫🇷 **Hyphenated region names wrap on their hyphens** — Provence-Alpes-Côte d'Azur and its neighbours no longer overflow their outline.
- 🕛 **UTC+12:00 no longer sits on top of UTC+11:00** — a band cut in half by the edge of the map keeps its own label.
- 🧹 **A browser that had opened the map before no longer serves stale geodata** — outlines, continents and time zones are all stamped with the build they came from.
- ⚡ **The first Map after a restart opens straight away** — working out which time zone owns each column took seventeen seconds and now takes half of one.
- 🇷🇺 **A region that crosses the antimeridian stays with its country** — Chukotka was measured as 324 degrees from its neighbours and drawn in a panel of its own.
- ✅ **A scratch the server refused is no longer reported as saved** — a rejected scratch, undo or coin says what happened instead of showing a change that the next load undoes.

## 0.9.0 — 2026-09-12

> A map that fills itself in, a cellar that knows what wants drinking, and the passports to get you there.

### ✨ Added

- 🧳 **Trips** — ideas, destinations, members, bookings, documents and derived trip status in one workflow.
- 🗺️ **Visited-country map** — ended trips populate visits automatically; countries, regions, cities, years and time zones are shown on the map.
- 🪙 **Scratchable country map** — countries and regions can be revealed manually, with places of interest shown separately.
- 🛂 **Travel readiness** — passport expiry and issuing country are read from identity documents and combined with visa data; unknown data remains unknown.
- 🍷 **Collections and cellar** — bottlings track owned/open bottles, tastings, notes, scores, drink-by windows and opening suggestions.
- 🍳 **Cookbook** — recipes, ingredients and quantities scale to the number of people eating without inventing missing measurements.
- 🎨 **Stable generated artwork** — trips, recipes and bottles keep the artwork chosen when they were created.

### 🔧 Changed

- 🗂️ **Life modules are independently switchable** — Trips, Cookbook and Collections have separate toggles and navigation.

## Earlier releases

The releases below are retained as a compact history. Detailed implementation notes live in the corresponding commits.

### 📷 0.8.7–0.8.0 — Scanner, documents and Overview

- The scanner gained reliable page-edge detection, curved-edge correction, colour-aware detection, server-side processing, HEIC support and smaller browser bundles.
- Uploads now share one drop, browse and camera control, support multi-page documents, preserve originals, and handle failed or repeated scans safely.
- Identity documents gained structured metadata, country grouping, card artwork, custom document types, masked numbers and improved filing from Inbox.
- Overview became a configurable board with module-aware panels, summary bands, responsive layout, accessible navigation and corrected chart, import and document behaviour.
- Geodata, local-network setup, Docker self-hosting and browser themes were improved; related accessibility and contrast defects were fixed.

### 🗂️ 0.7.9–0.7.0 — Documents, shelves and organisations

- Documents gained shelves, coverage ribbons, organisation and role-period tracking, filing suggestions, review feedback, statement coverage and clearer Inbox workflows.
- Identity and other system shelves became structured views with wallet/list modes, country artwork, expiry states and configurable expected document types.
- The import and document paths gained safer filtering, archive handling, search context and boot checks for incompatible database versions.

### 📄 0.6.2–0.6.0 — Scanning and paper archive

- Paper could be photographed, cropped, flattened, converted to PDF and filed from any file input, with local HTTPS support for phone cameras.
- Scan processing moved toward safer, lower-memory operation with better orientation handling, colour preservation, retry behaviour and error reporting.

### 💼 0.5.7–0.5.0 — Salary and release automation

- Salary supports multiple payslips per month, batch filing, multiple currencies, learned employer wording, corrections, provenance and clearer gross/net/bonus handling.
- Duplicate uploads are detected by file content, existing entries are preserved, and filing feedback is explicit.
- Release automation now synchronises versions, validates changelog sections, prevents accidental downgrades and publishes tags only after the image succeeds.

### 📊 0.4.6–0.4.0 — Salary, tax and visual system

- Salary became a dedicated screen with gross, net and bonus figures, editable source data, household totals, charts and paged history.
- Tax and loan workflows gained clearer calculations, correction paths and stronger validation.
- The interface received the shared design system, responsive charts, accessible controls, consistent fields, theme support and the first major Overview refinements.

### 🧱 0.3.10–0.3.0 — Ledger foundation and integrations

- The database moved to a single generated baseline with UUID keys, enum and foreign-key checks, currency metadata, shared entities, jobs and net-worth components.
- Money, imports, transfers, loans, property, investments, retirement, documents and configuration writes gained transaction boundaries, locking, validation and concurrency fixes.
- Contacts, recurring calendar events, CalDAV, iCloud, Google Calendar and generated household events were added, with conflict handling and safer sync semantics.
- Security and operations improved through central authentication transitions, passkey protections, API boundaries, error references, licensing and source-file metadata.

### 🌱 0.2.1–0.1.0 — Initial ledger

- Initial household finance workflows: accounts, statements, transaction review, categories, rules, transfers, budgets, net worth, property, loans, investments, retirement, documents and tax records.
- Initial Docker Compose deployment, authentication, themes, import readers, calendar foundations and household settings.
