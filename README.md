# Continuum

A self-hosted household finance server. Import bank statements, watch where the
money goes, and keep everything — accounts, property, loans, investments,
documents — in one place on your own hardware. Nothing calls home.

Continuum is built for households, not companies: two people, a few banks in a
few currencies, a flat or two, and the question that actually matters — _what
is our net worth right now, and is it going up?_

![Overview — the cash-flow waterfall](docs/screenshots/overview.png)

## Status

All five phases are functional: setup wizard and per-person sign-in; statement
import for five banks with automatic categorisation and transfer pairing
across your own accounts; a searchable transaction register where a receipt
can be split between categories and anything can be tagged into projects with
running totals; a rules engine whose rules earn (and lose) trust from whether
their suggestions survive your corrections; the cash-flow waterfall;
multi-currency accounts with daily CNB rates; property with tenancies,
drawable floor plans and bills with attached documents; loans with
fixation-period interest bookkeeping and what-if repayment/re-fix previews;
investments fed by broker report uploads (XTB first, behind an adapter seam);
retirement projection with a payslip-fed salary tracker; yearly tax statements
per person and country, pre-filled from the payslips and charted over time;
documents that always belong to something real — a person, a flat, an
investment, the household — so columns follow renames and a typo cannot mint a
phantom subject; a generated calendar with an ics feed; a read-only JSON API
behind bearer tokens for dashboards and Home Assistant; Home Assistant itself
behind a pluggable provider interface; and scheduled backups straight into a
cloud-synced folder.

|                                             |                                      |
| ------------------------------------------- | ------------------------------------ |
| ![Cash flow](docs/screenshots/cashflow.png) | ![Loans](docs/screenshots/loans.png) |
| ![Property](docs/screenshots/property.png)  |                                      |

### Supported statement formats

| Bank             | Format                                                 |
| ---------------- | ------------------------------------------------------ |
| Fio banka        | CSV (Internetbanking export)                           |
| Revolut          | CSV (account statement)                                |
| mBank            | CSV (elektroniczne zestawienie operacji, windows-1250) |
| Raiffeisenbank   | PDF (text layer, no OCR)                               |
| Česká spořitelna | PDF (text layer, no OCR)                               |

Statements are deduplicated by content and by transaction, so re-uploading
overlapping exports is always safe — that is the intended way to backfill
years of history.

## Install (Docker)

```sh
curl -O https://raw.githubusercontent.com/robertkiewisz/continuum/main/compose.yaml
docker login   # the kerth92/continuum image is private for now
POSTGRES_PASSWORD=change-me docker compose up -d
```

Open `http://your-server` (port 80 by default; set `CONTINUUM_PORT` in `.env`
if something else already owns it) and follow the setup wizard. Everything —
people, base currency (CZK, EUR or PLN), modules — is configured there, not in
files.

Backups: Settings → Backups writes one restorable database dump
(`continuum-backup.sql`, overwritten on every run) plus a copy of every
uploaded file to a folder of your choosing, weekly or monthly. By default that
is the `continuum-backups` volume; point `CONTINUUM_BACKUPS` (in `.env`) at a
cloud-synced folder on the host — a Google Drive or Dropbox directory — and
the sync client carries the backup off-machine and keeps the dump's version
history on its side:

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

Demo mode: `DEMO=1 docker compose up -d` on a pristine instance seeds a
fictional household — six months of categorised cash flow, two flats on one
shared mortgage, payslips, a portfolio — so you can look around before
importing anything real. Sign in as Jana Nováková with `demo-demo-demo`. An
instance that already has people is never touched.

## Reaching it by name

Typing `ip:port` stops working the moment the router hands the server a new
address. Two steps fix it for every device on the network, no cloud involved:

1. **Pin the address.** In the router's DHCP settings, give the server a
   reservation (a fixed lease for its MAC address). This is the actual cure
   for the rotating IP — do it even if you skip step 2.
2. **Name it.** Either set the server machine's hostname to `continuum`, and
   mDNS makes it reachable as **`http://continuum.local`** from macOS, iOS,
   Windows and recent Android with zero configuration — or, if your router
   offers local DNS names, give the reservation a name there (`continuum.lan`
   on most). A Pi-hole or AdGuard Home works too, with a custom DNS record.

The app sits on plain port 80 by default, so the name alone is the whole
address — just tell it what that address is:

```sh
# .env
ORIGIN=http://continuum.local
```

`ORIGIN` must match whatever address you actually browse to — form
submissions are origin-checked and will be refused otherwise. A bare
`continuum` without a suffix is not reliable in browsers (it reads as a
search), so `.local` or your router's suffix is the practical spelling.

## API

Settings → API tokens creates a bearer token (shown once) that grants
read-only access to the whole ledger under `/api/v1` — accounts, transactions
(accepting the register's filter params), categories, tags, net worth and
cash-flow totals. Every amount crosses the wire as integer minor units plus a
currency code, never a float:

```sh
curl -H "Authorization: Bearer <token>" http://your-server/api/v1/networth
# { "total": { "amountMinor": 646055100, "currency": "CZK" }, … }
```

There are no write endpoints and no webhooks — a household produces a handful
of events a week, so a dashboard polls.

## Development

```sh
docker compose up -d db        # Postgres
cp .env.example .env
npm install
npm run dev
```

- `npm test` — unit tests (parsers, pairing, categoriser, chart layout)
- `npm run test:e2e` — Playwright journey (needs the db and `npm run build` first)
- `npm run check` / `npm run lint` — types and style

Real bank statements for parser development belong in
`bank_data_examples_do_not_share/` (gitignored). The committed test fixtures in
`tests/fixtures/` are synthetic and anonymised — keep it that way.

## License

PolyForm Noncommercial — free to self-host and modify for personal,
noncommercial use.
