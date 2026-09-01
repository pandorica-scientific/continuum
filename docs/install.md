# Install and configuration

Docker and Docker Compose are the supported route. Podman, Proxmox, TrueNAS,
Umbrel and Unraid packaging are planned.

## Before you start

Continuum is two containers — the app and a PostgreSQL 18 database — and about
**300 MB** of memory between them, measured on a running instance: 191 MB for
the app, 69 MB for Postgres, from a 393 MB image.

A Raspberry Pi 4 or 5 with 2 GB on a 64-bit OS runs it comfortably, as does any
x86 mini PC or NAS. There is no 32-bit (`armv7`) build, so a Raspberry Pi 3 or
older will not run it.

Importing a scanned or photographed statement is the heaviest thing it does.
That work runs in a background queue, so on a small machine it slows the import
down rather than blocking the interface.

## Install

**1. Fetch the Compose file.** It is the only file you need — nothing else is
downloaded and nothing is built on your machine.

```sh
mkdir continuum && cd continuum
curl -O https://raw.githubusercontent.com/pandorica-scientific/continuum/main/compose.yaml
```

**2. Start it,** with a database password of your own.

```sh
POSTGRES_PASSWORD=change-me docker compose up -d
```

**3. Open `http://your-server`** — port 80 by default — and follow the setup
wizard. Everything is configured there rather than in files: people, base
currency (CZK, EUR or PLN), and which modules are on.

**4. Turn on HTTPS** if you want to use Continuum from a phone or tablet — see
below. The document scanner's camera and passkey sign-in both need it, and
neither can work over a plain-http LAN address.

That is the whole installation. The published image is pulled from Docker Hub,
and the app runs its own database migrations at boot, so there is no build step
and no separate database step.

Two things worth knowing now rather than later:

