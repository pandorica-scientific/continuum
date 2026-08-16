# Changelog

## 0.3.5 — 2026-08-16

The Overview stops being a screen somebody else designed and becomes a board
you build. Drag the panels where you want them, resize them, add the ones you
care about and remove the ones you don't — and because the arrangement belongs
to your profile rather than the browser, two people sharing an install no
longer share a dashboard.

**Upgrading:** migration `0034` runs automatically and adds one nullable column
to `person`. Nothing is rewritten and no existing data is touched. As with
every database release, take a backup before replacing the image.

**Nobody's screen changes on upgrade.** The default arrangement is the previous
Overview exactly — the attention strip full width, the waterfall beneath it,
then net-worth composition and the next thirty days side by side. The board
arrives when you press **Customise**, not when you upgrade.

### Added

- **The Overview is a twelve-column board you arrange yourself.** Drag a panel
  by its body to move it, drag the corner to resize it in columns and rows, ✕
  to remove it, and an **Add a panel** tray for everything not currently
  placed. **Reset to default** puts it back. The board has gravity: move a
  panel away and everything below rises to close the space, so the arrangement
  never keeps an empty band in the middle of it.
- **Thirteen panels.** The four from the old screen — Needs you, Where the
  money goes, What it is made of, Next 30 days — plus Net worth over time,
  Where the cash sits, Flats against mortgages, Energy this month, Portfolio,
  Retirement outlook, Tax position, Recent activity, and Saved each month.
  Panels belonging to a switched-off module are not offered.
- **The board follows you, not your browser.** Each person's arrangement is
  stored against their own profile. It is not a setting, does not appear in
  Settings, and is not part of the configuration export.
- **A narrow screen stacks the board into one column** and swaps resizing for
  move-up and move-down. There is only one arrangement, so reordering on a
  phone does change how the board looks on a wider screen — the screen says so
  while you are editing rather than letting you discover it later.

- **The sidebar lists seven areas instead of twelve screens.** Overview, Money,
  Assets, Retirement, Home, Calendar and Admin; the screens inside an area
  appear as a row of tabs under the page title. Twelve items in one column had
  stopped being legible, and the app now has eighteen screens rather than
  twelve. Money holds Cash flow, Accounts, Transactions, Tax, Import, Rules and
  Tags; Assets holds Property, Investments and Loans. Home and Calendar are
  their own rows rather than one Household area, so the calendar stays one
  click away.
- **A quick-add button on every screen** — bottom right, straight to statement
  import.
- **Drawn icons in place of emoji** in the sidebar, the screen titles and the
  header buttons. They are inline SVG in the bundle, not a font and not a
  fetch, because this is a package people self-host and it should not depend on
  a CDN to render its own navigation. Emoji stay where they read as content
  rather than furniture: the attention cards, account rows and the Settings
  module list.

### Changed

- **The cash-flow waterfall scales to fit instead of scrolling.** It was a
  fixed 592-pixel box that scrolled sideways below 880 pixels, which cannot
  work when the panel holding it can be resized to a quarter of the board. It
  now lays out once and scales into whatever room it is given, labels and all.
  Below about half width the leaf labels do get genuinely small; that is a
  known limit rather than a defect.
- **A panel's data is only computed when the panel is on your board.** Loading
  thirteen panels' worth of queries on every visit would have been a real
  regression from the four the fixed screen ran, so the loader builds exactly
  what is being shown.
- **The retirement projection's inputs moved into
  `src/lib/server/retirement.ts`**, shared by the Retirement screen and the new
  panel. Two copies of a forty-year amortisation drifting apart was not a risk
  worth taking for one small panel.

### Fixed

- **The Overview offered a link to a switched-off Calendar.** The "Next 30
  days" card rendered regardless of the module, and its "Open calendar" link
  led to a 404 whenever Calendar was off. The panel is now gated on the module
  like every other module-owned panel, and disappears with it.
- **Every screen offered an "Import statement" button with the Import module
  switched off**, which led to the same kind of 404. Both that button and the
  new quick-add button now go with their module.
- **A panel that could not load took the whole Overview down with it.** The
  energy panel reaches Home Assistant over the network, so an unreachable box
  turned the entire screen into an error — and because a panel's placement is
  saved, it stayed that way. A panel that fails now says so in its own box and
  the rest of the board carries on.
- **Switching two panel-owning modules off left a band of empty space** at the
  top of the board instead of closing it.
- **The cash-flow waterfall stopped at 880 pixels** and left the rest of a wider
  card empty. It fills the space again above that width and scales down below
  it.

## 0.3.4 — 2026-08-15

A pass over the first-run experience: the setup wizard, what a fresh install
starts with, and the controls that had kept their browser defaults.

**Upgrading:** migration `0033` runs automatically and retires the shipped
starter rules — the ones nobody ever accepted or corrected are removed, and any
that did earn a record are kept and relabelled as learned. As with every
database release, take a backup before replacing the image.

### Fixed

- **The setup wizard showed one module with no name, and threw away everything
  typed when it refused a submission.** The wizard kept its own list of module
  labels beside the registry, so Tax — added to the registry later — rendered as
  a bare checkbox; labels now come from the registry itself and cannot drift
  again. A rejected submission re-renders with the household name, currency,
  people, birth years and module choices intact. Passwords are deliberately not
  restored: echoing one would write it into the response HTML.
