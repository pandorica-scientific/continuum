# Install and configuration

Docker and Docker Compose are the supported route. Podman, Proxmox, TrueNAS,
Umbrel and Unraid packaging are planned.

## Quick start

Two files: the Compose file, and the small serve config the Tailscale sidecar
mounts.

```sh
mkdir continuum && cd continuum
curl -O https://raw.githubusercontent.com/pandorica-scientific/continuum/main/compose.yaml
curl --create-dirs -o docker/tailscale-serve.json \
  https://raw.githubusercontent.com/pandorica-scientific/continuum/main/docker/tailscale-serve.json
POSTGRES_PASSWORD=change-me docker compose up -d
```

Open `http://your-server` (port 80 by default) and follow the setup wizard.
Everything — people, base currency (CZK, EUR or PLN), which modules are on — is
configured there, not in files.

Skipping Tailscale? Then the second file is not needed: `docker compose up -d app
db` starts the app and the database on their own.

## Where the image comes from

Compose pulls a published image; nothing is built on your machine.

| Registry                                                           | Image                                    |
| ------------------------------------------------------------------ | ---------------------------------------- |
| [Docker Hub](https://hub.docker.com/r/kerth92/continuum) — primary | `kerth92/continuum`                      |
| GitHub Container Registry — mirror, same build                     | `ghcr.io/pandorica-scientific/continuum` |

Each release publishes its version tag and moves `latest` onto it, for
`linux/amd64` and `linux/arm64`. `compose.yaml` uses `kerth92/continuum:latest`;
edit that one `image:` line to pin a version (`kerth92/continuum:0.4.0`) or to
pull from the mirror instead.

To check what is actually running:

```sh
docker inspect --format '{{index .Config.Labels "org.opencontainers.image.version"}}' kerth92/continuum:latest
```

The image needs three things: a PostgreSQL 17 database, `/data` for uploaded
files and `/backups` for backups. `compose.yaml` wires all three, which is why
it is the shortest way in — but nothing stops you wiring them yourself.

## Without Compose

Two containers on a shared network, no files to download:

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
  -e ORIGIN='http://localhost' \
  -v continuum-data:/data \
  -v continuum-backups:/backups \
  kerth92/continuum:latest
```

The named volumes are created on first use. The app runs its own migrations at
boot, so there is no separate database step — open `http://localhost` and the
setup wizard is there.

> [!IMPORTANT]
> `change-me` appears in both commands and the two must match. Postgres sets that
> password when it initialises its volume; the app authenticates with it. Change
> it in one place only and the app starts, fails to authenticate, and exits —
> `docker logs continuum` shows `password authentication failed for user
"continuum"`. Percent-encode `@`, `:`, `/` and `#` if your password contains
> them, because `DATABASE_URL` is a URL.

Postgres reads `POSTGRES_PASSWORD` only while its data directory is empty, so
changing the password afterwards means `ALTER USER continuum PASSWORD …` inside
the database container, not editing the variable.

Keep `--restart unless-stopped` on the app container. It connects to the database
at start rather than on the first request, so a database that is not up yet ends
the process, and the restart policy is what brings it back.

`ORIGIN` is optional and only governs passkeys. Sign-in works at whatever
address you browse to, because form submissions are checked against that
address rather than against a configured one. If you do set it — to turn
passkeys on — it must be the address you actually type, port included: map `-p
8080:3000` and it is `http://localhost:8080`, browse to a LAN name and it is
`http://continuum.local`. Add `-e DEMO=1` to the app container to seed the demo
household described below, and point the `/backups` mount at a host folder to
have backups land somewhere cloud-synced.

Nothing above serves HTTPS, so the passkey controls stay absent until you add
it — either `tailscale serve --bg 80` on the host, or the sidecar as a third
container ([below](#tailscale)).

Upgrading is a pull and a re-create; the volumes carry the data:

```sh
docker pull kerth92/continuum:latest
docker rm -f continuum
# then re-run the app container above
```

## What it needs

Measured on a running instance: about 191 MB of memory for the app and 69 MB for
Postgres — roughly **300 MB** for the pair, from a **393 MB** image.

A Raspberry Pi 4 or 5 with 2 GB on a 64-bit OS runs it comfortably, as does any
x86 mini PC or NAS. There is no 32-bit (`armv7`) build, so a Raspberry Pi 3 or
older will not run it.

Importing a scanned or photographed statement is the heaviest thing it does. That
work runs in a background queue, so on a small machine it slows the import down
rather than blocking the interface.

## Try it first

```sh
DEMO=1 docker compose up -d
```

On a pristine instance this seeds a fictional household — six months of
categorised cash flow, two flats on one shared mortgage, payslips, a portfolio.
Sign in as Jana Nováková with `demo-demo-demo`. An instance that already has
people is never touched, and every screenshot in the gallery comes from exactly
this data.

## Tailscale

`docker compose up -d` also brings up a **Tailscale sidecar**, because HTTPS is
what makes passkeys possible and a home server has no other easy route to a
trusted certificate. It is tailnet-only, and until you authenticate it the sidecar
simply idles while the app stays reachable on the port above. See
[Networking and passkeys](networking.md).

Without Compose it is a third container on the same network. `tailscale/tailscale`
is on Docker Hub like everything else here — nothing is built locally:

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
tailscale status` tells you when it is up.

`http://continuum:3000` is the app container by name on the `continuum` network —
the Compose sidecar proxies to `http://app:3000` instead, because there the
service is called `app`. The `serve` command stores its configuration in the state
volume, which is why this path needs no `serve.json` on disk.

Leave out `TS_AUTHKEY` if you would rather authenticate by hand: the container
prints a login URL to `docker logs continuum-ts`.

Finish by telling the app the name Tailscale issued — passkeys are verified
against it exactly, so this is not optional:

```sh
docker rm -f continuum
# re-run the app container with
#   -e ORIGIN='https://continuum.<your-tailnet>.ts.net'
```

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

## Upgrading

Take a backup, then pull and restart:

```sh
docker compose pull
docker compose up -d
```

Database migrations run before the app accepts requests. Release-specific data
repairs and any manual considerations are listed at the top of
[CHANGELOG.md](../CHANGELOG.md).
