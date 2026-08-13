# Continuum

A self-hosted household finance server. Import bank statements, watch where the
money goes, and keep everything — accounts, property, loans, investments,
documents — in one place on your own hardware. Nothing calls home.

Continuum is built for households, not companies: two people, a few banks in a
few currencies, a flat or two, and the question that actually matters — _what
is our net worth right now, and is it going up?_

## Status

Phase 1 (the money core) is functional: setup wizard, per-person sign-in,
statement import for five banks, automatic categorisation that learns from
your corrections, transfer pairing across your own accounts, the cash-flow
waterfall, and multi-currency accounts with daily CNB rates. Property, loans,
investments, retirement, calendar, documents and Home Assistant are on the
roadmap (Phases 2–4).

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
POSTGRES_PASSWORD=change-me docker compose up -d
```

Open `http://your-server:3000` and follow the setup wizard. Everything —
people, base currency (CZK, EUR or PLN), modules — is configured there, not in
files.

Backups: everything lives in the `continuum-db` and `continuum-data` Docker
volumes.

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