- **Keep `POSTGRES_PASSWORD` somewhere.** Postgres only reads it while its data
  directory is empty, so it is set once, on the very first start, and changing
  the variable afterwards does nothing. See [Troubleshooting](#troubleshooting).
- **Port 80 is the default** because it makes the address just
  `http://continuum.local`. If something already owns 80, put
  `CONTINUUM_PORT=3000` in a `.env` file beside `compose.yaml`; Compose fails
  loudly on a collision rather than starting somewhere unexpected.

## Demo data

Add `DEMO=1` to the start in step 2, or to `.env`:

```sh
DEMO=1 POSTGRES_PASSWORD=change-me docker compose up -d
```

On a pristine instance this seeds a fictional household — six months of
categorised cash flow, two flats on one shared mortgage, payslips, a portfolio.
Sign in as Jana Nováková with `demo-demo-demo`. An instance that already has
people is never touched, and the demo data behind the screenshots in the gallery
is this seed — which has grown since they were taken, so a fresh demo has more
paper and one more account on it than the pictures show.

The paper is real: the seed generates a small PDF for every document it files —
payslips, the lease, two bank statements, a broker report, three receipts, an
insurance policy, a restricted identity card, and the warranty and vaccination
certificate belonging to its two subjects — so the viewer, search by contents,
receipts and the restricted-document rule all have something to show. Every
figure printed on those pages comes from the demo's own fictional data and
nothing else.

## HTTPS

Two features refuse to run outside a secure context, because browsers refuse
them: **the scanner's camera** and **passkey sign-in**. On the server machine
itself `http://localhost` already counts as one, so both work there. From any
other device — which is where you actually scan paperwork — they need HTTPS.

Nothing else does. Password sign-in, uploads and every other screen work over
plain http at whatever address the server answers on, and **the scan itself is
unchanged** there: the scan button hands over to the phone's own camera app,
which needs no secure context, and the photo comes back through the same
detection, cropping and flattening.

What HTTPS buys is the shooting, not the scanning — an outline showing what has
been found while you aim, the torch, and staying inside the app between pages
rather than a round trip out to the camera app for every one. On a single receipt
that is a convenience. On a ten-page tenancy agreement it is the difference
between one sitting and twenty taps.

Pick whichever route suits you. Both are in the Compose file already.

### Tailscale — a trusted certificate, no domain of your own

The better answer for daily use: the certificate comes from Let's Encrypt, so
nothing warns, on any device. Tailscale is a private mesh — only devices you
have added can reach the machine, and `tailscale funnel`, the command that would
expose the app to the open internet, is not run anywhere here.

The sidecar is already running — it comes up with `docker compose up -d` and
idles until you authenticate it:

```sh
docker compose logs tailscale        # visit the login URL it prints
```

Setting `TS_AUTHKEY` in `.env` instead authenticates unattended and skips this
step entirely. Either way, finish by telling the app the name Tailscale issued,
because a passkey is bound to exactly that address:

```sh
# .env
ORIGIN=https://continuum.<your-tailnet>.ts.net
```

Once a passkey sign-in over the tailnet works, you can drop the `ports:` block
from the `app` service and make Tailscale the only way in.

### LAN — no account, no domain, one warning

Quicker, and entirely local. Give it the address you actually type — a name or a
LAN IP, but it must match, because a certificate issued for a different one is
rejected outright rather than warned about:

```sh
# .env
CONTINUUM_HOST=continuum.local

docker compose --profile lan-tls up -d
```

Then open **https://continuum.local:8443**.

The certificate is issued by Caddy's own authority, which no device trusts, so
every browser warns once. **Accept it and everything works** — from then on the
origin is a secure context as far as the browser is concerned, which is all the
camera and passkeys require. Set `ORIGIN=https://continuum.local:8443` to turn
the passkey controls on too.

To stop the warning, install Caddy's root certificate on each device and mark it
trusted — [Networking](networking.md#the-camera-needs-https-too) has the steps,
including the second, easy-to-miss step on iOS.

`ORIGIN` governs passkeys and nothing else: ordinary sign-in already works at
every address the server answers on, because form submissions are checked
against the address your browser actually used.

## Upgrading

**0.7.1 is a fresh-install release.** Pulling the image does **not** migrate a
database you already have. The schema for this release was rewritten in one
file rather than added to as a new step, so the migrator finds nothing new to
apply and leaves an existing 0.6.2 or 0.7.0 database exactly as it was. The app
notices at boot and refuses to serve rather than starting against a schema it
cannot work with — you would otherwise find out at the first statement import.

So there are two supported ways onto 0.7.1: start it on an empty database (or
with `DEMO=1`, which fills a new instance with the fictional household), or
take a backup and run the SQL in the ⬆️ Upgrading block of
[CHANGELOG.md](../CHANGELOG.md) against your database by hand first. That
script brings the schema up to what this release expects — it removes the three
columns that left, gives each import the id of the statement it read, and
promotes the two shelves the code files into — and only then is a pull and
restart the right move.

For a release that ships an ordinary migration, taking a backup and then
pulling and restarting is all there is to it; the volumes carry the data and
the migrations run before the app accepts requests:

```sh
docker compose pull
docker compose up -d
```

**`compose.yaml` now pins `postgres:18.6-alpine`, and a database major version
is not something a pull can change.** Postgres refuses to start on a data
directory written by an older major — `database files are incompatible with
server` — so an instance created while this file said `17-alpine` needs its data
carried across deliberately rather than pulled over. Two ways through it:

- **Stay on 17 for now.** Put `image: postgres:17-alpine` back on the `db`
  service in your own copy of `compose.yaml`. Nothing in the application asks
  for 18; the pin moved so that what is served matches what is tested.
- **Move the data.** Dump, start 18.6 on a new volume, restore — the sequence is
  in [Without Compose](#without-compose) below, with `docker compose exec db` in
  place of `docker exec continuum-db`. Keep the old volume until the new one has
  served for a few days.

Release-specific data repairs and any manual considerations are listed at the
top of [CHANGELOG.md](../CHANGELOG.md).

## Troubleshooting

**Every page is a 500, and `docker compose logs app` says `password
authentication failed for user "continuum"`.** The password the app sends is not
the one the database was built with. Postgres reads `POSTGRES_PASSWORD` only
while its data directory is empty, and removing containers does not remove named
volumes — so a database volume left behind by an earlier install keeps its
original password and silently ignores the new one, on an instance whose
commands look perfectly right. Either start this install on a fresh volume, or
set the password on the database you already have:

```sh
docker compose exec db psql -U continuum -d continuum \
  -c "ALTER USER continuum PASSWORD 'change-me'"
```

Testing that password with `psql` _inside_ the database container will not tell
you anything: the official Postgres image trusts connections from `127.0.0.1`, so
every password appears to work. Test across the network, or just read the app's
log.

**The app started before the database was ready.** Nothing to do. While the
database is unreachable the app serves an error page and keeps trying, and begins
working on its own once the database answers.

**The passkey controls are missing.** The address you are browsing is not HTTPS,
or `ORIGIN` does not match it exactly. See [HTTPS and passkeys](#https-and-passkeys).

**A password with `@`, `:`, `/` or `#` in it fails.** Only when you write
`DATABASE_URL` yourself, as in [Without Compose](#without-compose): it is a URL,
so those characters have to be percent-encoded.

## Environment variables

All optional, all in `.env` next to `compose.yaml`.

| Variable               | Default             | What it does                                                                                                                                        |
| ---------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD`    | `continuum`         | Database password. Set this.                                                                                                                        |
| `CONTINUUM_PORT`       | `80`                | Host port, if something else already owns 80.                                                                                                       |
| `ORIGIN`               | unset               | Optional. The one `https://` address passkeys are bound to; sign-in works at every address without it.                                              |
| `CONTINUUM_MAX_UPLOAD` | `32M`               | Largest accepted upload. A phone photo does not fit the server's own 512 KB default.                                                                |
| `CONTINUUM_BACKUPS`    | `continuum-backups` | Host folder for backups — point it at a cloud-synced directory.                                                                                     |
| `DEMO`                 | unset               | `1` seeds the demo household on a pristine instance.                                                                                                |
| `TS_AUTHKEY`           | unset               | Authenticates the Tailscale sidecar unattended.                                                                                                     |
| `ADDRESS_HEADER`       | unset               | `x-forwarded-for` makes the app read the real client address from a forwarded header, which authentication rate limits need behind a reverse proxy. |
| `XFF_DEPTH`            | `1`                 | Trusted hop counted from the right of `X-Forwarded-For`.                                                                                            |
| `PASSWORD_MIN_LENGTH`  | `8`                 | Enforced by the server and shown in the interface from the same value.                                                                              |
| `ENROLLMENT_LINK_DAYS` | `7`                 | Lifetime of a new person's enrollment link.                                                                                                         |

> [!WARNING]
> Set `ADDRESS_HEADER` and `XFF_DEPTH` only where that proxy chain is the only way
> in and always overwrites the header. Otherwise a caller can forge its address and
> slip the sign-in rate limiter.

## Where the image comes from

| Registry                                                           | Image                                    |
| ------------------------------------------------------------------ | ---------------------------------------- |
| [Docker Hub](https://hub.docker.com/r/kerth92/continuum) — primary | `kerth92/continuum`                      |
| GitHub Container Registry — mirror, same build                     | `ghcr.io/pandorica-scientific/continuum` |

Each release publishes its version tag and moves `latest` onto it, for
`linux/amd64` and `linux/arm64`. `compose.yaml` uses `kerth92/continuum:latest`;
edit that one `image:` line to pin a version (`kerth92/continuum:0.7.9`) or to
pull from the mirror instead.

To check what is actually running:

```sh
docker inspect --format '{{index .Config.Labels "org.opencontainers.image.version"}}' kerth92/continuum:latest
```

The image needs three things: a PostgreSQL 18 database, `/data` for uploaded
files and `/backups` for backups. `compose.yaml` wires all three, which is why it
is the shortest way in — but nothing stops you wiring them yourself.

## Without Compose

Two containers on a shared network, no files to download. `change-me` appears in
both commands and the two must match.

```sh
docker pull kerth92/continuum:latest

docker network create continuum

docker run -d --name continuum-db --network continuum --restart unless-stopped \
  -e POSTGRES_USER=continuum \
  -e POSTGRES_PASSWORD=change-me \
  -e POSTGRES_DB=continuum \
  -e PGDATA=/var/lib/postgresql/data \
  -v continuum-db:/var/lib/postgresql/data \
  postgres:18.6-alpine

docker run -d --name continuum --network continuum --restart unless-stopped \
  -p 80:3000 \
  -e DATABASE_URL='postgres://continuum:change-me@continuum-db:5432/continuum' \
  -v continuum-data:/data \
  -v continuum-backups:/backups \
  kerth92/continuum:latest
```

The named volumes are created on first use. Open `http://localhost` and the setup
wizard is there.

Additions to the app container, all optional: `-e ORIGIN='https://…'` to bind
passkeys to one HTTPS address, `-e DEMO=1` to seed the demo household, and a host
path in place of the `continuum-backups` volume to have backups land somewhere
cloud-synced.

Keep `--restart unless-stopped` on both so a reboot brings Continuum back. The app
does not have to start after the database.

Upgrading is a pull and a re-create:

```sh
docker pull kerth92/continuum:latest
docker rm -f continuum
# then re-run the app container above
```

The database container is not part of that. Postgres will not read a data
directory written by an older major version, so pulling a new `postgres:` tag
onto an existing volume gives a server that refuses to start —
`database files are incompatible with server` — rather than an upgrade. An
instance created before these instructions said `18.6-alpine` is on 17 and
should stay there until you dump and restore deliberately:

```sh
docker stop continuum                       # stop the only writer first
docker exec continuum-db pg_dumpall -U continuum --roles-only > globals.sql
docker exec continuum-db pg_dump -U continuum -d continuum -Fc > continuum.dump
docker stop continuum-db && docker rename continuum-db continuum-db-old
# re-run the database container above on a NEW volume name, then:
docker exec -i continuum-db psql -U continuum -d postgres < globals.sql
docker exec -i continuum-db pg_restore -U continuum -d continuum \
  --no-owner --clean --if-exists < continuum.dump
docker exec continuum-db psql -U continuum -d continuum -c 'analyze;'
docker start continuum
```

Keep the old container and its volume until the new one has served for a few
days; nothing was written to it after the first line, so renaming it back is a
complete rollback. `analyze` is not optional — a restore carries no planner
statistics, and without it the first month you open is slower than the version
you left.

### Tailscale without Compose

A third container on the same network. `tailscale/tailscale` is on Docker Hub
like everything else here — nothing is built locally:

```sh
docker run -d --name continuum-ts --network continuum --restart unless-stopped \
  --hostname continuum \
  --cap-add NET_ADMIN --device /dev/net/tun \
  -e TS_AUTHKEY='tskey-auth-…' \
  -e TS_STATE_DIR=/var/lib/tailscale \
  -v continuum-ts:/var/lib/tailscale \
  tailscale/tailscale:latest

docker exec continuum-ts tailscale serve --bg --https=443 http://continuum:3000
```

Run the `serve` line only once the container is actually on your tailnet: until
then it answers `Logged out.` and does nothing. `docker exec continuum-ts
tailscale status` tells you when it is up. Leave out `TS_AUTHKEY` if you would
rather authenticate by hand — the container prints a login URL to
`docker logs continuum-ts`.

`http://continuum:3000` is the app container by name on the `continuum` network;
the Compose sidecar proxies to `http://app:3000` instead, because there the
service is called `app`. The `serve` command stores its configuration in the
state volume, which is why this path needs no `serve.json` on disk.

Finish by re-creating the app container with
`-e ORIGIN='https://continuum.<your-tailnet>.ts.net'`, the name Tailscale issued.
Passkeys are verified against it exactly, so this is not optional.
