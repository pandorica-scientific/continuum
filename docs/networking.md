# Reaching it on your network

Continuum speaks plain http on your local network. Nothing is installed on the
phones and laptops that use it, and nothing leaves the house.

## The name

**`http://continuum.local`** is the address. The `mdns` service in
`compose.yaml` announces the name on the network, so every device that speaks
mDNS — iPhone, iPad, Mac, Windows, Linux — resolves it with no configuration.
It answers with the server's address on the asker's own subnet, so a machine
on both Ethernet and Wi-Fi is found either way.

Type it with the `http://`, or with a trailing slash as `continuum.local/`, so
the browser treats it as an address rather than a search.

To run two instances on one network, set `CONTINUUM_NAME` in `.env` on one of
them.

## Android

Android browsers do not resolve `.local` names. Two ways round it, both
one-time:

- **The server's IP address.** Give the server a DHCP reservation in the
  router so the address never changes, then bookmark `http://192.168.x.x`.
- **A router name.** Most routers let you name a reservation — `continuum.lan`
  or `continuum.home`, depending on the router — and many push that suffix to
  every device, so `continuum/` with the slash works everywhere, Android
  included. A Pi-hole or AdGuard Home does the same with one custom record.

Do the reservation even if you skip the name; it is what keeps any address
stable.

## The phone camera

Scanning uses the phone's own camera app: the scan button opens it, and the
photo comes back cropped, flattened and turned into a PDF page. "Add a page"
opens it again for the next one. That is the whole flow on a plain-http
address.

Browsers allow a live camera view inside a page only over https, so on a
plain-http address there is no outline drawn over the paper while you aim;
the detection runs on the photo once it is taken. Everything else is the
same.

## One browser cannot reach it and another can

On a Mac, Safari opens the address and Chrome does not. Nothing in Continuum
treats one browser differently, so what differs is on the browser side, and
the error Chrome prints is the diagnosis:

- **"Always use secure connections."** Chrome rewrites a typed `http://`
  address to `https://`, and nothing here listens for https. The tell is an
  address bar showing `https://` after you typed `http://`, or an error naming
  SSL. Turn it off under `chrome://settings/security`, or add an exception for
  the address.
- **Secure DNS.** A public resolver cannot answer for `.local` names. The raw
  IP still works.
- **An extension, VPN or proxy that blocks private address ranges.** Try an
  Incognito window with extensions disabled.

## Your own proxy

If you put a reverse proxy of your own in front of the host port — for a
domain of your own, or because you terminate TLS for everything already —
one thing in `.env` is worth setting:

```sh
# Only if the proxy is the only way in and always overwrites the header.
ADDRESS_HEADER=x-forwarded-for
```

It lets the sign-in rate limiter count real callers rather than the proxy;
set it only when nothing can reach the app directly, because anyone who can
will otherwise forge the header and step around the limiter. `XFF_DEPTH`
(default `1`) is the trusted hop counted from the right of `X-Forwarded-For`,
for a chain of more than one proxy.

The proxy must pass `X-Forwarded-Host` and `X-Forwarded-Proto`; every common
one does by default. Form submissions are checked against the forwarded host,
so a proxy that drops it gets a "That form was not accepted" page naming both
addresses. Auth cookies are marked `Secure` exactly when the proxy says the
browser used https.

Exposing the app to the public internet is a choice the app cannot defend
against; see [SECURITY.md](../SECURITY.md).
