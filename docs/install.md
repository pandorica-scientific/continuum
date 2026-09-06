# Install and configuration

Continuum runs as three containers from one Compose file: the app, a
PostgreSQL 18 database, and a Tailscale sidecar that gives the app a trusted
`https://` address on your private network. You download one file and run one
command; everything else is set up in the app.

## Quick start

**1. Get a Tailscale key.** Sign up at [tailscale.com](https://tailscale.com)
if you have no account — the free plan is enough. In the admin console:

- [Settings → Keys](https://login.tailscale.com/admin/settings/keys) →
  **Generate auth key**. The defaults are fine. Copy it; it is shown once.
- [DNS](https://login.tailscale.com/admin/dns) → **HTTPS certificates** →
  **Enable HTTPS**. This is what lets the app hold a real certificate.

**2. Start it.** On the machine that will run Continuum:

```sh
mkdir continuum && cd continuum
docker run --rm kerth92/continuum compose > compose.yaml
TS_AUTHKEY=tskey-auth-… docker compose up -d
```

The first line pulls the image from Docker Hub and writes the Compose file it
carries. The second starts everything: the database is created, the schema is
written, and the sidecar joins your tailnet as a machine called `continuum` —
all unattended. Within a minute `docker compose logs app` prints the address:

```
Tailscale: reachable at https://continuum.your-tailnet.ts.net
```

**3. Open it.** Install the [Tailscale app](https://tailscale.com/download) on
the phone or laptop you are opening it from and sign in to the same tailnet.
Then open `https://continuum.<your-tailnet>.ts.net` — or type `continuum/`
into the address bar, which lands in the same place — and follow the setup
wizard: the first person (an administrator), the base currency, and which
modules are on.

That is the install. One optional click for a home server: in the admin
console's [Machines](https://login.tailscale.com/admin/machines) list, open
`continuum` and choose **Disable key expiry**, so it never needs signing in
again.

## What it needs

About **300 MB** of memory between the app and the database, from a 393 MB
image built for `linux/amd64` and `linux/arm64`. A Raspberry Pi 4 or 5 with
2 GB on a 64-bit OS runs it comfortably, as does any x86 mini PC or NAS that
runs Docker. There is no 32-bit build.

Reading a scanned or photographed statement is the heaviest thing it does. That
work runs in a background queue, so on a small machine it slows the import down
rather than blocking the interface.

## Demo data

Add `DEMO=1` to the start command and a pristine instance comes up with a
fictional household — six months of categorised cash flow, two flats on one
shared mortgage, payslips, a portfolio, and a small PDF behind every filed
document. Sign in as **Jana Nováková** with `demo-demo-demo`. An instance that
already has people is never touched.

## Updating

Take a backup first (Settings → Backups). Then, in the folder with
`compose.yaml`:

```sh
docker compose up -d
```

That is the install command run again: it pulls the newest release of the app
and the sidecar, keeps the database on its current major version, and replaces
only what changed. The named volumes carry the data, and the schema is brought
up to date before the app accepts requests. The Compose file itself rarely
changes; when a release says it does, run the `docker run … compose` line from
the quick start again to refresh it.

## Settings

Everything about the household — people, currency, modules, calendar and
Home Assistant connections, backup cadence — lives in the app under Settings
and in your own database. The few things that have to be known before the app
starts go in a `.env` file next to `compose.yaml`, and all of them are
optional:

| Variable               | Default             | What it does                                                                                                       |
| ---------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `TS_AUTHKEY`           | unset               | Joins the sidecar to your tailnet unattended. Or give it on the command line, as above.                            |
| `CONTINUUM_PORT`       | `80`                | Host port for plain http on the local network, if 80 is taken.                                                     |
| `CONTINUUM_BACKUPS`    | `continuum-backups` | Where backups are written. A cloud-synced folder on the host carries them off-machine — see [Backups](backups.md). |
| `CONTINUUM_MAX_UPLOAD` | `32M`               | Largest accepted upload. A phone photo needs more than the server's own 512 KB default.                            |
| `POSTGRES_PASSWORD`    | `continuum`         | Database password. Read on the very first start only — see [Troubleshooting](#troubleshooting) before changing it. |
| `DEMO`                 | unset               | `1` seeds the demo household on a pristine instance.                                                               |
| `PASSWORD_MIN_LENGTH`  | `8`                 | Enforced by the server and shown in the interface from the same value.                                             |
| `ENROLLMENT_LINK_DAYS` | `7`                 | Lifetime of a new person's enrollment link.                                                                        |
| `ORIGIN`               | discovered          | Only behind your own reverse proxy — see [Networking](networking.md#your-own-proxy).                               |
| `ADDRESS_HEADER`       | unset               | Only behind your own reverse proxy — see [Networking](networking.md#your-own-proxy).                               |

The database is not published on any host port, which is why its default
password is acceptable: only the app container can reach it.

## Troubleshooting

**`docker compose logs app` says `Tailscale: waiting — …`.** The line names
what it is waiting for. The sidecar is not signed in: give it a key, or open the
login URL that `docker compose logs tailscale` prints. The machine has no
certificate: enable HTTPS certificates under DNS in the admin console. The app
checks again every fifteen seconds and prints the address the moment it has
one; nothing needs restarting.

**The address does not open on my phone.** The phone needs the Tailscale app
installed and signed in to the same tailnet. A device that is not on the
tailnet cannot reach the address at all — that is the point of it.

**The passkey controls are missing.** You are browsing an address other than
the https one — `http://<server-ip>` on the LAN, for instance. Passkeys are
bound to exactly one address; Settings → Household names the one that works.

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

**Port 80 is already taken on the host.** Set `CONTINUUM_PORT` in `.env`. The
https address is unaffected; the host port is only the LAN fallback.

**The app started before the database was ready.** Nothing to do. It serves an
error page and keeps trying, and starts working on its own once the database
answers.
