<div align="center">
  <img src="docs/logo.svg" alt="Continuum" width="72" />

  <h1>Continuum</h1>

  <p><strong>Your household's whole financial picture, on your own hardware.</strong></p>

  <p>
    Import your bank statements and watch where the money actually goes. Accounts,
    property, loans, investments, tax and documents in one place. No cloud account,
    no subscription, no telemetry. Nothing calls home.
  </p>

  <p>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-PolyForm%20Noncommercial-blue?style=flat-square" alt="PolyForm Noncommercial"></a>
    <img src="https://img.shields.io/badge/self--hosted-Docker%20%C2%B7%20Postgres-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker and Postgres">
    <img src="https://img.shields.io/badge/passkeys-supported-5A0FC8?style=flat-square" alt="Passkeys supported">
    <img src="https://img.shields.io/badge/trackers-0-green?style=flat-square" alt="Zero trackers">
  </p>

  <p>
    <a href="#install-docker"><strong>→ Install in minutes</strong></a> &nbsp;·&nbsp;
    <a href="#screens"><strong>Screens</strong></a> &nbsp;·&nbsp;
    <a href="#what-it-does"><strong>What it does</strong></a> &nbsp;·&nbsp;
    <a href="CHANGELOG.md"><strong>Changelog</strong></a>
  </p>
</div>

<br>

<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/cashflow-dark-web.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/cashflow-light-web.png">
    <img src="docs/screenshots/cashflow-dark-web.png" alt="Cash flow — a Sankey diagram tracing salary and rent through housing, food, transport and bills to what is left" width="860">
  </picture>
  <br>
  <sub>Cash flow, in the order money is committed. GitHub serves the theme you are reading in.</sub>
</div>

<br>

<div align="center">
  <table>
    <tr>
      <td align="center"><b>5</b><br><sub>bank formats</sub></td>
      <td align="center"><sub>·</sub></td>
      <td align="center"><b>3</b><br><sub>base currencies</sub></td>
      <td align="center"><sub>·</sub></td>
      <td align="center"><b>13</b><br><sub>dashboard panels</sub></td>
      <td align="center"><sub>·</sub></td>
      <td align="center"><b>0</b><br><sub>trackers</sub></td>
      <td align="center"><sub>·</sub></td>
      <td align="center"><b>1054</b><br><sub>tests</sub></td>
    </tr>
  </table>
</div>

<br>

Continuum is built for households, not companies: two people, a few banks in a few
currencies, a flat or two, and the question that actually matters — _what is our net
worth right now, and is it going up?_ It runs as two containers on any machine you
own, and the only copy of your financial history is the one on your disk.

---

## Why

Household money ends up scattered across a banking app per bank, a spreadsheet
that goes stale, and a budgeting service that wants your bank credentials and a
monthly fee. Continuum puts it in one place that belongs to you.

| Instead of…                                  | Continuum gives you                                                                 |
| -------------------------------------------- | ----------------------------------------------------------------------------------- |
| a budgeting service holding your bank logins | **Import** — you export the statement, it never touches your bank                   |
| a spreadsheet that goes stale                | **Cash flow** — a Sankey of where the money actually went, redrawn on every import  |
| guessing what a flat is worth                | **Property** — tenancies, floor plans, bills with documents attached                |
| a mortgage calculator in a browser tab       | **Loans** — fixation periods, real interest bookkeeping, what-if repayment previews |
| a broker's own dashboard                     | **Investments** — fed by broker report uploads, behind an adapter seam              |
| a folder of PDFs called `scans`              | **Documents** — filed against a person, a flat, a loan; renames follow              |
| a reminder you set once and lost             | **Calendar** — ledger dates plus your own, synced to Google and iCloud              |

