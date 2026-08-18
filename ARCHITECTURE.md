# Architecture

Continuum is a single SvelteKit (Svelte 5, TypeScript strict) application over
PostgreSQL via Drizzle, shipped as a two-container docker-compose stack.
Money is integer minor units + a currency code everywhere; stored amounts are
never re-denominated. Aggregates convert each operand with the newest rate on
or before its effective date; a missing historical rate is an explicit
approximation, never a future rate or a silent one-to-one conversion.

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

| Seam                   | Contract                                                                                                             | Implementations                                                                   | Add one by                                                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Bank statement formats | `ParsedStatement` via `detectAndParse` (`src/lib/server/import/detect.ts`)                                           | Fio CSV, Revolut CSV, mBank CSV, RB PDF, ČS PDF                                   | new adapter in `import/adapters/` + a sniff rule in `detect.ts`                                                       |
| Broker reports         | `src/lib/server/invest/xtb.ts` parse → idempotent ingest                                                             | XTB XLSX                                                                          | sibling parser + ingest wiring                                                                                        |
| Smart-home platforms   | `HomeProvider` (`src/lib/server/home/provider.ts`): probe / snapshot / setDevice / energyHistory                     | Home Assistant (REST + WebSocket), Demo                                           | `registerHomeProvider(id, label, factory)` — settings UI and the Home screen pick it up automatically                 |
| Briefing strip         | `Source: () => Promise<BriefingItem[]>` (`src/lib/server/briefing.ts`)                                               | unreviewed imports, lease expiry, fixation horizon, document expiry, overspend    | append to `SOURCES`                                                                                                   |
| Ledger calendar events | rule generators in `src/lib/server/calendar.ts`, individually switchable                                             | import reminder, loan payments, property dates, quarterly report, expiry          | new block in `generateEvents` + `CALENDAR_RULES` entry                                                                |
| Categorisation rules   | `Condition` types + pure `decideWithRules` (`src/lib/rules/match.ts`)                                                | counterparty/description contains, counter-account, variable symbol, amount range | new variant in `Condition` + a branch in `conditionHolds()`                                                           |
| Read-only API          | `requireToken` + `json()` (`src/lib/server/api/respond.ts`); endpoints reuse the screens' queries                    | accounts, transactions, categories, tags, networth, cashflow under `/api/v1`      | new `+server.ts` under `src/routes/api/v1/` calling the same server function its screen calls                         |
| FX rates               | `src/lib/server/fx` (currently CNB daily fixing, CZK-anchored)                                                       | CNB                                                                               | replace `refreshRates`; the rate table and conversion API stay                                                        |
| Modules / screens      | registry in `src/lib/modules/registry.ts`: `AREAS` drives the sidebar and sub-tabs, `pathDisabled` guards the routes | 9 modules across 7 areas                                                          | add a screen to an area + a module key; Settings toggle and sub-tab appear automatically                              |
| Overview panels        | registry in `src/lib/overview/panels.ts` (key, default and minimum size, required modules)                           | 13 panels                                                                         | one registry entry + a component in `src/lib/overview/panels/` + a builder in `src/lib/server/overview.ts`            |
| Calendar providers     | `CalendarProvider` (`src/lib/server/calendar/sync/provider.ts`): probe / listCalendars / pull / push                 | iCloud (CalDAV), Google Calendar                                                  | `registerCalendarProvider(id, label, factory, fields, hint, oauth)` — the Settings panel renders itself from `fields` |

## Correctness anchors

- **Import identity and dedup**: account resolution is exact across bank,
  currency and canonical account-number identity. The selected account, import
  record, transactions, counters, closing balance and deterministic
  post-processing commit in one database transaction. `transaction (accountId,
dedupFingerprint)` is unique; fingerprints prefer the bank's own reference,
  are versioned (`fingerprintVersion`), and aliases preserve dedup across
  repaired historical representations. Every original statement file is
  stored on the data volume — a parser change re-parses history instead of
  asking for seven years of exports again.