- **A file field's "Choose File" button ignored the theme.** The browser draws
  that button itself, so it kept its platform default — a light grey chip inside
  a dark card on the payslip, document, bill and restore forms. It now takes the
  same look as every other control, from one rule in the shared stylesheet.
- **Nothing explained why passkeys were missing on a plain-HTTP deployment.**
  The whole section was hidden without a word, which reads as a build that has
  no passkeys at all. Settings now says that browsers refuse WebAuthn outside a
  secure context, names the `ORIGIN` actually in force, and — for an
  administrator, who is the only person who can act on it — gives the three
  steps that turn passkeys on: authenticate the Tailscale sidecar, put the name
  it issues in `.env`, restart. A member is told an administrator can do it
  rather than being handed shell commands.

### Changed

- **The Tailscale sidecar now runs by default.** It was behind a compose
  profile, so the out-of-the-box install was plain HTTP and therefore had no
  passkeys — the feature was present but unreachable unless you already knew to
  ask for it. `docker compose up -d` now brings it up alongside the app. It
  stays tailnet-only; `tailscale funnel`, the command that would publish to the
  open internet, is still run nowhere. Without `TS_AUTHKEY` the sidecar idles
  and prints a login URL to its logs rather than failing, so an install that
  never authenticates it behaves exactly as it did before. Naming the two
  services (`app db`) on the `up` command leaves it out entirely.
- **An install no longer ships 42 starter rules.** A fresh household begins with
  the category taxonomy and no rules at all; every rule is earned from a
  correction someone actually made, which is what the confidence score claims to
  measure. The curated Czech/Polish merchant patterns were wrong in both
  directions — dead weight for a household that shops elsewhere, and, because
  seeding ran on every boot, a starter rule you deleted came back at the next
  restart. The first import of a new install now sends more rows to the review
  queue, and filing them is what teaches the rules.

## 0.3.3 — 2026-08-15

A full correctness and simplification pass over the paths that move money or
credentials. This release closes races that only appeared when two requests
arrived together, makes multi-row changes commit as one unit, and replaces
repeated route code with shared domain mutations and interaction helpers.

**Upgrading:** migrations `0027`–`0032` run automatically. They repair legacy
transaction fingerprints and transfer claims, add authentication-concurrency
guards and broker-report freshness state, enforce one smart-meter bill per
property, and bind legacy monetary settings and the meter to explicit
currencies/properties. The fingerprint repair deliberately reconciles old
duplicates while preserving their categories, splits, tags and linked events.
If the household has more than one lived-in property, migration `0032` binds an
existing home integration to the oldest one; open Home settings once and
confirm that target. As with every database release, take a backup
before replacing the image.

### Fixed

- **Overlapping or simultaneous statement imports could create duplicate
  accounts and transactions.** Account identity is now exact, bank-aware and
  serialised; an explicit account choice learns a compatible statement number,
  closing balances move forward in time only, and the import record, rows,
  counters and post-processing commit together or not at all.
- **Old fingerprints could disagree with the current parser.** The forward
  repair handles the version-1 Revolut fee representation, version-2 minor-unit
  rescaling and collisions with already-current rows one occurrence at a time.
  It also repairs existing transfer claims without deleting a genuine repeated
  movement.
- **Transfer pairing still had timing holes.** Pairing now takes one global
  transaction lock before row locks, waits for ordinary edits, sees the other
  side of concurrent imports, works for historical statements, and never
  overwrites a transaction a person has already filed or split. Confirm and
  reject update the pair and both legs atomically.
- **The transaction register and its totals could disagree.** One database-side
  effective-line relation now owns category, uncategorised, direct-tag,
  split-tag and fee semantics. Counts and per-currency totals remain correct
  beyond one page, and amount bounds are converted to the household currency at
  the transaction date.
- **Split and tag edits could leave partial or contradictory state.** Duplicate
  split identifiers are rejected, save/delete operations lock the parent, line
  tags save in the same transaction, and concurrent tag additions are resolved
  under an owner lock instead of silently dropping one another.
- **Several cross-currency figures mixed raw minor units.** Property equity and
  rent, loan allocation, account charts, retirement income, tax series,
  investment history, tag totals and net-worth deltas now convert each operand
  at its effective date. A day before the first stored fixing converts at the
  oldest rate on record — the CNB publishes forward and only today's fixing is
  ever fetched, so those days can never gain one of their own — and a currency
  with no fixing at all still falls back to major-unit face value. Both are
  labelled by a banner covering every converted source and target currency.
- **Broker reports could replay stale holdings or closed positions.** Import
  freshness is stored independently of the current holdings, so a newer empty
  report stays authoritative and an older same-day or partial report cannot
  resurrect or regress positions.
- **Loan actions accepted impossible chronology and inconsistent balances.** A
  repayment cannot increase or overpay debt, occur before the agreement/current
  balance or in the future. Creation and re-fixation validate dates, rates,
  payments, agreement bounds and secured-property shares before one atomic
  write replaces the affected schedule.