<table>
  <tr>
    <td width="50%" valign="top">
      <b>Private by construction</b><br>
      <sub>Self-hosted on your hardware, with no telemetry and no accounts beyond your own household. Credentials live in their own table so a config export cannot leak them by omission. Real bank statements never leave the machine — the committed test fixtures are synthetic.</sub>
    </td>
    <td width="50%" valign="top">
      <b>Correct about money</b><br>
      <sub>Every amount is an integer in minor units with a currency code, never a float. Multi-currency accounts convert at the rate that applied on the day, from daily Czech National Bank fixings, and a missing rate says so rather than quietly counting at face value.</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <b>Safe to re-import</b><br>
      <sub>Statements are deduplicated by content and by transaction, so overlapping exports are always safe — including concurrent uploads. Re-uploading is the intended way to backfill years of history.</sub>
    </td>
    <td width="50%" valign="top">
      <b>Two people, not one admin</b><br>
      <sub>Everyone signs in as themselves, with their own dashboard arrangement, their own passkeys and their own tax statements. Administrators manage the household; members see their own settings and nothing more.</sub>
    </td>
  </tr>
</table>

---

## Screens

<div align="center">
  <table>
    <tr>
      <td align="center" width="50%">
        <picture>
          <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/overview-dark-web.png">
          <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/overview-light-web.png">
          <img src="docs/screenshots/overview-dark-web.png" alt="Overview — a briefing panel over the cash-flow chart">
        </picture>
        <br><sub><b>Overview</b> — a board each person arranges for themselves, from thirteen panels</sub>
      </td>
      <td align="center" width="50%">
        <picture>
          <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/transactions-dark-web.png">
          <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/transactions-light-web.png">
          <img src="docs/screenshots/transactions-dark-web.png" alt="Transactions — the searchable register">
        </picture>
        <br><sub><b>Transactions</b> — search, split a receipt across categories, tag into projects</sub>
      </td>
    </tr>
    <tr>
      <td align="center">
        <picture>
          <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/property-dark-web.png">
          <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/property-light-web.png">
          <img src="docs/screenshots/property-dark-web.png" alt="Property — flats, tenancies and bills">
        </picture>
        <br><sub><b>Property</b> — tenancies, drawable floor plans, bills with documents attached</sub>
      </td>
      <td align="center">
        <picture>
          <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/loans-dark-web.png">
          <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/loans-light-web.png">
          <img src="docs/screenshots/loans-dark-web.png" alt="Loans — fixation periods and repayment previews">
        </picture>
        <br><sub><b>Loans</b> — fixation-period interest, what-if repayment and re-fix previews</sub>
      </td>
    </tr>
    <tr>
      <td align="center">
        <picture>
          <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/investments-dark-web.png">
          <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/investments-light-web.png">
          <img src="docs/screenshots/investments-dark-web.png" alt="Investments — portfolio from broker reports">
        </picture>
        <br><sub><b>Investments</b> — portfolio fed by broker report uploads</sub>
      </td>
      <td align="center">
        <picture>
          <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/retirement-dark-web.png">
          <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/retirement-light-web.png">
          <img src="docs/screenshots/retirement-dark-web.png" alt="Retirement — projection from a payslip-fed salary tracker">
        </picture>
        <br><sub><b>Retirement</b> — projection driven by a payslip-fed salary tracker</sub>
      </td>
    </tr>
    <tr>
      <td align="center">
        <picture>
          <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/tax-dark-web.png">
          <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/tax-light-web.png">
          <img src="docs/screenshots/tax-dark-web.png" alt="Tax — yearly statements per person and country">
        </picture>
        <br><sub><b>Tax</b> — yearly statements per person and country, pre-filled from payslips</sub>
      </td>
      <td align="center">
        <picture>
          <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/calendar-dark-web.png">
          <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/calendar-light-web.png">
          <img src="docs/screenshots/calendar-dark-web.png" alt="Calendar — generated dates with an ics feed">
        </picture>
        <br><sub><b>Calendar</b> — ledger dates and your own events, two-way sync with Google and iCloud</sub>
      </td>
    </tr>
    <tr>
      <td align="center">
        <picture>
          <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/contacts-dark-web.png">
          <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/contacts-light-web.png">
          <img src="docs/screenshots/contacts-dark-web.png" alt="Contacts — the household address book, linked to tenancies and properties">
        </picture>
        <br><sub><b>Contacts</b> — tenants, tradespeople and bank contacts, linked to what they relate to</sub>
      </td>
      <td align="center">
        <picture>
          <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/documents-dark-web.png">
          <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/documents-light-web.png">
          <img src="docs/screenshots/documents-dark-web.png" alt="Documents — filed against a person, a flat or a loan">
        </picture>
        <br><sub><b>Documents</b> — filed against something real, so renames follow and expiries surface</sub>
      </td>
    </tr>
  </table>

