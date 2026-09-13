# 📓 Changelog

✨ Added · 🔧 Changed · 🐛 Fixed · 🔒 Security

## 0.9.1 — 2026-09-12

> Countries you can actually name, and a scratch you can take back.

### ✨ Added

- ↩️ **A scratch can be taken back for five seconds** — Undo restores the selected region and removes the manual visit without affecting trip-derived visits.

### 🐛 Fixed

- 🗺️ **Country regions now use the correct administrative level** — regional boundaries are dissolved consistently, including for France, Italy, Spain and the United Kingdom.
- ✨ **Scratching a region no longer reloads the whole map** — the country outline and foil state remain stable while the visit is recorded.

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