- **Property figures and edits could lose data.** Every active linked loan is
  included, only the deterministic tenancy active today contributes rent,
  overlapping tenancies are serialised, and concurrent image/floor-plan updates
  merge under a property lock. Invalid or ambiguous secured shares are refused
  instead of duplicating debt between properties.
- **A shared mortgage could report one minor unit more debt than it carries.**
  Each property's share used to be rounded on its own, so a 50/50 split of an
  odd balance rounded up on both sides. Shares are now allocated as the gap
  between cumulative boundaries over a loan's whole secured set, in a fixed
  order, so the parts always sum to the loan itself. A secured share is also
  validated with the one grammar the property page reads back, rejecting
  precision the `numeric(6,3)` column would silently round away.
- **A tag on a transfer leg totalled zero.** Tag totals excluded any
  transaction pairing had marked a transfer, so a tag put on the outgoing leg of
  a move — money set aside — reported nothing while the register still showed the
  chip on that row. A tag is a filing decision and now counts wherever it is put.
- **The month-on-month net-worth delta could vanish or measure the wrong
  period.** The baseline is the last snapshot before the month began, falling
  back to the oldest on record, rather than the first snapshot inside the month:
  the figure no longer disappears on the 1st, nor silently measures only the days
  since the container last ran.
- **Backfilling an older broker report recorded no value point.** The report's
  own day is written whatever its age — `portfolio_snapshot` is keyed by day, so
  an archived report cannot collide with the current one — while holdings and
  freshness still follow the newest report only.
- **Saving a re-fixation destroyed later agreed periods.** A follow-on fixation
  the bank had already committed to is preserved; a blank end date runs until
  that period begins instead of silently becoming the loan's maturity date, and
  an explicit end that would span a committed period is refused rather than
  deleting it. The dialog preview shows the same schedule the save writes.
- **Non-Czech accounts never matched their own IBAN.** Account comparison fell
  back to a Czech-only reading, so a Polish or Revolut account written one way in
  a statement and another in the ledger looked like two accounts: own transfers
  stopped pairing and an import could mint a duplicate account. Czech references
  keep their structural rule; elsewhere the national number and the IBAN body are
  compared directly.
- **Filing one transaction scanned the whole ledger.** A pairing pass is bounded
  to the days around whatever changed, rather than row-locking and comparing every
  unpaired transaction on every filing, import, rule edit and transfer decision.
  Unlike the horizon this replaces, the bound follows the rows, so historical
  statements still pair.
- **One out-of-range retirement assumption stopped the page saving anything.**
  Refusals now name the assumption at fault, and the form carries the same bounds
  the save enforces, so an age left below the minimum no longer refused every
  later edit to spending or growth behind one generic line.
- **Importing a configuration file could be undone by an open tab.** An imported
  retirement payload takes a version above whatever is stored, so a tab loaded
  before the import gets a visible conflict rather than silently replacing the
  file — or being refused forever.
- **An account chosen for one upload was applied to the next.** The import
  screen's account choice is cleared once no file is still waiting on an answer,
  so a later unrelated statement is detected normally instead of being refused
  against the previous batch's account.
- **Smart-meter sync could target the wrong flat, wrong bill or stale
  configuration.** The selected property and meter bill are explicit and
  database-enforced. A delayed provider response is discarded if the
  configuration changed while it was in flight, and switching the meter source
  cannot race an hourly update.
- **Documents, property bills, tax statements and rule edits used several
  commits for one action.** Their database rows, links and tags now use shared
  transactional mutations with rollback coverage. Rule replacement, tags and
  replay also follow the same lock order as transaction filing.
- **Retirement autosave could persist an older request last or silently ignore
  another tab.** Each page writer now carries an ordered revision plus a shared
  optimistic version; stale writes return a visible conflict, while unload
  retries of the same snapshot remain idempotent.
- **Form and upload failures were hidden behind dialogs or discarded local
  state.** Shared action-result and upload helpers now keep drafts open, show
  errors inside the active dialog and refresh page data only after success.
  Property, import, investment, home-device, split, tax, rule and loan flows all
  use the same behavior.
- **Keyboard and assistive-technology users could still reach hidden UI.**
  Modals, the lightbox and the mobile drawer now move and contain focus, restore
  it on close, announce their state and errors, and support Escape. Calendar and
  property-local drafts reset when their route identity changes.
- **Editing an older payslip could silently change its currency.** Corrections
  retain the document's stored currency, while legacy rule thresholds and home
  energy prices are permanently bound to the currency in force when they were
  authored rather than being reinterpreted after a base-currency change.

### Security

- Initial setup is a single database claim: concurrent requests cannot create
  two first administrators, and the public pre-claim work is capped at twenty
  people so losing requests cannot schedule unbounded Argon2 work.
- Password changes and deactivation advance an authentication generation.
  Sessions, credentials and positive passkey counters are written only if that
  generation is still current and the person is still active, closing the
  in-flight registration and sign-in races.
- Enrollment token consumption, the active-person/password check, password
  creation and session issuance are now one atomic transition. A concurrent
  deactivation or second enrollment request cannot leave a usable partial
  account.
