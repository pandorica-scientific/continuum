# Copilot instructions for Continuum

## Project shape

Continuum is a self-hosted household finance server: a SvelteKit 2 application
using Svelte 5 runes, strict TypeScript, PostgreSQL, and Drizzle ORM. It is
normally run as the `app` and `db` services in `compose.yaml`; the supported
deployment path is Docker Compose.

The application is layered around a shared household ledger:

- `src/routes/` contains SvelteKit pages and server actions. Page-server code
  should validate transport input and delegate coherent mutations.
- `src/lib/server/` contains database and network code. Each domain is a
  directory with an `index.ts`; cross-cutting infrastructure belongs in
  `src/lib/server/system/`.
- `src/lib/` outside `server/` contains client-safe and pure logic such as
  money, charts, rule matching, split resolution, tax arithmetic, scanner core
  code, and Overview layout calculations.
- `src/lib/server/db/schema/` is split by domain and re-exported only through
  `schema/index.ts`. `drizzle/0000_baseline.sql` is generated from this schema
  plus the SQL assembled by `schema/baseline.ts`; never edit it by hand.
- `src/lib/modules/registry.ts` is the source of truth for module toggles,
  navigation areas, and route availability. `src/lib/overview/panels.ts` is
  the corresponding registry for Overview panels.
- `src/routes/api/v1/` is the read-only, bearer-token-authenticated API. API
  endpoints should reuse the same server queries as screens and serialize
  amounts through the shared API helpers.
- `src/lib/scan/core/` is deliberately independent of SvelteKit, `$app`, the
  database, and the server; preserve that boundary when changing scanning.

Capabilities are added behind seams rather than by editing screens: statement
formats implement the parsed-statement contract and are registered in
`src/lib/server/import/format.ts`; Home Assistant and calendar integrations
implement their provider interfaces; new briefing sources, calendar rules,
modules, API endpoints, and Overview panels follow the registries described in
`ARCHITECTURE.md`.

## Commands

Install dependencies and start the local development stack:

```sh
docker compose up -d db
cp .env.example .env
npm install
npm run dev
```

Use these checks before submitting changes:

```sh
npm run lint                 # ESLint, Prettier check, design-token check
npm run check                # SvelteKit sync plus strict svelte-check
npm test                     # all Vitest unit, acceptance, and integration tests
npm run build                # production build; prepares OpenCV assets first
```

Run a focused test by passing its file to Vitest, optionally with a test name:

```sh
npm test -- tests/unit/money-compact.test.ts
npm test -- tests/unit/money-compact.test.ts -t "formats zero"
npm test -- tests/integration/loan-mutations.test.ts
```

Useful repository-specific commands:

```sh
npm run test:where <term>    # find existing tests and the modules they cover
npm run test:index            # regenerate tests/COVERAGE.md after test moves/additions
npm run db:baseline           # regenerate drizzle/0000_baseline.sql after schema changes
npm run db:migrate            # apply the baseline to DATABASE_URL
npm run format                # apply Prettier
npm run version:check         # verify package/version references agree
```

Integration tests start isolated embedded PostgreSQL instances through
`tests/integration/harness.ts`. They use `scratch-workspace/`, which is ignored;
do not replace the harness with hand-written schema setup or fixed ports.

## Data and correctness rules

- Never commit real statements, payslips, account exports, or other financial
  data. Use `bank_data_examples_do_not_share/` for local-only samples. Committed
  fixtures under `tests/fixtures/` must be synthetic or anonymised.
- Represent money as integer minor units plus a currency code everywhere:
  database, domain functions, API, and tests. Use `bigint` for stored amounts;
  use `toMajor`/`fromMajor` for conversions and runtime currency metadata for
  minor digits. Never introduce floating-point monetary arithmetic or silently
  treat a missing exchange rate as one-to-one.
- Import is format-first and proof-gated. New readers must return the shared
  parsed model, provide positive format recognition, and pass
  `proveStatement`/`decideImport`; a new bank generally needs no adapter.
  Preserve reconciliation (`opening + rows = closing`) and centralised
  fingerprinting/deduplication.
- Domain mutations own the database transaction, lock parent/owner rows before
  dependent rows, and accept an injectable database handle so rollback and
  concurrency can be tested. Filesystem writes happen before database linking;
  PostgreSQL cannot roll them back.
- Schema changes require `npm run db:baseline`, relevant schema/invariant tests,
  and an `Upgrading` block in `CHANGELOG.md` describing the operator-run SQL
  for existing instances. Keep generated SQL out of hand edits.
- Authentication is centralised in `src/hooks.server.ts`. The hook performs
  boot/migrations, session validation, API bearer authentication, and route
  protection; do not add endpoint-specific bypasses casually. Public token
  routes are still authorised by their own token or ceremony checks.

## UI conventions

Read `docs/ui-guidelines.md` before changing interface code. The authority
order is code (`src/lib/styles/app.css`, shared components, and routes), then
the design handoff as rationale; `design_system/` is not the source of truth
for current values.

- Use design tokens from `app.css`; never add colour literals in components.
- Reuse `src/lib/components/` primitives before creating a component. Feature
  components belong beside their subsystem only when they travel with its own
  logic layer.
- Use `ScreenHeader`, `SummaryBand`, `ControlRow`, content, and sidebar in the
  standard screen order. Do not create ad hoc top-of-screen metric rows.
- Use inline SVG through the shared `Icon` component and the existing icon set;
  do not add an icon library, font, or CDN.
- The project forces Svelte runes mode: use `$props`, `$state`, and `$derived`,
  and render children as `Snippet`. Keep component CSS scoped.
- Use the token scales for type, spacing, radii, gaps, and shadows. The custom
  ESLint rules reject raw geometry/shadows and non-opaque floating surfaces.
  Every numeric figure should use the mono font/tabular numerals.
- Dark is the default theme; light is selected with
  `data-ledger-theme="light"`. Theme-specific values belong in tokens, not
  component branches. Check both themes for UI changes.
- Every `.ts` and `.svelte` file under `src/` needs the
  `// SPDX-License-Identifier: AGPL-3.0-or-later` header. ESLint can add it
  with `npm run lint -- --fix`.

## Tests and documentation

Pure logic belongs in `tests/unit` (or a colocated `src/**/*.test.ts`);
database behaviour, rollback, locking, and concurrency belong in
`tests/integration`; the committed statement corpus belongs in
`tests/acceptance`. There is no browser test suite. Do not add tests that
assert rendered markup or component source; extract a computation into a pure
function or domain module and test that behaviour instead.

Test files are named for behaviours, not necessarily implementation modules.
Use `npm run test:where <term>` before adding a file and extend the existing
behaviour-focused suite when appropriate. Integration rows should be created
with the builders in `tests/integration/fixtures.ts`, not hand-written inserts.
Update `tests/COVERAGE.md` with `npm run test:index` when adding or moving test
files.

Update `CHANGELOG.md` for user-visible changes and update `README.md` or
`ARCHITECTURE.md` when adding a setting, extension seam, supported format, or
other architectural behaviour. Follow `.github/PULL_REQUEST_TEMPLATE.md`,
especially its migration and data-safety sections. Security issues belong in
`SECURITY.md`, not public issues.