<sub>On a phone, too — every screen reflows to one column:</sub>
<br>
<picture>
<source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/overview-dark-mobile.png">
<source media="(prefers-color-scheme: light)" srcset="docs/screenshots/overview-light-mobile.png">
<img src="docs/screenshots/overview-dark-mobile.png" alt="Overview on a phone" height="420">
</picture>
&nbsp;
<picture>
<source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/transactions-dark-mobile.png">
<source media="(prefers-color-scheme: light)" srcset="docs/screenshots/transactions-light-mobile.png">
<img src="docs/screenshots/transactions-dark-mobile.png" alt="Transactions on a phone" height="420">
</picture>
&nbsp;
<picture>
<source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/calendar-dark-mobile.png">
<source media="(prefers-color-scheme: light)" srcset="docs/screenshots/calendar-light-mobile.png">
<img src="docs/screenshots/calendar-dark-mobile.png" alt="Calendar on a phone" height="420">
</picture>
&nbsp;
<picture>
<source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/property-dark-mobile.png">
<source media="(prefers-color-scheme: light)" srcset="docs/screenshots/property-light-mobile.png">
<img src="docs/screenshots/property-dark-mobile.png" alt="Property on a phone" height="420">
</picture>

<br><br>
<sub>Every screenshot is generated from the demo household by <code>scripts/take-screenshots.mjs</code>, so they cannot drift from the app.</sub>
</div>

---

## What it does

All five phases are functional: setup wizard and per-person sign-in; statement
import from any bank — the layout is worked out from the file and checked against
its own balances, with automatic categorisation and transfer pairing across
your own accounts; a searchable transaction register where a receipt can be split
between categories and anything can be tagged into projects with running totals; a
rules engine whose rules earn (and lose) trust from whether their suggestions
survive your corrections; the cash-flow Sankey; multi-currency accounts with daily
CNB rates; property with tenancies, drawable floor plans and bills with attached
documents; loans with fixation-period interest bookkeeping and what-if
repayment/re-fix previews; investments fed by broker report uploads (XTB first,
behind an adapter seam); retirement projection with a payslip-fed salary tracker;
yearly tax statements per person and country, pre-filled from the payslips and
charted over time; documents that always belong to something real — a person, a
flat, an investment, the household — so columns follow renames and a typo cannot
mint a phantom subject; a generated calendar with an ics feed; a read-only JSON API
behind bearer tokens for dashboards and Home Assistant; Home Assistant itself
behind a pluggable provider interface; and scheduled backups straight into a
cloud-synced folder.

### Statement import

**Any bank.** There is no list of supported banks, because nothing in the reader
knows which bank wrote a file. A statement is read by working out its structure
from the file itself, and it is filed only if it then agrees with its own
arithmetic — the printed opening and closing balances, the running balance, the
stated totals, the movement count. Whatever the reader cannot prove, it refuses.

| What you upload                   | How it is read                                |
| --------------------------------- | --------------------------------------------- |
| CSV, TSV, or any delimited export | encoding, delimiter and columns worked out    |
| Excel workbook (`.xlsx`)          | a statement per sheet                         |
| PDF                               | the table recovered from the page geometry    |
| CAMT.053, MT940, ABO/GPC, OFX/QFX | read directly — these declare their own shape |

Measured on real statements from ten institutions across Poland, Czechia, Spain and
the United States, on synthetic British, German and American layouts, and on a
294-file corpus spanning 24 locales and 20 currencies: **every real statement is read
without knowing which bank wrote it**, and 274 of the 294 are read exactly. The five
banks that once had hand-written parsers still have them as a fast path, but nothing
depends on them any more.

**When it cannot work something out, it asks.** A layout nobody recognises opens a
mapping wizard: you say which column is the date and which is the amount, it
remembers the answer, and the next statement from that bank arrives already
understood. If the bank later adds a column, you are asked again with your previous
answers filled in — never silently misread, which is what mapping by column
_position_ would do.