- Public passkey challenge issuance has its own rate budget, sized for a
  household rather than for guessed credentials, and bounded, expiry-indexed
  storage. Login limiting is keyed per account, with unknown accounts collapsed
  onto one budget: behind Tailscale or a reverse proxy the whole household is a
  single address, so there is deliberately no budget above that key.
- Bearer authentication is enforced once at the whole `/api` route boundary —
  the same tree the sign-in redirect exempts — and therefore fails closed for
  future endpoints. Scheme parsing is
  case-insensitive, token failures are throttled, invalid cookies are cleared,
  and expired sessions have a cleanup path.

### Changed

- Coherent writes now live in reusable server-domain modules for loans,
  documents, property, rules, tags, splits and imports; page actions translate
  form data and results instead of repeating transaction orchestration.
- Repeated client behavior is shared through upload, action-error, autosave,
  overlay and loan-scenario primitives. Repayment and re-fix dialogs retain
  their distinct fields while sharing payload decoding and comparison UI.
- Retirement assumptions now expose contribution-growth and property-growth
  controls, saved through the same conflict-safe autosave as the other inputs.
- The migration journal now has a consolidated current schema snapshot and a
  regression holding it to the declared schema table by table and column by
  column, so drift cannot surface later as a surprise migration. Embedded
  PostgreSQL integration coverage now exercises imports, authentication,
  transactions/tags, loans, domain rollback/concurrency and autosave ordering.

## 0.3.2 — 2026-08-15

Two rounds of whole-codebase review, and the repairs the second round found in
the first. The theme is figures that were wrong without saying so: a hang that
took the server down, amounts scaled by the wrong power of ten, statement rows
dropped in silence, and a passkey challenge that was never really checked.

**Upgrading**: migration `0023` rescales stored amounts for currencies that do
not have two minor units, and `FINGERPRINT_VERSION` moves to 3 for the same
reason. Both are no-ops for CZK, EUR, USD, PLN and every other two-decimal
currency — which is every currency this app could previously hold correctly. If
you have pointed the smart meter at a bill, see "the meter no longer invents a
bill line" below: you will need to say which line it feeds.

### Fixed

- **The cash-flow waterfall could hang the whole server.** The label-relaxation
  loop took each block's position from the labels' original positions while
  recomputing which labels formed a block from their moved ones. The two
  disagreed, so for some arrangements it alternated between two layouts and
  never settled. It is computed inside a `$derived`, so this ran during the
  server-side render of `/cashflow` and `/overview` — a synchronous infinite
  loop on the one Node thread, which stops every request for every user until
  the container is restarted. It is now a pool-adjacent-violators merge, which
  terminates in at most one merge per label.
- **A sixty-byte floor plan could exhaust the heap.** The legacy-rectangle path
  in `validateDrawing` checked only that x, y, w and h were integers before
  allocating `w × h` cells. Its sibling branch had always clamped to the grid;
  now both do.
- **A failed boot was cached forever.** `ready ??= boot()` only reassigns when
  the left side is nullish, and a rejected promise is not — so one unreachable
  database during migration made every later request await the same rejection,
  long after the database came back.
- **Confirming a transfer could resurrect a rejected one and erase a category.**
  A raw SQL fragment holding a top-level `or` was passed to Drizzle's `and()`,
  which parenthesises the list but never its operands: the predicate rendered as
  `(state = 'proposed' AND out = id) OR (in = id)`, so posting any in-leg
  matched its pair whatever its state, and confirming then nulled both legs'
  category. `rejectTransfer` had no state filter at all.
- **Transfers proposed during an import vanished and stayed double-counted.**
  The guard keeping a proposed leg out of categorisation read a snapshot taken
  before the same pass inserted its own proposals, so a leg proposed in that
  pass could be filed by a rule, drop out of the review queue, and leave both
  sides counting as real income and real spending with no way to confirm them.
- **Amounts were scaled by a hardcoded hundred in half the app.** `minorDigits`
  now reads the runtime's own CLDR data, and every crossing between minor units
  and a plain number goes through `toMajor`/`fromMajor`. Scattering `/ 100` and
  `* 100` worked only while every currency had two minor units — the moment one
  half of a round trip became currency-aware and the other did not, the figure
  came out a hundred times wrong. Migration `0023` rescales what was already
  stored.
- **One stray quote mark swallowed the rest of a CSV.** A quote now opens a
  field only at the field's start, as in RFC 4180. Treating one anywhere as an
  opener meant an inch mark in a card description — `NAKUP 27" MONITOR` — ate
  the delimiter after it and merged the amount into the description; the row
  then failed its adapter's column guard and disappeared, while the import still
  counted as a success and recorded a content hash that made the corrected
  re-upload look like a duplicate.
- **A wrapped payment note dropped its transaction.** The field splitter
  understood quoted newlines and the record splitter feeding it did not, so a
  note wrapping onto a second line was cut in half and both halves discarded.
- **Uploaded PDFs opened as a blank tab.** The upload response carried a bare
  `sandbox` in its content-security policy, which is exactly what the browsers'
  own PDF viewers are — scripted documents — and blocked the download fallback
  too. The rest of the policy already blocks every script, which was the whole
  of the threat that token was added for.
