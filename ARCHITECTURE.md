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

| Seam                    | Contract                                                                                          | Implementations                                                                   | Add one by                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Bank statement formats  | `ParsedStatement` via `detectAndParse` (`src/lib/server/import/detect.ts`)                        | Fio CSV, Revolut CSV, mBank CSV, RB PDF, ČS PDF                                   | new adapter in `import/adapters/` + a sniff rule in `detect.ts`                                       |
| Broker reports          | `src/lib/server/invest/xtb.ts` parse → idempotent ingest                                          | XTB XLSX                                                                          | sibling parser + ingest wiring                                                                        |
| Smart-home platforms    | `HomeProvider` (`src/lib/server/home/provider.ts`): probe / snapshot / setDevice / energyHistory  | Home Assistant (REST + WebSocket), Demo                                           | `registerHomeProvider(id, label, factory)` — settings UI and the Home screen pick it up automatically |
| Briefing strip          | `Source: () => Promise<BriefingItem[]>` (`src/lib/server/briefing.ts`)                            | unreviewed imports, lease expiry, fixation horizon, document expiry, overspend    | append to `SOURCES`                                                                                   |
| Ledger calendar events  | rule generators in `src/lib/server/calendar.ts`, individually switchable                          | import reminder, loan payments, property dates, quarterly report, expiry          | new block in `generateEvents` + `CALENDAR_RULES` entry                                                |
| Categorisation rules    | `Condition` types + pure `decideWithRules` (`src/lib/rules/match.ts`)                             | counterparty/description contains, counter-account, variable symbol, amount range | new variant in `Condition` + a branch in `conditionHolds()`                                           |
| Read-only API           | `requireToken` + `json()` (`src/lib/server/api/respond.ts`); endpoints reuse the screens' queries | accounts, transactions, categories, tags, networth, cashflow under `/api/v1`      | new `+server.ts` under `src/routes/api/v1/` calling the same server function its screen calls         |
| FX rates                | `src/lib/server/fx` (currently CNB daily fixing, CZK-anchored)                                    | CNB                                                                               | replace `refreshRates`; the rate table and conversion API stay                                        |
| Modules / screens       | registry in `src/lib/modules/registry.ts` drives the sidebar and route guards                     | 9 modules                                                                         | add a nav item + module key; Settings toggle appears automatically                                    |
| External calendar feeds | _(planned)_ `CalendarFeed` providers alongside the ledger's own events                            | —                                                                                 | Google / iCal two-way sync will be the first implementations                                          |

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
- **Splits**: a transaction divided between categories keeps its lines summing
  exactly to the parent, same sign, at least two — enforced in one write path
  (`saveSplits`). Every consumer resolves through one pure function,
  `effectiveLines` (`src/lib/transactions/lines.ts`), so the "is it split?"
  branch exists once; splitting nulls the parent category so a consumer that
  ever forgot the branch would report "unfiled" loudly rather than a stale
  category silently.
- **Rule confidence**: a rule's standing is the Wilson lower bound on its
  accepted/corrected record — conservative at low counts, never certain.
  Seeded and learned rules start from a prior that clears the auto-file
  threshold and drops below it after a single correction; a unit test pins
  that pair so tuning either number cannot silently stop rules from filing.
  Only an explicit confirmation counts as acceptance — silence is not consent.
- **Money over the wire**: `/api/v1` sends every amount as integer minor units
  plus a currency code, through one `money()` helper that throws on the safe
  integer boundary instead of rounding. Never floats, never formatted strings.
- **Entity links**: a document always belongs to records — people, flats,
  brokerage accounts, or `subject` rows (household, car, …) — through typed
  join tables. There is no free-text subject anywhere, so a rename follows
  every document and a typo cannot mint a phantom column; catch-all subjects
  are case-insensitively unique.

## Authentication

Two ways in, converging on one session. A password sign-in and a passkey
sign-in both end at `createSession`, so everything downstream — the session
cookie, `validateSession`, `locals.person` — is unaware of which was used.

- **Passwords** are Argon2 hashes on `person`. The column is nullable: a person
  created by an administrator has no password until they open their enrollment
  link and choose one, and `verifyPassword` returns false on a null hash rather
  than throwing.
- **Passkeys** are WebAuthn credentials in `credential`, one row per registered
  device. They are registered as discoverable, so the sign-in screen needs no
  person picker — the authenticator returns the person ID in its user handle.
  The relying-party ID is derived from `ORIGIN` rather than configured, which
  makes the classic origin/RP-ID mismatch impossible. Where `ORIGIN` is not a
  secure context the passkey interface is absent, not broken.
- **Signature counters** are compared only when both the stored and incoming
  value are non-zero. Synced passkeys always report zero, so a naive
  monotonicity check would reject every Apple credential on its second use.
  `webauthn/counter.ts` holds the rule and a unit test pins it.
- **Enrollment tokens**, **sessions** and **API tokens** all store only a
  sha256 of the value; the raw token is shown once and never persisted.
- **Permissions** live in `auth/policy.ts` as pure functions, so the
  last-administrator invariant is tested without a database and cannot drift
  between call sites. `person.role` is exactly `admin` or `member`.
- **Deactivation** sets `deactivated_at` and drops live sessions, leaving
  credentials and password intact so reactivation is an undo. People are never
  deleted — six tables reference them.

## Where things live

- `src/lib/server/` — everything with database or network access
- `src/lib/` (rest) — pure, client-safe logic (money, charts, retirement
  model, rule matching, split resolution, tax arithmetic), unit-testable
  without a database
- `src/routes/api/v1/` — the read-only JSON API, bearer-token authed, versioned
  in the path so a v2 can exist beside it
- `drizzle/` — migrations, run automatically at boot; data backfills live
  inside the migration files, before the column drops they replace
- `docs/superpowers/` — the specs and implementation plans each feature was
  built from, including what was deliberately deferred
- `tests/unit` — pure logic; `tests/acceptance` — real files, self-skipping;
  `tests/e2e` — one ordered Playwright journey against a reset database
