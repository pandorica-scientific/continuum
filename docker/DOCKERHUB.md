# Continuum

Self-hosted household finance for one home server: bank statements in, decisions out.

Continuum is a private ledger your household runs at home. It reads the statements your
banks actually produce, pairs the transfers between your own accounts, categorises
deterministically (rules you can read, corrections it learns), and turns the result into
a true net worth statement — each flat side by side with its mortgage, portfolio,
cash, and loans.

![Overview — the cash-flow waterfall](https://raw.githubusercontent.com/pandorica-scientific/continuum/main/docs/screenshots/overview.png)

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

![Loans — interest vs principal](https://raw.githubusercontent.com/pandorica-scientific/continuum/main/docs/screenshots/loans.png)

## Quick start

```sh
curl -O https://raw.githubusercontent.com/pandorica-scientific/continuum/main/compose.yaml
POSTGRES_PASSWORD=change-me docker compose up -d
```

Open `http://your-server` and follow the setup wizard. Want to look around
first? `DEMO=1 docker compose up -d` on a pristine instance seeds a fictional
household — sign in as _Jana Nováková_ / `demo-demo-demo`.

## Volumes & environment

|                |                                                               |
| -------------- | ------------------------------------------------------------- |
| `/data`        | uploaded files: documents, photos, original statements        |
| `/backups`     | backup destination — bind-mount a cloud-synced host folder    |
| `DATABASE_URL` | PostgreSQL connection (compose wires this)                    |
| `ORIGIN`       | the URL the server is reached at; `https://` enables passkeys |
| `DEMO`         | `1` seeds demo data on a pristine instance                    |
| `TS_AUTHKEY`   | Tailscale auth key, for the optional `tailscale` profile      |

Operational overrides are optional:

|                        |                                                                                                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CONTINUUM_MAX_UPLOAD` | largest accepted upload (default `32M`); phone photos need more than the server's own 512K default                                                                               |
| `ADDRESS_HEADER`       | read the client address from a forwarded header — set only behind a trusted proxy that always overwrites it, or a caller can forge it and step around authentication rate limits |
| `XFF_DEPTH`            | trusted `X-Forwarded-For` hop counted from the right (default `1`); change only for a known multi-proxy chain                                                                    |
| `PASSWORD_MIN_LENGTH`  | minimum password length (default `8`)                                                                                                                                            |
| `ENROLLMENT_LINK_DAYS` | lifetime of a one-time household enrollment link (default `7`)                                                                                                                   |

Everything else — people, base currency (CZK/EUR/PLN), modules, integrations — is
configured in the app and stored in your own database. Nothing calls home.

## Tags

- `latest` — current build from `main` (amd64 + arm64)
- `0.3.3` — atomic imports and mutations, concurrency-safe authentication and autosave, dated multi-currency totals, and the full-review remediation
- `0.3.2` — two whole-codebase reviews: a server-side WebAuthn challenge store, currency-correct amounts, and a long list of silently wrong figures put right
- `0.3.1` — hardening of the accounts work: enrollment, roles and passkey origins
- `0.3.0` — passkeys, account management and roles; **breaking**, see the changelog
- `0.2.1` — port 80 by default; reachable as `http://continuum.local` behind a LAN name
- `0.2.0` — transaction register, splits & tags, self-correcting rules engine, read-only API, tax statements, entity-linked documents
- `0.1.0` — first published version

## License

[PolyForm Noncommercial 1.0.0](https://github.com/pandorica-scientific/continuum/blob/main/LICENSE.md) —
free for personal self-hosting; commercial use needs a separate licence.
