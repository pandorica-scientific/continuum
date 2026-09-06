# Continuum

Your household's whole financial picture, on hardware you own.

Continuum reads the statements your banks already give you — CSV, Excel, PDF,
CAMT, MT940, OFX, a photo of a printout — without being told which bank wrote
them, checks what it read against the statement's own balances, and connects
the money to everything around it: the property, the mortgage secured against
it, the tenants, the portfolio, the payslips, and the taxes. Two people, one
shared ledger, separate sign-ins and dashboards. Nothing calls home.

![Cash flow](https://raw.githubusercontent.com/pandorica-scientific/continuum/main/docs/screenshots/cashflow-dark-web.png)

## Install

Two commands on a machine with Docker that stays on:

```sh
docker run --rm kerth92/continuum compose > compose.yaml
docker compose up -d
```

The first line writes the Compose file carried inside this image. The second
starts the app, its database and an announcer that names the machine
`continuum.local` on your network — and, run again later, is also the update.
Open `http://continuum.local` from any device in the house and follow the
setup wizard.

Add `DEMO=1` to look around a fictional household first — sign in as
_Jana Nováková_ / `demo-demo-demo`.

Full instructions, every setting and troubleshooting:
[docs/install.md](https://github.com/pandorica-scientific/continuum/blob/main/docs/install.md).

## Volumes and environment

The Compose file wires all of these. For running the image on its own:

|                                               |                                                                               |
| --------------------------------------------- | ----------------------------------------------------------------------------- |
| `/data`                                       | uploaded files: documents, photos, original statements                        |
| `/backups`                                    | backup destination — mount a cloud-synced host folder                         |
| `DATABASE_URL`                                | PostgreSQL 18 connection string                                               |
| `DEMO`                                        | `1` seeds demo data on a pristine instance                                    |
| `BODY_SIZE_LIMIT`                             | largest accepted upload (default `32M`)                                       |
| `ADDRESS_HEADER`                              | read the client address from a forwarded header — only behind a trusted proxy |
| `PASSWORD_MIN_LENGTH`, `ENROLLMENT_LINK_DAYS` | household security policy (defaults `8`, `7`)                                 |

The image also runs the announcer: `docker run --network host kerth92/continuum mdns`
answers `continuum.local` (or `CONTINUUM_NAME`) with the host's address.

Everything else — people, base currency, modules, integrations, backup
cadence — is configured in the app and stored in your own database.

## Tags

`latest` is the current release and the only tag the Compose file uses. Each
release is also published under its version number. Both for `linux/amd64` and
`linux/arm64`, and mirrored at `ghcr.io/pandorica-scientific/continuum`.

## License

[GNU AGPL v3.0 or later](https://github.com/pandorica-scientific/continuum/blob/main/LICENSE) —
free to run, modify and share; a modified version other people use must offer
them its source.