#### What it will not do

- **It refuses what it cannot check.** A statement that prints no balances, no
  totals and no count cannot be verified by anyone, so it is refused rather than
  taken on trust. QIF is the common case: it records a date, an amount and a payee,
  and nothing that could confirm them.
- **It refuses when a file is genuinely ambiguous.** A date column where every day
  and month is twelve or lower, with no period printed, has no correct reading; so
  does a CSV whose delimiter is also its decimal mark and whose figures happen to
  survive both readings.
- **Not yet read:** OpenDocument spreadsheets (`.ods`), and legacy `.xls`
  workbooks — re-save either as `.xlsx`.
- **Scanned statements and photographs** are read from the page image, in the
  background, and held to the same arithmetic as everything else. This is the newest
  part and the least reliable: on a rendered-page corpus it reads about two in five
  exactly and refuses the rest. Nothing it cannot prove is filed, so a poor scan
  costs you a refusal rather than a wrong number.

How the reader works, and the twenty files it still cannot read with the reason for
each, are documented in [`docs/statement-import.md`](docs/statement-import.md).

Statements are deduplicated by content and by transaction, so re-uploading
overlapping exports is always safe — including concurrent uploads and exports that
overlap an older fingerprint format. Account identity includes bank, currency and
the exact normalised account number; an ambiguous match is held for a person
instead of creating or choosing an account by guess. Re-uploading is the intended
way to backfill years of history.

---

## Install (Docker)

```sh
curl -O https://raw.githubusercontent.com/pandorica-scientific/continuum/main/compose.yaml
docker login   # the kerth92/continuum image is private for now
POSTGRES_PASSWORD=change-me docker compose up -d
```

Open `http://your-server` (port 80 by default; set `CONTINUUM_PORT` in `.env` if
something else already owns it) and follow the setup wizard. Everything — people,
base currency (CZK, EUR or PLN), modules — is configured there, not in files.

