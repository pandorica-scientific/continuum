# Changelog

## 0.3.1 — 2026-08-14

Hardening the accounts work in 0.3.0. Two rounds of review over that release
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
