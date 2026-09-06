# Install and configuration

Continuum runs as three containers from one Compose file: the app, a
PostgreSQL 18 database, and a small announcer that gives the machine a name on
your network. You run two commands; everything else is set up in the app.

## Quick start

On the machine that will run Continuum — a Raspberry Pi, a mini PC, a NAS with
Docker:

```sh
mkdir continuum && cd continuum
docker run --rm kerth92/continuum compose > compose.yaml
docker compose up -d
```

The first line pulls the image from Docker Hub and writes the Compose file it
carries. The second starts everything: the database is created, the schema is
written, and the machine starts answering to `continuum.local`.

Then open **`http://continuum.local`** from any phone, tablet or laptop on the
same network and follow the setup wizard: the first person (an
administrator), the base currency, and which modules are on.

That is the install. The wizard's first card lists every address the machine
answers to, shortest first — on a Pi that is usually `http://raspberrypi/`,
the machine's own name, which most routers already resolve — so you can pick
the one to bookmark. If none of the names resolve on a device — Android
browsers do not do `.local` — the IP address in the same list works anywhere;
[Networking](networking.md) has the router step that fixes the names.

## What it needs

About **300 MB** of memory between the app and the database, from a 393 MB
image built for `linux/amd64` and `linux/arm64`. A Raspberry Pi 4 or 5 with
2 GB on a 64-bit OS runs it comfortably, as does any x86 mini PC or NAS that
runs Docker. There is no 32-bit build.

Reading a scanned or photographed statement is the heaviest thing it does. That
work runs in a background queue, so on a small machine it slows the import down
rather than blocking the interface.

## Demo data

Start with `DEMO=1 docker compose up -d` and a pristine instance comes up with
a fictional household — six months of categorised cash flow, two flats on one
shared mortgage, payslips, a portfolio, and a small PDF behind every filed
document. Sign in as **Jana Nováková** with `demo-demo-demo`. An instance that
already has people is never touched.

## Updating

Take a backup first (Settings → Backups). Then, in the folder with
`compose.yaml`:

```sh
docker compose up -d
```

That is the install command run again: it pulls the newest release, keeps the
database on its current major version, and replaces only what changed. The
named volumes carry the data, and the schema is brought up to date before the
app accepts requests. The Compose file itself rarely changes; when a release
says it does, run the `docker run … compose` line from the quick start again
to refresh it.

## Settings

Everything about the household — people, currency, modules, calendar and
Home Assistant connections, backup cadence — lives in the app under Settings
and in your own database. The few things that have to be known before the app
starts go in a `.env` file next to `compose.yaml`, and all of them are
optional:

| Variable               | Default             | What it does                                                                                                       |
| ---------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `CONTINUUM_NAME`       | `continuum`         | The name before `.local`. Change it to run two instances on one network.                                           |
| `CONTINUUM_PORT`       | `80`                | Host port, if 80 is taken. The address then needs the port: `http://continuum.local:8080`.                         |
| `CONTINUUM_BACKUPS`    | `continuum-backups` | Where backups are written. A cloud-synced folder on the host carries them off-machine — see [Backups](backups.md). |
| `CONTINUUM_MAX_UPLOAD` | `32M`               | Largest accepted upload. A phone photo needs more than the server's own 512 KB default.                            |
| `POSTGRES_PASSWORD`    | `continuum`         | Database password. Read on the very first start only — see [Troubleshooting](#troubleshooting) before changing it. |
| `DEMO`                 | unset               | `1` seeds the demo household on a pristine instance.                                                               |
| `PASSWORD_MIN_LENGTH`  | `8`                 | Enforced by the server and shown in the interface from the same value.                                             |
| `ENROLLMENT_LINK_DAYS` | `7`                 | Lifetime of a new person's enrollment link.                                                                        |
| `ADDRESS_HEADER`       | unset               | Only behind your own reverse proxy — see [Networking](networking.md#your-own-proxy).                               |

The database is not published on any host port, which is why its default
password is acceptable: only the app container can reach it.

## Troubleshooting

**`http://continuum.local` does not open.** First try the server's IP address,
`http://192.168.x.x` (Settings → Self-hosting lists it under "Reachable at").
If that works, the name is the problem: on Android, it
always is — see [Networking](networking.md). On anything else, check that
`docker compose logs mdns` says `answering continuum.local with …` and names an
address on your network; a machine with Docker Desktop rather than Docker on
Linux cannot put the announcer on the network, and answers to its own hostname
instead.

**Every page is a 500, and the app log says `password authentication failed
for user "continuum"`.** The password the app sends is not the one the database
was created with. Postgres reads `POSTGRES_PASSWORD` only while its data
directory is empty, and removing containers does not remove volumes — so a
database volume left behind by an earlier install keeps its original password
and ignores the new one. Either start on a fresh volume, or set the password on
the database you have:

```sh
docker compose exec db psql -U continuum -d continuum \
  -c "ALTER USER continuum PASSWORD 'the-new-one'"
```

**Port 80 is already taken on the host.** Set `CONTINUUM_PORT` in `.env` and
add the port to the address.

**The app started before the database was ready.** Nothing to do. It serves an
error page and keeps trying, and starts working on its own once the database
answers.