- **An unknown exchange rate was treated as one-to-one.** Every converted total
  fell back to face value with nothing to say so; a 10 000 EUR movement counted
  as 100 CZK on an instance whose rate table had not been filled yet. Face value
  is still the arithmetic, but the app now names every currency being shown that
  way, on every screen. The check reads property and portfolio values too — the
  two largest figures on the net-worth screen, and the two it used to miss.
- **A repayment's saved projection disagreed with its preview.** The payment-day
  adjustment was applied when previewing a what-if and not when reading the
  stored balance back, so the chart drawn after saving booked an instalment the
  bank had already collected. Both now derive the anchor month from one rule.
- **Rules containing an accent or punctuation could never match.** The editor
  stored what was typed with only `.toLowerCase()`, while the matcher compares
  against text that has been diacritic-stripped and punctuation-collapsed. In a
  Czech household that is most of the rules a person writes — "Rohlík" never
  matched ROHLIK.CZ, "T-Mobile" never matched T-MOBILE. Both sides are folded
  now, which repairs rules already saved.
- **An English payslip was read a thousand times too small.** The amount pattern
  had no comma-grouped alternative, so `45,231.00` fell through to a tail that
  matched its first four characters and filed the slip as 45.23.
- **Five months a year vanished from the salary history.** Month names were
  matched with `\b`, which JavaScript defines over ASCII only — so nine of the
  twenty-three names in the table, every one beginning or ending with a
  diacritic, could never match. February, June, July, September and October
  payslips stored no period and dropped out of both the salary chart and the tax
  prefill.
- **The Raiffeisenbank parser lost a quarter of its references.** It read the
  transaction code and merchant line at fixed offsets, which a card payment with
  its own marker line pushes past. It now scans each movement's own span,
  stopping at the page header so a footer's date or a statement number cannot be
  taken for a movement's own.
- **The Česká spořitelna parser invented payment symbols.** On a card row the
  cell where a transfer prints its variable symbol holds the compressed
  transaction date, and rules match on that field — so a rule keyed to a real
  symbol could file unrelated card payments. Fifty of sixty symbols on a real
  statement were dates; all ten genuine ones survive.
- **A statement mentioning another bank was parsed as that bank's.** The sniff
  was a substring over the whole document, and both banks print their name deep
  in the body. It now reads the statement's own header, and a parse that finds
  no rows records nothing at all — previously it minted an account for a bank
  the household did not have and stored a content hash that refused the
  corrected re-import forever.
- **The smart meter reading could be a thousand times out.** The energy provider
  assumed kWh and never read the sensor's unit, and Shelly, Tasmota and ESPHome
  commonly report Wh. That figure is multiplied by the price per kWh and written
  onto a bill as money. The unit is now read and converted, an unrecognised one
  yields no reading rather than a guess, and the entity picker shows each
  sensor's unit.
- **Hovering the sidebar wrote to the database.** The home page's `load` updated
  and inserted bill rows, and the app asks SvelteKit to preload on hover. The
  write now runs on the hourly tick and when a platform is connected.
- **The month-to-date reading could span two months.** Its window was built by
  setting the UTC date on a local clock, so just after midnight on the 1st in a
  UTC-positive zone it opened a month early — and that figure is persisted as
  money hourly.
- **A meter reset read as a month of nobody being home.** The month tile and the
  daily bars are two views of one series and disagreed about what a counter
  reset means: one clamped the month to zero, the other dropped the day from the
  chart entirely. Both now sum the rises and treat a reset as a restart.
- **The split write path was three separate commits.** A failure between them
  left a transaction with no lines and its old category still set — the exact
  state the design exists to prevent — and two tabs saving at once could persist
  both sets. It is now one transaction with the parent row locked, and lines are
  matched to the rows they came from by id, so a split-level tag stays with its
  line instead of following the slot.
- **The register's totals hit a hard ceiling.** Splits for the whole filtered
  set were loaded by naming every matching id, against a Postgres limit of
  65 535 bind parameters. The predicate now goes to the database as a subquery.
- **A large page number returned a 500.** `Number.isInteger(1e21)` is true, so
  `?page=1e21` reached SQL as `OFFSET 5e+22`.
- **The read-only API wrote on every poll.** `computeNetWorth` upserted a
  snapshot as part of computing the figure, and it runs from the app layout on
  every page as well as from `GET /api/v1/networth`. The snapshot is now written
  on the scheduler, and the per-holding rate lookups collapsed into one.
- **Uploads over 512 KB failed with a bare 413.** `adapter-node` rejects larger
  bodies before any of the app's code runs, so a phone photo never reached the
  upload form's own error. `BODY_SIZE_LIMIT` is now set, and configurable as
  `CONTINUUM_MAX_UPLOAD`.
- **The backup destination was stored with no validation.** The dump is
  plaintext SQL holding every password hash and access token. A system directory
  or the served uploads folder is now refused, and an unwritable path is caught
  where the person who typed it can still see the message.

### Security