That brings up a **Tailscale sidecar** alongside the app, because HTTPS is what
makes passkeys possible and a home server has no other easy route to a trusted
certificate. It is tailnet-only — see [Passkeys and
Tailscale](#passkeys-and-tailscale) for the one-time authentication step and the
`ORIGIN` it needs. Until you complete it the sidecar simply idles, and the app is
reachable on the port above exactly as before. To leave Tailscale out altogether,
start the two services you need:

```sh
docker compose up -d app db
```

Three optional knobs live in `.env`. `CONTINUUM_MAX_UPLOAD` sets the largest
accepted upload (`32M` by default — a phone photo does not fit in the server's own
512 KB default). `ADDRESS_HEADER=x-forwarded-for` makes the app read the real
client address from a forwarded header, which authentication rate limits need
behind a reverse proxy. `XFF_DEPTH=1` chooses the trusted hop counted from the
right of `X-Forwarded-For`; increase it only for a known proxy chain. Set either
only where that chain is the only way in and always overwrites the header, or a
caller can forge its address.

### Try it first

```sh
DEMO=1 docker compose up -d
```

On a pristine instance this seeds a fictional household — six months of
categorised cash flow, two flats on one shared mortgage, payslips, a portfolio —
so you can look around before importing anything real. Sign in as Jana Nováková
with `demo-demo-demo`. An instance that already has people is never touched, and
every screenshot above comes from exactly this data.

### Backups

Settings → Backups writes one restorable database dump
(`continuum-backup.sql`, overwritten on every run) plus a copy of every uploaded
file to a folder of your choosing, weekly or monthly. By default that is the
`continuum-backups` volume; point `CONTINUUM_BACKUPS` (in `.env`) at a
cloud-synced folder on the host — a Google Drive or Dropbox directory — and the
sync client carries the backup off-machine and keeps the dump's version history on
its side:

```sh
# .env
CONTINUUM_BACKUPS=/Users/you/Library/CloudStorage/GoogleDrive-you@gmail.com/My Drive
```

Restoring is booting a fresh instance (its migrations recreate the schema) and
feeding it the dump:

```sh
docker compose exec -T db psql -U continuum -d continuum -v ON_ERROR_STOP=1 \
  < "Continuum backups/continuum-backup.sql"
```

then copying the `files/` folder back into the `continuum-data` volume.

### Upgrading

Take a backup, then pull and restart the containers:

```sh
docker compose pull
docker compose up -d
```

Database migrations run before the app accepts requests. Release-specific data
repairs and any manual considerations are listed at the top of
[CHANGELOG.md](CHANGELOG.md).

---

## Reaching it by name

Typing `ip:port` stops working the moment the router hands the server a new
address. Two steps fix it for every device on the network, no cloud involved:

1. **Pin the address.** In the router's DHCP settings, give the server a
   reservation (a fixed lease for its MAC address). This is the actual cure for
   the rotating IP — do it even if you skip step 2.
2. **Name it.** Either set the server machine's hostname to `continuum`, and mDNS
   makes it reachable as **`http://continuum.local`** from macOS, iOS, Windows and
   recent Android with zero configuration — or, if your router offers local DNS
   names, give the reservation a name there (`continuum.lan` on most). A Pi-hole
   or AdGuard Home works too, with a custom DNS record.

The app sits on plain port 80 by default, so the name alone is the whole address —
just tell it what that address is:

```sh
# .env
ORIGIN=http://continuum.local
```

`ORIGIN` must match whatever address you actually browse to — form submissions are
origin-checked and will be refused otherwise. A bare `continuum` without a suffix
is not reliable in browsers (it reads as a search), so `.local` or your router's
suffix is the practical spelling.

## Accounts

The setup wizard makes its first person an **administrator**; everyone added later
is a **member**. Only administrators can add or deactivate people, change roles,
manage API tokens, switch modules on and off, set the base currency, or configure
and run backups. A member's Settings page holds their own password and their own
passkeys and nothing else — the administrative sections are not merely hidden from
them, they are never sent.

Adding someone in Settings → Household produces a **one-time enrollment link**,
valid for seven days, which you pass to them however you like. They open it and
choose their own password — you never see it. Until they do, they show as "not
enrolled yet" and cannot sign in.

Two knobs, both optional, in `.env`: `PASSWORD_MIN_LENGTH` (default 8) and
`ENROLLMENT_LINK_DAYS` (default 7). The password hints in the interface are fed by
the same value the server enforces, so they cannot disagree.

Deactivating a person blocks sign-in and cuts their live sessions, and voids any
enrollment link they never opened — but it keeps their password, passkeys and all
their history, so reactivating is a clean undo. People are never deleted:
accounts, properties, loans, documents and tax statements reference them.

Two guards mean an instance can never be left without an administrator: you cannot
deactivate yourself, and the last administrator can be neither deactivated nor
demoted. If you somehow lock yourself out, promote someone directly in the
database:

```sh
docker compose exec db psql -U continuum -d continuum \
  -c "UPDATE person SET role = 'admin', deactivated_at = NULL WHERE name = 'Your Name';"
```

## Passkeys and Tailscale

Continuum supports **passkeys** — Face ID, Touch ID, Windows Hello — alongside
passwords. Passwords never go away, so a device without a passkey still works.

Browsers refuse the passkey API outside a secure context, so the passkey controls
appear only when `ORIGIN` is `https://` (or `localhost` during development). On a
plain-HTTP LAN address they are simply absent rather than broken.

A passkey here always requires **user verification** — the face, the fingerprint,
or the device PIN. That is what keeps it a second factor rather than a bearer
token, and it means a roaming security key with no PIN configured cannot be
registered. Platform authenticators (Face ID, Touch ID, Windows Hello) verify by
nature and need nothing extra.

The simplest way to get HTTPS on a home server is
[Tailscale](https://tailscale.com), a WireGuard mesh that is **private by
default**: only devices you have added to your tailnet can reach the machine. That
is why the sidecar ships **on by default** — passkeys are the point, and they need
a secure origin. `tailscale serve` publishes to the tailnet; the command that
would expose the app to the public internet is `tailscale funnel`, which nothing
here runs. The one thing that does become public is the hostname — Tailscale's
certificate comes from Let's Encrypt, and every Let's Encrypt certificate is
listed in public Certificate Transparency logs. Nothing is reachable at that name;
only the name is visible.

The sidecar needs authenticating once. Either read the login URL out of its logs:

```sh
docker compose logs tailscale     # visit the https://login.tailscale.com/… URL
```

or generate an auth key in the Tailscale admin console and let it authenticate
unattended:

```sh
# .env
TS_AUTHKEY=tskey-auth-…
```

Either way, finish by telling the app the name Tailscale issued — passkeys are
verified against it exactly:

```sh
# .env
ORIGIN=https://continuum.<your-tailnet>.ts.net

docker compose up -d
```

Until that is done the sidecar sits unauthenticated and nothing else changes: the
app answers on its LAN address, and the passkey controls stay absent because the
origin is still plain HTTP.

**Do not remove the LAN port mapping yet.** Sign in over the tailnet address,
register a passkey in Settings → Household, and confirm it signs you in. Only then
delete the `ports:` block from the `app` service in `compose.yaml`, which makes
Tailscale the only way in. Note that this also puts the `/ics` calendar feed and
the `/api` tokens behind the tailnet, so a phone subscribed to the calendar needs
Tailscale connected for it to refresh.

**Already running Tailscale on the host?** Skip the sidecar. Set `ORIGIN` to your
existing `.ts.net` name and run, on the host:

```sh
# 80 is the host port compose publishes by default; use your CONTINUUM_PORT if
# you overrode it. 3000 is the port *inside* the container and is not published.
tailscale serve --bg 80
```

Any other route to a trusted certificate works equally well — a reverse proxy with
Let's Encrypt, or your own internal certificate authority via `mkcert` if you would
rather nothing appear in a public log. Continuum only cares that `ORIGIN` is
`https://` and matches the address you browse to.

## Smart-meter billing

When connecting Home Assistant, choose the lived-in property whose bill the meter
should feed and enter the energy price with its currency. On that property, mark
exactly one bill with the meter control. The hourly sync updates only that row and
converts the price into the property's currency; it never creates a guessed
"energy" bill. If the provider or target changes while a slow snapshot is in
flight, that stale reading is discarded.

## API

Settings → API tokens creates a bearer token (shown once) that grants read-only
access to the whole ledger under `/api/v1` — accounts, transactions (accepting the
register's filter params), categories, tags, net worth and cash-flow totals. Every
amount crosses the wire as integer minor units plus a currency code, never a
float:

```sh
curl -H "Authorization: Bearer <token>" http://your-server/api/v1/networth
# { "total": { "amountMinor": 646055100, "currency": "CZK" }, … }
```

There are no write endpoints and no webhooks — a household produces a handful of
events a week, so a dashboard polls.

---

## Development

```sh
docker compose up -d db        # Postgres
cp .env.example .env
npm install
npm run dev
```

- `npm test` — unit tests plus isolated embedded-PostgreSQL integration tests for
  imports, authentication, transactions/tags, loans, rollback/concurrency and
  revisioned autosave
- `npm run test:e2e` — Playwright journey (needs the db and `npm run build` first)
- `npm run check` / `npm run lint` — types and style
- `node scripts/take-screenshots.mjs` — regenerate `docs/screenshots/` from a
  running `DEMO=1` instance, both themes, desktop and phone

Real bank statements for parser development belong in
`bank_data_examples_do_not_share/` (gitignored). The committed test fixtures in
`tests/fixtures/` are synthetic and anonymised — keep it that way.

## Contributing

Bug reports, new bank formats and patches are welcome — start with
[CONTRIBUTING.md](CONTRIBUTING.md), which covers the setup above plus the two
rules the codebase follows and the one rule with no exceptions: no real financial
data ever leaves your machine. Participation is under the
[Code of Conduct](CODE_OF_CONDUCT.md).

Found a security problem? Do not open an issue — [SECURITY.md](SECURITY.md)
explains how to report it privately, and what the deployment assumes.

## License

PolyForm Noncommercial — free to self-host and modify for personal, noncommercial
use.
