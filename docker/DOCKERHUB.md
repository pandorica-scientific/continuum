# Continuum

Self-hosted household finance for one home server: bank statements in, decisions out.

Continuum is a private ledger your household runs at home. It reads the statements your
banks actually produce, pairs the transfers between your own accounts, categorises
deterministically (rules you can read, corrections it learns), and turns the result into
a true net worth statement — each flat side by side with its mortgage, portfolio,
cash, and loans.

![Overview — the cash-flow waterfall](https://raw.githubusercontent.com/robertkiewisz/continuum/main/docs/screenshots/overview.png)

## What it does

- **Statement import** for Fio, Revolut, mBank (cp1250 CSV), Raiffeisenbank and
  Česká spořitelna (text-layer PDF) — idempotent, safe to re-upload, full history backfill
- **Cash flow** — a waterfall from income to what you kept, with an explainable rule
  engine (no ML, every decision has a reason)
- **Net worth** — assets beside the debts held against them; one mortgage can secure
  several flats at explicit shares
- **Loans** — per-fixation rates and payments, day-count conventions per loan
  (30/360, act/365, act/360; verified to the haléř against real ČS statements),
  what-if dialogs that preview a repayment or a re-fix offer before saving it
- **Property** — flats with drawable floor plans (physical dimensions), tenancies,
  bills with attached documents, photos
- **Investments** — broker report upload behind an adapter seam (XTB first),
  reconstructed value curve without any market-data subscription
- **Retirement & salary** — projection model plus a payslip-fed salary tracker
  (amounts read themselves from the PDF; corrections teach it)
- **Documents** — shelves, expiry dates, emergent tags and subjects
- **Home Assistant** — devices, climate and energy behind a pluggable provider interface
- **Calendar** — events generated from your data, published as an ics feed
- **Backups** — one restorable dump plus every uploaded file, written straight into a
  cloud-synced folder (Google Drive / Dropbox mount) on your schedule

![Loans — interest vs principal](https://raw.githubusercontent.com/robertkiewisz/continuum/main/docs/screenshots/loans.png)

## Quick start

```sh
curl -O https://raw.githubusercontent.com/robertkiewisz/continuum/main/compose.yaml
POSTGRES_PASSWORD=change-me docker compose up -d
```

Open `http://your-server:3000` and follow the setup wizard. Want to look around
first? `DEMO=1 docker compose up -d` on a pristine instance seeds a fictional
household — sign in as _Jana Nováková_ / `demo-demo-demo`.

## Volumes & environment

|                |                                                            |
| -------------- | ---------------------------------------------------------- |
| `/data`        | uploaded files: documents, photos, original statements     |
| `/backups`     | backup destination — bind-mount a cloud-synced host folder |
| `DATABASE_URL` | PostgreSQL connection (compose wires this)                 |
| `ORIGIN`       | the URL the server is reached at                           |
| `DEMO`         | `1` seeds demo data on a pristine instance                 |

Everything else — people, base currency (CZK/EUR/PLN), modules, integrations — is
configured in the app and stored in your own database. Nothing calls home.

## Tags

- `latest` — current build from `main` (amd64 + arm64)
- `0.2.0` — transaction register, splits & tags, self-correcting rules engine, read-only API, tax statements, entity-linked documents
- `0.1.0` — first published version

## License

[PolyForm Noncommercial 1.0.0](https://github.com/robertkiewisz/continuum/blob/main/LICENSE.md) —
free for personal self-hosting; commercial use needs a separate licence.