- **A passkey assertion could be replayed indefinitely.** The WebAuthn challenge
  lived only in a cookie the caller hands back, and SvelteKit does not sign
  cookies — so `expectedChallenge` was whatever the request said it was, and
  there was no record anywhere of what the server had actually issued. Anyone
  holding one captured assertion could turn it into a fresh thirty-day session,
  over and over. Challenges are now recorded when issued and spent when used: a
  verification that spends nothing is refused.
- **Changing a password did not remove passkeys.** Registering one needs only a
  live session, so somebody with a stolen cookie could enrol their own
  authenticator and keep it long after the password changed — a credential is
  not tied to the password, and passkey sign-in went on minting sessions.
  Changing a password now revokes every other session _and_ every registered
  passkey, and the confirmation says so.
- **Eight bad attempts could lock out the whole household.** The rate limiter
  was keyed on client address alone, and the Tailscale sidecar this release
  supports puts every member behind one address. Sign-in attempts are now
  budgeted per account, enrollment links have their own budget instead of
  spending the sign-in one, and spending a valid link no longer clears the
  failure counter. `ADDRESS_HEADER` and `XFF_DEPTH` are documented for
  deployments behind a trusted proxy.
- Uploaded files are served with a content-security policy and `nosniff`, so an
  SVG carrying a script is inert when opened directly; data formats are handed
  over as downloads.

### Changed

- **The meter no longer invents a bill line.** It used to look for a bill whose
  label contained "energy", which missed the app's own seeded "Electricity
  advance" — so it added a second line beside it and the flat's total counted
  electricity twice. Which line the meter feeds is now the household's choice,
  made with the 📟 control on the property card, and the reading is converted
  from the currency the price was typed in to the property's own.
- Continuous integration runs the end-to-end suite. It existed and nothing ran
  it, so the authentication, import, splits and API-token paths were covered
  only by a journey no build executed.
- `person.role` is constrained in the database to the two values the code
  recognises, and `session.person_id` and `credential.person_id` are indexed
  like every comparable foreign key in the schema.
- The setup wizard writes its people and settings as one transaction. The first
  person is what closes the wizard, so a failure part-way through used to strand
  the instance with no way back to that screen.

## 0.3.1 — 2026-08-14

Hardening the accounts work in 0.3.0. Three rounds of review over that release
found gaps between what the code did and what the README promised; this closes
them.

### Fixed

- **Settings export needed no administrator.** `?/importConfig` was restricted
  when roles landed but its read counterpart, `GET /settings/export`, was not —
  so any signed-in member could download `ledger.config.json`, which names the
  host filesystem path backups are written to. It now requires an administrator,
  and an end-to-end test signs in as a member and checks for the 403.
- **The household roster told members too much.** Administrative sections were
  withheld from members, but the list of people still carried everyone's role,
  birth year, deactivation state, and which accounts had no password set yet —
  that last one naming exactly the people with a live enrollment link. Members
  now see names and nothing else.
- **Deactivation left enrollment links live.** Deactivating someone cut their
  sessions but not the one-time link they had never opened, so whoever held that
  URL could still set a password on a closed account. Deactivation now voids the
  link, and enrollment independently refuses a deactivated person — previously
  they would have been handed a session and bounced straight back out at the
  next request with nothing explaining why.
- **An expired enrollment link could be marked used.** Submitting the form on an
  eight-day-old link stamped `used_at` on the way to rejecting it, flipping its
  status from expired to used. Every condition now lives in the update's own
  predicate, so an expired link is refused without being written to.
- **A trailing slash in `ORIGIN` broke every passkey.** `ORIGIN` was passed to
  WebAuthn verbatim while everything else parsed it, so a value written as
  `https://Continuum.example.ts.net/` reported itself secure, drew both passkey
  buttons, and then failed every registration and sign-in with an error that
  named nothing. It is now normalised the way a browser reports an origin.
- **Cloned-authenticator detection never ran.** The library's own counter rule
  fired first, which made the check unreachable — and that rule would have
  locked out a synced passkey that once reported a real counter and later
  reported zero, which is exactly the case the check exists to permit.
- **A refused role change or deactivation committed its transaction.** `fail()`
  returns rather than throws, so Drizzle saw a normal completion. Nothing was
  written either way, but the locks were held to COMMIT and the pattern would
  have silently persisted partial work the day a write moved above a guard.
- The end-to-end suite builds inside its web-server command, whose timeout
  defaults to sixty seconds — enough for a cold build to abort the whole run
  before a single test started. It now gets five minutes.
- The README's Tailscale instructions proxied port 3000, which is the port
  inside the container. Compose publishes 80.
- **An administrator who had never enrolled counted as one.** The last-
  administrator guard measured "admins who are not deactivated", which includes
  an account created moments ago that has no password, holds nothing but a
  one-time link, and cannot reach a single administrative control. Adding one
  made the count read two, and the only person who could actually sign in and
  administer the household was then free to demote themselves — the exact
  outcome the guard exists to prevent, recoverable only through the database
  one-liner in the README. The count is now the same condition sign-in uses.
- **A crafted credential id was an uncounted 500.** The sign-in endpoint checked
  only that the id was a non-empty string, but a credential id is base64url and
  goes straight into a Postgres text lookup: a NUL byte in it threw 22021 from
  outside every catch in the handler. Anyone could reach that unauthenticated,
  and it happened without passing any branch that records a failed attempt, so
  it was never rate limited. The id is now checked against its actual shape, and
  a passkey's label is stripped of control characters for the same reason.
