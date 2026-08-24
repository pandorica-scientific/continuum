# Install and configuration

Docker and Docker Compose are the supported route. Podman, Proxmox, TrueNAS,
Umbrel and Unraid packaging are planned.

## Before you start

Continuum is two containers — the app and a PostgreSQL 17 database — and about
**300 MB** of memory between them, measured on a running instance: 191 MB for
the app, 69 MB for Postgres, from a 393 MB image.

A Raspberry Pi 4 or 5 with 2 GB on a 64-bit OS runs it comfortably, as does any
x86 mini PC or NAS. There is no 32-bit (`armv7`) build, so a Raspberry Pi 3 or
older will not run it.

Importing a scanned or photographed statement is the heaviest thing it does.
That work runs in a background queue, so on a small machine it slows the import
down rather than blocking the interface.

## Install

**1. Fetch the two files** — the Compose file, and the small serve config the
Tailscale sidecar mounts.

```sh
mkdir continuum && cd continuum
curl -O https://raw.githubusercontent.com/pandorica-scientific/continuum/main/compose.yaml
curl --create-dirs -o docker/tailscale-serve.json \
  https://raw.githubusercontent.com/pandorica-scientific/continuum/main/docker/tailscale-serve.json
```

**2. Start it,** with a database password of your own.

```sh
POSTGRES_PASSWORD=change-me docker compose up -d
```

**3. Open `http://your-server`** — port 80 by default — and follow the setup
wizard. Everything is configured there rather than in files: people, base
currency (CZK, EUR or PLN), and which modules are on.

That is the whole installation. Nothing is built on your machine, and the app
runs its own database migrations at boot, so there is no separate database step.

Two things worth knowing now rather than later:

- **Keep `POSTGRES_PASSWORD` somewhere.** Postgres only reads it while its data
  directory is empty, so it is set once, on the very first start, and changing
  the variable afterwards does nothing. See [Troubleshooting](#troubleshooting).
- **Port 80 is the default** because it makes the address just
  `http://continuum.local`. If something already owns 80, put
  `CONTINUUM_PORT=3000` in a `.env` file beside `compose.yaml`; Compose fails
  loudly on a collision rather than starting somewhere unexpected.

Skipping Tailscale? Then step 1 needs only `compose.yaml`, and step 2 is
`docker compose up -d app db`.

## Demo data

Add `DEMO=1` to the start in step 2, or to `.env`:

```sh
DEMO=1 POSTGRES_PASSWORD=change-me docker compose up -d
```

On a pristine instance this seeds a fictional household — six months of
categorised cash flow, two flats on one shared mortgage, payslips, a portfolio.
Sign in as Jana Nováková with `demo-demo-demo`. An instance that already has
people is never touched, and every screenshot in the gallery comes from exactly
this data.

## HTTPS and passkeys

Passkeys need HTTPS: browsers refuse WebAuthn outside a secure context, so on a
plain-HTTP address the passkey controls are simply absent. Everything else works
without it.

`docker compose up -d` therefore also brings up a **Tailscale sidecar**, which is
a home server's easiest route to a trusted certificate. It is tailnet-only —
`tailscale funnel`, the command that would expose the app to the open internet,
is not run anywhere here — and until you authenticate it the sidecar simply idles
while the app stays reachable on the port above.

1. `docker compose logs tailscale` prints a login URL; visit it. Setting
   `TS_AUTHKEY` in `.env` instead authenticates unattended and skips this step.
2. Put the name Tailscale issues in `.env` and restart:
   `ORIGIN=https://continuum.<your-tailnet>.ts.net`.

Step 2 is not optional if you want passkeys — they are bound to that exact
address. `ORIGIN` governs nothing else: ordinary sign-in already works at every
address the server answers on, because form submissions are checked against the
address your browser actually used. See [Networking and passkeys](networking.md).

Once a passkey sign-in over the tailnet works, you can drop the port mapping from
`compose.yaml` and make Tailscale the only way in.

## Upgrading

Take a backup, then pull and restart. The volumes carry the data:

```sh
docker compose pull
docker compose up -d
```

Database migrations run before the app accepts requests. Release-specific data
repairs and any manual considerations are listed at the top of
[CHANGELOG.md](../CHANGELOG.md).

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
edit that one `image:` line to pin a version (`kerth92/continuum:0.5.0`) or to
pull from the mirror instead.

To check what is actually running:

```sh
docker inspect --format '{{index .Config.Labels "org.opencontainers.image.version"}}' kerth92/continuum:latest
```

The image needs three things: a PostgreSQL 17 database, `/data` for uploaded
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
  -v continuum-db:/var/lib/postgresql/data \
  postgres:17-alpine

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
