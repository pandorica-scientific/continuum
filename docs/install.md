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
edit that one `image:` line to pin a version (`kerth92/continuum:0.3.10`) or to
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

`ORIGIN` must be the address you actually type, port included: map `-p
8080:3000` and it is `http://localhost:8080`, browse to a LAN name and it is
`http://continuum.local`. Add `-e DEMO=1` to the app container to seed the demo
household described below, and point the `/backups` mount at a host folder to
have backups land somewhere cloud-synced.

There is no Tailscale in this path, so the origin is plain HTTP and the passkey
controls stay absent — `tailscale serve --bg 80` on the host adds HTTPS later
without touching either container. See [Networking and passkeys](networking.md).

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

## Environment variables

All optional, all in `.env` next to `compose.yaml`.

| Variable               | Default             | What it does                                                                                                                                        |
| ---------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD`    | `continuum`         | Database password. Set this.                                                                                                                        |
| `CONTINUUM_PORT`       | `80`                | Host port, if something else already owns 80.                                                                                                       |
| `ORIGIN`               | `http://localhost`  | The address you actually browse to. Form submissions are origin-checked.                                                                            |
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
