# Architecture

Continuum is a single SvelteKit (Svelte 5, TypeScript strict) application over
PostgreSQL via Drizzle, shipped as a two-container docker-compose stack.
Money is integer minor units + a currency code everywhere; stored amounts are
never re-denominated — only screen-level totals convert, at the day's rate.

## The two rules everything follows

1. **Nothing variable is hard-coded.** A constant is allowed only for facts
   about a file format or arithmetic. Anything a bank, household or taste
   could disagree with is either derived from data or a setting (day-count
   conventions per loan, currencies from the FX table, module toggles,
   calendar rules).
2. **Capabilities live behind seams.** Screens talk to interfaces; platforms
   and formats are pluggable implementations. Adding support for something
   new means writing an adapter, never editing screens.

## Extension seams

| Seam                    | Contract                                                                                         | Implementations                                                                | Add one by                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Bank statement formats  | `ParsedStatement` via `detectAndParse` (`src/lib/server/import/detect.ts`)                       | Fio CSV, Revolut CSV, mBank CSV, RB PDF, ČS PDF                                | new adapter in `import/adapters/` + a sniff rule in `detect.ts`                                       |
| Broker reports          | `src/lib/server/invest/xtb.ts` parse → idempotent ingest                                         | XTB XLSX                                                                       | sibling parser + ingest wiring                                                                        |
| Smart-home platforms    | `HomeProvider` (`src/lib/server/home/provider.ts`): probe / snapshot / setDevice / energyHistory | Home Assistant (REST + WebSocket), Demo                                        | `registerHomeProvider(id, label, factory)` — settings UI and the Home screen pick it up automatically |
| Briefing strip          | `Source: () => Promise<BriefingItem[]>` (`src/lib/server/briefing.ts`)                           | unreviewed imports, lease expiry, fixation horizon, document expiry, overspend | append to `SOURCES`                                                                                   |
| Ledger calendar events  | rule generators in `src/lib/server/calendar.ts`, individually switchable                         | import reminder, loan payments, property dates, quarterly report, expiry       | new block in `generateEvents` + `CALENDAR_RULES` entry                                                |
| Category matching       | `RuleLike` matchers in `src/lib/server/categorize`                                               | counterparty text, counter-account, variable symbol                            | new `matcherType` in `decide()`                                                                       |
| FX rates                | `src/lib/server/fx` (currently CNB daily fixing, CZK-anchored)                                   | CNB                                                                            | replace `refreshRates`; the rate table and conversion API stay                                        |
| Modules / screens       | registry in `src/lib/modules/registry.ts` drives the sidebar and route guards                    | 8 modules                                                                      | add a nav item + module key; Settings toggle appears automatically                                    |
| External calendar feeds | _(planned)_ `CalendarFeed` providers alongside the ledger's own events                           | —                                                                              | Google / iCal two-way sync will be the first implementations                                          |

## Correctness anchors

- **Dedup**: `transaction (accountId, dedupFingerprint)` is unique;
  fingerprints prefer the bank's own reference, are versioned
  (`fingerprintVersion`), and every original statement file is stored on the
  data volume — a parser change re-parses history instead of asking for
  seven years of exports again.
- **Transfers**: only hard evidence (the counter-account provably naming the
  other own account) pairs automatically; everything weaker is a held
  proposal that stays inside the figures until confirmed.
- **Loans**: interest is booked per fixation period; rate, payment, day-count
  convention and accrual style are per-loan data, verified to the haléř
  against real Česká spořitelna statements.
- **Reconciliation**: parsers must reproduce each statement's own
  opening + rows = closing; the acceptance suite enforces this against real
  files when they are present locally (never in CI).

## Where things live

- `src/lib/server/` — everything with database or network access
- `src/lib/` (rest) — pure, client-safe logic (money, charts, retirement
  model), unit-testable without a database
- `drizzle/` — migrations, run automatically at boot
- `tests/unit` — pure logic; `tests/acceptance` — real files, self-skipping;
  `tests/e2e` — Playwright journeys against a reset database