- **Transfers**: only hard evidence (the counter-account provably naming the
  other own account) pairs automatically; everything weaker is a held proposal
  that stays inside the figures until confirmed. Pairing takes a
  transaction-scoped advisory lock before transaction rows, and
  `transfer_pair_leg` gives each active leg one owner. Confirmed, filed or split
  movements are human-owned and automatic replay cannot overwrite them.
- **Loans**: interest is booked per fixation period; rate, payment, day-count
  convention and accrual style are per-loan data, verified to the haléř
  against real Česká spořitelna statements.
- **Reconciliation**: parsers must reproduce each statement's own
  opening + rows = closing; the acceptance suite enforces this against real
  files when they are present locally (never in CI).
- **Splits**: a transaction divided between categories keeps its lines summing
  exactly to the parent, same sign, at least two — enforced in one write path
  (`saveSplits`), which is one database transaction with the parent row locked
  for its duration. Lines are matched to the rows they came from by id rather
  than by position, so a split-level tag stays with its line when another line
  is removed. In-memory consumers resolve through `effectiveLines`
  (`src/lib/transactions/lines.ts`); register filtering/counting/totals use one
  equivalent database-side effective-line relation so they do not materialise
  the whole ledger. Splitting nulls the parent category, making an omitted split
  branch fail visibly as "unfiled" instead of silently using a stale category.
- **Rule confidence**: a rule's standing is the Wilson lower bound on its
  accepted/corrected record — conservative at low counts, never certain. A
  learned rule starts from a prior that clears the auto-file threshold and
  drops below it after a single correction; a unit test pins that pair so
  tuning either number cannot silently stop rules from filing. Only an explicit
  confirmation counts as acceptance — silence is not consent.
- **No starter rules**: an install begins with the category taxonomy and
  nothing else. Every rule is earned from a correction someone made, which is
  what the confidence score claims to measure. The 42 curated Czech/Polish
  merchant patterns that used to ship were wrong in both directions — dead
  weight for a household that shops elsewhere, and, because seeding ran on
  every boot, a deleted one came back at the next restart.
- **Money over the wire**: `/api/v1` sends every amount as integer minor units
  plus a currency code, through one `money()` helper that throws on the safe
  integer boundary instead of rounding. Never floats, never formatted strings.
- **Minor units**: how many a currency has comes from the runtime's own CLDR
  data (`minorDigits`), not a table — HUF, JPY, KRW and ISK have none, KWD and
  BHD have three. Every crossing between minor units and a plain number goes
  through `toMajor` / `fromMajor`; a hardcoded hundred anywhere is a bug waiting
  for the first household that keeps money in one of those currencies.
- **Exchange rates**: a missing rate is never silently treated as one-to-one.
  One preloaded rate table selects the latest fixing on or before the value
  date. Conversion returns null for "unknown", callers preserve the major-unit
  magnitude through a named helper, and the app layout names every source or
  target currency being shown that way — the figure is allowed to be
  approximate, never quietly wrong. Legacy monetary settings store their
  authored currency so changing the household base cannot reinterpret them.
- **Rules and tags**: amount rules carry their authored currency and compare
  only like-dimensional transaction values. A rule definition, its tags and
  replay are one transaction. Tag replacement locks the owning record; totals
  use direct and split scope without duplication and omit paired own-account
  transfers just like the register they link to.
- **Broker freshness**: `broker_import_state` records the newest accepted
  report independently of current holdings. A newer zero-holding report is
  still authoritative, and a stale or partial report cannot regress holdings,
  snapshots or aggregated closed positions.
- **Revisioned settings**: high-frequency autosave data stores a global
  optimistic version and a per-page-writer revision. The first prevents a stale
  browser tab overwriting another tab; the second orders an ordinary request
  against its page-exit keepalive and makes exact retries idempotent.
