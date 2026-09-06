# Networking and passkeys

## What Tailscale does here

Browsers refuse two things outside a secure context: the passkey API and the
camera. So on a plain-http address there is no Face ID sign-in and no in-app
viewfinder for scanning paper. A trusted `https://` address fixes both, and
getting one on a home server normally means a domain name, a certificate and a
port open to the internet.

[Tailscale](https://tailscale.com) gives the same thing on a private network.
The sidecar in `compose.yaml` joins your tailnet as a machine called
`continuum`, gets a name like `continuum.your-tailnet.ts.net` and a certificate
for it, and forwards `https://` on that name to the app. Only devices you have
added to your tailnet can reach it; nothing is opened to the internet. The
command that would publish a machine to the open internet is `tailscale funnel`,
which nothing here runs.

The app learns its own address from the sidecar. It reads the sidecar's local
API over a shared socket, waits until the machine has a name and a certificate,
and from then on binds passkeys and secure cookies to that address. There is
nothing to configure and nothing to restart; `docker compose logs app` prints
the address when it is known, and Settings → Server shows it.

One thing does become public: the name. Tailscale's certificates come from
Let's Encrypt, and every Let's Encrypt certificate is listed in public
Certificate Transparency logs. Nothing is reachable at that name from outside
your tailnet; only the name is visible.

## The addresses

**`https://continuum.<your-tailnet>.ts.net`** is the address. Passkeys, the
camera, the calendar feed and the API all work here, from any device on the
tailnet, anywhere in the world.

**`continuum/`** typed into a browser on the tailnet lands in the same place.
MagicDNS resolves the bare machine name, the sidecar answers plain http on it,
and the app redirects to the full https name.

**`http://<server-ip>`** works on the local network without Tailscale, for a
device that cannot run it. Password sign-in works; passkeys and the in-app
viewfinder do not, and a phone's scan button falls back to the phone's own
camera app, which produces the same cropped PDF without the outline while
aiming. If port 80 on the host is taken, `CONTINUUM_PORT` in `.env` moves it.

A phone subscribed to the calendar feed at the https address needs Tailscale
connected for the feed to refresh.

## Passkeys

Continuum supports passkeys — Face ID, Touch ID, Windows Hello — alongside
passwords. Passwords never go away, so a device without a passkey still works.

A passkey is bound to one address, so the controls appear only when you are
browsing the https one. On any other address they are absent rather than
broken, and Settings → Household names the address that works.

A passkey here always requires user verification — the face, the fingerprint
or the device PIN. That is what keeps it a second factor rather than a bearer
token, and it means a roaming security key with no PIN configured cannot be
registered.

## One browser cannot reach it and another can

On a Mac, Safari opens `http://<server-ip>` and Chrome does not. Nothing in
Continuum treats one browser differently, so what differs is on the browser
side, and the error Chrome prints is the diagnosis:

- **"Always use secure connections."** Chrome rewrites a typed `http://`
  address to `https://`, and the LAN port speaks only http. The tell is an
  address bar showing `https://` after you typed `http://`, or an error naming
  SSL. Turn it off under `chrome://settings/security`, or use the tailnet
  address, which is https anyway.
- **Secure DNS.** A public resolver cannot answer for `.local` names. The raw
  IP still works; the tailnet name is unaffected.
- **An extension, VPN or proxy that blocks private address ranges.** Try an
  Incognito window with extensions disabled.

## Your own proxy

If you already terminate TLS — Caddy, nginx, Traefik, a domain of your own —
you do not need the sidecar. Run `docker compose up -d app db`, point the proxy
at the host port, and put two things in `.env`:

```sh
# Exactly the https address you browse to; passkeys are bound to it.
ORIGIN=https://ledger.example.com
# Only if the proxy is the only way in and always overwrites the header.
ADDRESS_HEADER=x-forwarded-for
```

`ORIGIN` replaces the discovery described above. `ADDRESS_HEADER` lets the
sign-in rate limiter count real callers rather than the proxy; set it only
when nothing can reach the app directly, because anyone who can will otherwise
forge the header and step around the limiter. `XFF_DEPTH` (default `1`) is the
trusted hop counted from the right of `X-Forwarded-For`, for a chain of more
than one proxy.

The proxy must pass `X-Forwarded-Host` and `X-Forwarded-Proto`; every common
one does by default. Form submissions are checked against the forwarded host,
so a proxy that drops it gets a "That form was not accepted" page naming both
addresses.