- **Two enrollment links could be live for one person.** "One link per person"
  was a delete followed by an insert with nothing in the table to enforce it, so
  a double-clicked _New link_ left both spendable and the older URL — possibly
  the one sent to the wrong address — kept working. It is now a single upsert
  against a unique constraint, and the upgrade removes any duplicates already
  stored.
- **An enrollment link was honoured against an account that already had a
  password.** Spending one overwrites the password and signs its visitor in, so
  reissuing refuses anyone already enrolled — but it read and then wrote in two
  separate round trips, and somebody who enrolled inside that window was left
  with a live link pointing at their own account. Enrollment now checks the same
  condition at the point of use, so a link that should never have been minted is
  refused rather than honoured.
- **A new link could be minted for a closed account.** Deactivation revokes the
  outstanding link, but _New link_ still appeared for a deactivated person who
  had never enrolled and still produced a valid-looking URL, which enrollment
  then refused with the wording a broken link gets — leaving both sides blaming
  the URL rather than the account.
- **The sign-in picker listed people who could not sign in.** Someone added but
  not yet enrolled appeared in the list, and every attempt they made failed
  against the shared per-address limit that gates everyone's sign-in — behind a
  reverse proxy or Tailscale, eight guesses from one new person locked out the
  household.
- **A refusal could name the wrong person as the last administrator.** Demoting
  or deactivating an administrator who was already deactivated cannot reduce the
  number of people who can administer anything, but the guard tested the role
  alone and refused, citing a person the request never touched.
- **How long a sign-in failed said what kind of account it was.** A wrong
  password costs a full argon2 verify; a deactivated or never-enrolled account
  short-circuited before it and answered in about a millisecond, so timing drew
  the distinction the identical wording exists to hide.
- The add-person form kept four columns on a phone. Its single-column rule was
  left behind in the settings page when the household list moved into its own
  component, where it was quietly reused by the password form.

### Changed

- **`PASSWORD_MIN_LENGTH` and `ENROLLMENT_LINK_DAYS` are configurable**, with
  the previous values as defaults. Both are household policy rather than facts,
  and the interface hints are fed by the same numbers the server enforces so the
  two cannot disagree. The WebAuthn challenge lifetime stays fixed on purpose:
  it bounds one ceremony, and a knob there would only widen a replay window.
- **Changing your password says so.** It was the one action on the page with a
  real security consequence and no feedback at all — the form now clears and
  confirms that other devices were signed out. It also has its own layout
  instead of borrowing the add-person grid, whose second column is sized for a
  birth year and left the new-password field a third the width of its
  neighbours.
- The two passkey buttons share one ceremony helper. The fragile part is the
  list of exception names that mean "the person cancelled", and it was written
  out twice.
- **Administrator enforcement on the settings page is applied once**, to every
  action except the two a member comes there for, instead of being repeated at
  the top of each. The guard was correct twelve times over and the shape was
  still wrong: forgetting the thirteenth left an action anyone signed in could
  call, with nothing failing to say so.
- A member's settings page no longer fetches the module map, the base currency
  or the currency list — all three render only for administrators — and the
  passkey query is skipped entirely on deployments where passkeys are not
  possible.
- Sessions, API tokens and enrollment links share one token-hashing function.
  Each had its own private copy whose comment claimed to match the others, so
  hardening one would have quietly left the other two behind.

## 0.3.0 — 2026-08-14

Accounts you can actually manage, and a way in that is not a password.

### Added

- **Passkeys**: sign in with Face ID, Touch ID or Windows Hello alongside the
  existing passwords, which are staying — a device without a passkey still
  works, and there is no lockout risk. Credentials are discoverable, so the
  sign-in screen needs no person picker: one tap and you are in. Manage them in
  Settings → Household, where each device is listed with its last-used date and
  can be removed on its own.
- **Enrollment links**: adding a person produces a one-time link, valid seven
  days, that lets them choose their own password. The administrator who created
  the account never knows it. Until they enrol they show as "not enrolled yet"
  and cannot sign in.
- **Change your own password**, from Settings. Every other session for that
  person is revoked on success, so changing it after a scare actually ejects
  the other device.
- **Deactivate and reactivate a person.** Deactivation blocks sign-in and cuts
  live sessions but keeps their password, passkeys and history, so reactivating
  is a clean undo. People are never deleted — six tables reference them.
- **Administrator role.** `person.role` finally means something: exactly
  `admin` or `member`. Administrators alone can add or deactivate people, change
  roles, manage API tokens, switch modules, set the base currency, and configure
  or run backups. A member's Settings page holds their own password and their
  own passkeys and nothing else — the rest is never sent to them. You cannot
  deactivate yourself, and the last administrator can be neither deactivated nor
  demoted, so an instance can never be left with nobody in charge. Those two
  guards now hold under concurrent edits: the check and the write share one
  transaction with the administrator rows locked.
- **A sign-out control** in the sidebar. `/logout` had existed since the first
  release with nothing linking to it.