- **Entity links**: a document always belongs to records — people, flats,
  brokerage accounts, or `subject` rows (household, car, …) — through typed
  join tables. There is no free-text subject anywhere, so a rename follows
  every document and a typo cannot mint a phantom column; catch-all subjects
  are case-insensitively unique.
- **Calendar identity**: every event has a stable key on both sides. Authored
  events keep a UUID; generated events derive one from what produced them
  (`gen:{rule}:{table}:{row}:{field}:{month}`), because they have no row and are
  recomputed each request. The remote id is a deterministic encoding of that
  key, so `calendar_sync_link` is a cache rather than the source of truth —
  losing it triggers a reconcile that re-attaches, instead of a second copy of
  every event on someone's phone. The published `.ics` feed uses the same keys;
  it used to number UIDs by array position, so adding a loan renumbered every
  later event on that day.
- **Calendar merge**: the three-way merge is a pure function of
  `(base, local, remote)` with no network, database or clock, where `base` is
  the content we last successfully sent. Everything genuinely risky about
  two-way sync is decided there and is exhaustively table-tested offline. The
  content hash strips the marker and source tag we add on the way out —
  decoration reaching the hash makes every event compare as changed on every
  pass, and the resulting push loop is silent, surfacing as rate-limit
  exhaustion rather than an error. It does _not_ strip an emoji the author
  typed: that is content, and stripping it would make a rename hash identically
  and never sync.
- **Calendar convergence**: two invariants hold under any interleaving of local
  and remote edits — nothing is duplicated, and nothing deleted ever comes back.
  Both are pinned by a randomised convergence test against an in-memory
  provider. Deletions are tombstones rather than removed rows, because sync must
  tell "deleted here, push it" from "never existed"; tombstones are reaped once
  no link references them. A generated event deleted remotely is _suppressed_
  rather than re-created — the ledger does not overrule a deliberate act.
- **Calendar write-back**: a remote date move may write exactly four ledger
  fields — `loan.paymentDay`, `tenancy.endDate`, `tenancy.renewalNoticeDate`,
  `document.expiresOn` — and nothing else. `loanFixationPeriod.endDate` has a
  row and is deliberately excluded: moving it re-cuts the interest schedule,
  which is not what dragging a calendar event means. `paymentDay` is a
  day-of-month, so moving one month moves every month; that is applied and
  announced rather than silently done. Every write-back is recorded and
  surfaced in the briefing.

## Write boundaries

Page-server actions parse and validate transport data, then delegate coherent
multi-row changes to modules under `src/lib/server/<domain>/` (or a focused
server module such as `rule-mutations.ts`). The domain function owns the
transaction, locks its parent/owner before reading dependent state, and accepts
an injectable database handle so rollback and interleaving behavior can be
tested directly. Rules, tags, splits, loans, documents, property and import all
follow this boundary.

Global locks are acquired before owner rows, and owner rows before dependent
rows. The transfer-pairing advisory lock is the outermost lock for any mutation
that replays categorisation, preventing a filer and a rule edit from taking the
same locks in opposite order. Database constraints remain the final guard for
one-owner invariants such as active transfer legs and a property's meter bill.

Filesystem uploads cannot join a PostgreSQL transaction. Routes therefore save
the file first and perform all database links in one transaction, so rollback
can leave an unreferenced file but never a partly linked financial record.
Replaceable property media removes a rejected new file; statement import
deliberately retains and logs its original when preserving the only uploaded
copy is safer than deleting it.

## Authentication

Two ways in, converging on one generation-conditional session grant. A password
sign-in and a passkey sign-in both capture `person.authGeneration`; the session
row is created only if that generation is still current and the person remains
active. Everything downstream — the session cookie, `validateSession`,
`locals.person` — is unaware of which credential was used.

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
- **WebAuthn challenges** are recorded in `webauthn_challenge` when issued and
  deleted when spent, so a verification that spends nothing is refused. Public
  issuance has its own rate budget, expired rows are indexed for cleanup, and
  stored challenge counts are bounded. The cookie carries the value back from
  the browser but is not the record of it: SvelteKit does not sign cookies, so a
  challenge held only there is whatever the caller says it is.
