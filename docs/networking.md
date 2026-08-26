# Networking and passkeys

## Reaching it by name

Typing `ip:port` stops working the moment the router hands the server a new
address. Two steps fix it for every device on the network, no cloud involved:

1. **Pin the address.** In the router's DHCP settings, give the server a
   reservation (a fixed lease for its MAC address). This is the actual cure for
   the rotating IP — do it even if you skip step 2.
2. **Name it.** Either set the server machine's hostname to `continuum`, and mDNS
   makes it reachable as **`http://continuum.local`** from macOS, iOS, Windows and
   recent Android with zero configuration — or, if your router offers local DNS
   names, give the reservation a name there (`continuum.lan` on most). A Pi-hole
   or AdGuard Home works too, with a custom DNS record.

The app sits on plain port 80 by default, so the name alone is the whole address —
just tell it what that address is:

Nothing to configure: form submissions are checked against the address your
browser actually used, so `http://continuum.local`, the LAN IP and
`http://localhost` all work at once without any of them being named anywhere.

A bare `continuum` without a suffix is not reliable in browsers (it reads as a
search), so `.local` or your router's suffix is the practical spelling.

`ORIGIN` stays optional and governs only passkeys — see below.

## One browser cannot reach it and another can

Reported on a Mac where Safari opened `http://continuum.local` and the LAN IP and
Chrome opened neither. Nothing in Continuum treats one browser differently, and a
server that answers Safari is answering — so what differs is on the browser side.
The error Chrome prints is the whole diagnosis; check these in order.

- **"Always use secure connections" (HTTPS-First).** Chrome silently rewrites a
  typed `http://` address to `https://`, and nothing here listens on 443 — so both
  the name and the raw IP fail while Safari, which does not upgrade, works.
  `chrome://settings/security` → turn it off, or add an exception for the host.
  The tell is an address bar that shows `https://` after you typed `http://`, or an
  error naming SSL — `ERR_SSL_PROTOCOL_ERROR`, `ERR_CONNECTION_REFUSED` on 443.
- **A pinned HSTS entry**, if that browser once reached the machine over HTTPS —
  through the Tailscale name, a reverse proxy, or an earlier experiment. It applies
  per hostname and outlives the certificate. Check and clear it at
  `chrome://net-internals/#hsts`.
- **Secure DNS (DNS-over-HTTPS).** A public resolver cannot answer for `.local`,
  which is mDNS on the local link, so the name fails and the raw IP still works.
  `chrome://settings/security` → Use secure DNS. This one explains a failing name
  only; if the IP fails too, it is not this.
- **An extension, VPN or proxy that blocks private address ranges.** Try an
  Incognito window with extensions disabled, then the same address in a new
  profile. A managed work profile can carry a policy the rest of the system does
  not see — `chrome://policy` lists what is being enforced.

None of these are things a self-hosted app can fix from the server: an HTTPS
upgrade never reaches it, and a blocked request never leaves the machine.

## Passkeys and Tailscale

Continuum supports **passkeys** — Face ID, Touch ID, Windows Hello — alongside
passwords. Passwords never go away, so a device without a passkey still works.

Browsers refuse the passkey API outside a secure context, so the passkey controls
appear only when `ORIGIN` is `https://` (or `localhost` during development). On a
plain-HTTP LAN address they are simply absent rather than broken.

## The camera needs HTTPS too

The same rule that governs passkeys governs the scanner. Browsers refuse
`getUserMedia` outside a secure context, so on a plain-HTTP LAN address the
in-app viewfinder cannot open, ever — no setting changes that.

Continuum does not simply lose the feature there. The scan button falls back to
**your phone's own camera app**, which needs no secure context, and the photo it
returns goes through exactly the same processing: detected, cropped, flattened
and written as a PDF.

What HTTPS adds is the shooting rather than the scanning: an outline showing what
has been found while you aim, the torch, and staying inside the app between pages
instead of leaving for the camera app and coming back for each one.

Set up HTTPS and the viewfinder appears by itself. There are three routes, and
which one suits you depends on whether you have a domain name.

### The quick one: HTTPS on the LAN, no account, no domain

Bundled as an optional profile. Give it the address you actually type — a name
or a LAN IP, but it must match, because a certificate issued for the wrong one
is rejected outright rather than warned about:

```sh
# .env
CONTINUUM_HOST=continuum.local

docker compose --profile lan-tls up -d
```

Then open **https://continuum.local:8443** on the phone.

The certificate is issued by Caddy's own authority, which no device trusts, so
every browser warns once. **Accept it and everything works** — the origin is a
secure context from then on as far as the browser is concerned, which is all
getUserMedia and passkeys require. Set `ORIGIN=https://continuum.local:8443` to
turn the passkey controls on as well.

To stop the warning, install Caddy's root certificate on each device and mark it
trusted:

```sh
docker compose cp tls:/data/caddy/pki/authorities/local/root.crt ./continuum-root.crt
```

On iOS, mail or AirDrop it to yourself, open it, install the profile, then turn
it on under **Settings → General → About → Certificate Trust Settings** — the
second step is separate and easy to miss. On macOS, open it in Keychain Access
and set it to _Always Trust_. On Android, **Settings → Security → Encryption &
credentials → Install a certificate → CA certificate**.

The `caddy-state` volume holds that authority. Delete the volume and a new root
is issued, and every device warns again.

This route is deliberately the _quick_ one, not the good one. It is right for
testing the scanner on a phone this evening. For daily use, prefer:

### The good one: a trusted certificate

Tailscale, below, gets you one with no domain name of your own. If you already
have a domain, any reverse proxy terminating TLS does the job — with
[Caddy](https://caddyserver.com) it is three lines, and the certificate is
obtained and renewed for you:

```caddyfile
ledger.example.com {
    reverse_proxy localhost:3000
}
```

Whatever terminates TLS, set `ORIGIN` to the `https://` address so passkeys work
at the same time.

A passkey here always requires **user verification** — the face, the fingerprint,
or the device PIN. That is what keeps it a second factor rather than a bearer
token, and it means a roaming security key with no PIN configured cannot be
registered. Platform authenticators (Face ID, Touch ID, Windows Hello) verify by
nature and need nothing extra.

The simplest way to get HTTPS on a home server is
[Tailscale](https://tailscale.com), a WireGuard mesh that is **private by
default**: only devices you have added to your tailnet can reach the machine. That
is why the sidecar ships **on by default** — passkeys are the point, and they need
a secure origin. `tailscale serve` publishes to the tailnet; the command that
would expose the app to the public internet is `tailscale funnel`, which nothing
here runs. The one thing that does become public is the hostname — Tailscale's
certificate comes from Let's Encrypt, and every Let's Encrypt certificate is
listed in public Certificate Transparency logs. Nothing is reachable at that name;
only the name is visible.

The sidecar needs authenticating once. Either read the login URL out of its logs:

```sh
docker compose logs tailscale     # visit the https://login.tailscale.com/… URL
```

or generate an auth key in the Tailscale admin console and let it authenticate
unattended:

```sh
# .env
TS_AUTHKEY=tskey-auth-…
```

Either way, finish by telling the app the name Tailscale issued — passkeys are
verified against it exactly:

```sh
# .env
ORIGIN=https://continuum.<your-tailnet>.ts.net

docker compose up -d
```

Until that is done the sidecar sits unauthenticated and nothing else changes: the
app answers on its LAN address, and the passkey controls stay absent because the
origin is still plain HTTP.

**Do not remove the LAN port mapping yet.** Sign in over the tailnet address,
register a passkey in Settings → Household, and confirm it signs you in. Only then
delete the `ports:` block from the `app` service in `compose.yaml`, which makes
Tailscale the only way in. Note that this also puts the `/ics` calendar feed and
the `/api` tokens behind the tailnet, so a phone subscribed to the calendar needs
Tailscale connected for it to refresh.

**Already running Tailscale on the host?** Skip the sidecar. Set `ORIGIN` to your
existing `.ts.net` name and run, on the host:

```sh
# 80 is the host port compose publishes by default; use your CONTINUUM_PORT if
# you overrode it. 3000 is the port *inside* the container and is not published.
tailscale serve --bg 80
```

Any other route to a trusted certificate works equally well — a reverse proxy with
Let's Encrypt, or your own internal certificate authority via `mkcert` if you would
rather nothing appear in a public log. Continuum only cares that `ORIGIN` is
`https://` and matches the address you browse to.
