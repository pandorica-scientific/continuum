# Changelog

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