- **Authentication generations** invalidate a ceremony that began before a
  password change or deactivation. Session, credential and positive-counter
  writes all compare the captured generation and active state in the same SQL
  statement. Enrollment consumes its token, writes the password and creates
  the session in one transaction.
- **Enrollment tokens**, **sessions**, **API tokens** and challenges all store
  only a sha256 of the value; the raw token is shown once and never persisted.
- **Changing a password revokes every other way in** — other sessions and every
  registered passkey. Enrolling a passkey needs only a live session, so one
  enrolled from a stolen cookie would otherwise outlive the remedy.
- **Rate limiting** is per scope and per subject, not per address alone
  (`auth/ratelimit.ts`). Sign-in attempts combine account and address budgets;
  unknown identifiers share bounded state. API tokens, enrollment and public
  passkey challenges keep separate budgets — behind a reverse proxy or
  Tailscale the whole household may share one address, so an address-only
  budget lets any caller shut everyone out. Set `ADDRESS_HEADER`/`XFF_DEPTH`
  only where a trusted proxy chain is the only way in.
- **API authentication** is applied once by the SvelteKit hook to the complete
  `/api/v1` boundary. A newly added endpoint therefore fails closed before its
  handler runs; endpoint files only format domain results.
- **Initial setup** is guarded by a singleton row claimed in the same
  transaction that creates the household. Losing concurrent requests do no
  password hashing, and one request can initialise at most twenty people.
- **Permissions** live in `auth/policy.ts` as pure functions, so the
  last-administrator invariant is tested without a database and cannot drift
  between call sites. `person.role` is exactly `admin` or `member`.
- **Deactivation** sets `deactivated_at` and drops live sessions, leaving
  credentials and password intact so reactivation is an undo. People are never
  deleted — six tables reference them.

## Where things live

- `src/lib/server/` — everything with database or network access
- `src/lib/` (rest) — pure, client-safe logic (money, charts, retirement
  model, rule matching, split resolution, tax arithmetic, the Overview grid),
  unit-testable without a database
- `src/lib/icons.ts` — the icon set as SVG primitives, rendered by
  `Icon.svelte`. Authored data rather than a library or a font: nothing here
  may require a network fetch to draw. Screens and areas name their icon in the
  module registry, so no page passes one
- `src/lib/overview/` — the Overview board: `layout.ts` holds every spatial
  rule as pure functions, `panels.ts` is the registry, and the components know
  nothing about the grid they sit on. Each person's arrangement is a jsonb
  column on `person`, saved on discrete gestures and re-validated server-side
- `src/lib/errors/` — what each error screen says, as data. `states.ts` maps a
  status to a screen and falls back by class, so a status nobody wrote a page
  for still renders something a person can act on; `artwork.ts` points each one
  at its drawing in `static/error-pages/`, used as a luminance mask over the
  state's own colour so one file serves both themes.
  One `+error.svelte` at the route root catches everything, including failures
  in a layout's own load, which cannot be rendered inside that layout.
  `handleError` in `hooks.server.ts` is the boundary between the two: the stack
  goes to the log, the browser gets a reference to it and nothing more — a stack
  can name file paths and, in a query, real figures
- `src/routes/api/v1/` — the read-only JSON API, bearer-token authed, versioned
  in the path so a v2 can exist beside it
- `drizzle/` — migrations, run automatically at boot; data backfills live
  inside the migration files, before the column drops they replace
- `docs/superpowers/` — the specs and implementation plans each feature was
  built from, including what was deliberately deferred
- `tests/unit` — pure logic; `tests/acceptance` — real files, self-skipping;
  `tests/integration` — isolated embedded-PostgreSQL rollback and concurrency
  cases; `tests/e2e` — one ordered Playwright journey against a reset database