- **Optional Tailscale sidecar** (`docker compose --profile tailscale up -d`)
  that terminates HTTPS for the app, which is what makes passkeys possible.
  Private by default: it publishes to your tailnet, never the public internet.

### Changed

- `person.role` was previously incoherent — the schema defaulted to `adult`,
  the demo seeder wrote `admin`/`member`, the setup wizard never set it, and
  nothing read it. It is now the permission field, with exactly two values.
- `person.password_hash` is now nullable, so a person can exist between being
  created and choosing a password.
- The end-to-end suite now builds the app before running. It previously served
  whatever was last compiled, so it could pass against code no longer in the
  repository.
- Passkeys now require user verification — the biometric or PIN — rather than
  merely preferring it. The server already enforced it, so asking for less than
  that meant an authenticator which skipped the prompt was rejected afterwards
  with an error nobody could act on. A security key with no PIN configured will
  no longer register; Face ID, Touch ID and Windows Hello are unaffected.
- Signing in now ends whatever session the browser arrived with, instead of
  leaving the previous person's session row alive for its full thirty days.

### Upgrading from 0.2.x

Your existing people carry `role = 'adult'`, the old column default, which is
neither `admin` nor `member`. Migration `0020` runs on first boot and turns
every such row into an administrator — before 0.3.0 anyone who could sign in
could do anything, so this takes no capability away from anyone. Demote whoever
should be a member in Settings → Household afterwards. Nothing else is needed:
`docker compose pull && docker compose up -d` is the whole upgrade.

## 0.2.1 — 2026-08-14

Reachable by name.

### Changed

- The server sits on plain port 80 by default (`CONTINUUM_PORT` in `.env`
  overrides it), so with a DHCP reservation and a LAN hostname the whole
  address is `http://continuum.local` — no port to remember. Compose fails
  loudly if 80 is already taken, never silently.
- README documents the local-name setup end to end: the DHCP reservation, the
  mDNS / router-DNS name, and the `ORIGIN` value that must match the address
  you browse to.

## 0.2.0 — 2026-08-14

The ledger grew from watching money to working with it.

### Added

- **Transaction register** (`/transactions`): every row the ledger holds,
  searchable by text, date, account, category, direction, amount and tag, with
  per-currency totals over the filtered set. Filing a correction here teaches
  the categoriser exactly as the review queue does.
- **Splits**: one payment divided between categories, with a dialog that
  balances live and refuses to save otherwise. Lines always sum to the parent;
  every consumer resolves through one seam, so cash flow and filters count the
  matching share of a split receipt, not the whole of it.
- **Tags** (`/tags`): cross-cutting projects — a renovation, a holiday — over
  transactions, split lines, documents, properties and loans, each with a
  running per-currency total.
- **Rules engine** (`/rules`): rules with several ANDed conditions
  (counterparty, note, counter-account, variable symbol, amount range) that
  set a category and add tags. Each rule's confidence is earned: the Wilson
  lower bound on how often its suggestions survived your corrections. Contested
  or unproven rows go to review with the best guess pre-filled; nothing is ever
  guessed silently, and a match preview shows what a rule would touch before it
  is saved.
- **Read-only JSON API** (`/api/v1`): accounts, transactions (with the
  register's filter params), categories, tags, net worth and cash-flow totals,
  behind bearer tokens created in Settings and stored only as hashes. Every
  amount is integer minor units plus a currency code — never a float. No write
  endpoints, no webhooks.
- **Tax statements** (`/tax`, toggleable module): what each person's yearly
  statement said, per country, with free labelled lines instead of a
  hard-coded jurisdiction. Gross pre-fills from the payslip history and stays
  whatever you corrected it to; charts show gross, tax paid and effective rate
  per person and country, money panels split per currency.
- **Entity links**: a document always belongs to something real — people,
  flats, brokerage accounts, or subject records like the household or the car
  — through typed join tables, several at once. Columns on the Documents
  screen follow renames; a typo can no longer mint a phantom subject. The
  migration carries every existing free-text subject across and reports what
  it did in the boot log.

### Changed

- Import review pre-selects the engine's suggested category instead of
  arriving empty.
- The old single-matcher categoriser and the free-text document subject are
  gone; both migrations are automatic and lossless.
- Base control styling now lives once in `app.css` instead of being restated
  per screen.

### Fixed

- Amount filters compare exactly across currencies with different minor-unit
  scales (integer cross-multiplication, no floats).
- Subjects are case-insensitively unique; existing case-duplicates are merged
  by migration.
- The rules screen no longer presents a rule's starter prior as history — it
  shows only what a human actually kept or overrode.

## 0.1.0 — 2026-08-13

First published version: setup wizard and per-person sign-in; statement import
for five banks (Fio, Revolut, mBank, Raiffeisenbank, Česká spořitelna) with
dedup, transfer pairing and correction-learning categorisation; cash-flow
waterfall; multi-currency accounts with daily CNB rates; property with
tenancies, floor plans and bills; loans with fixation-period interest verified
to the haléř; XTB investment imports; retirement projection with a payslip-fed
salary tracker; documents with shelves and expiry; generated calendar with an
ics feed; Home Assistant provider seam; scheduled backups; demo mode.
