# Security Policy

Continuum holds a household's bank statements, balances, payslips and
documents. A vulnerability here is not an abstract one, so reports are welcome
and taken seriously.

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Report it privately, either way:

- GitHub → the repository's **Security** tab → **Report a vulnerability**
  (private advisory, preferred — it keeps the discussion and the fix together).
- Email **robert.kiewisz@gmail.com** with `continuum security` in the subject.

Please include:

- what an attacker can do, and what they need to start (network access? a valid
  session? an upload?);
- the affected version or commit, and how the instance is deployed
  (`docker compose`, reverse proxy, exposed to the internet or LAN-only);
- steps to reproduce — a request, a crafted file, a code path;
- anything you already know about a fix.

Redact real financial data from the report. A crafted statement with invented
account numbers proves a parser bug just as well as a real one.

### What to expect

This is a single-maintainer project, so the timelines are honest rather than
corporate:

| Stage                                     | Target  |
| ----------------------------------------- | ------- |
| Acknowledgement that the report arrived   | 7 days  |
| Assessment: confirmed, rejected, or scope | 14 days |
| Fix released for a confirmed issue        | 30 days |

You will be credited in the advisory and the changelog unless you prefer
otherwise. Please give a coordinated-disclosure window of 90 days, or until a
fix ships if that comes sooner.

### Never test against an instance you do not own

Every Continuum instance is somebody's household. Test against your own
deployment only — a fresh one with `DEMO=1` costs a minute and contains nothing
real. Probing someone else's server is not research.

## Supported versions

Continuum is pre-1.0 and ships from `main`. Only the latest release receives
fixes; there are no maintenance branches. Upgrading means pulling the current
image — migrations run on start.

| Version        | Supported |
| -------------- | --------- |
| Latest release | Yes       |
| Anything older | No        |

## What the deployment assumes

These are design decisions, not vulnerabilities. Knowing them helps you judge
whether a finding is in scope:

- **A trusted local network, or a private tunnel.** Continuum serves plain HTTP
  on port 80 by default and terminates no TLS of its own. It is built to sit on
  a home LAN behind a router, reachable as `http://continuum.local`, or behind
  something that provides HTTPS — Tailscale, a reverse proxy, an internal
  certificate authority. Exposing it directly to the public internet, including
  via `tailscale funnel`, is a deployment choice the app cannot defend against.
- **`ORIGIN` matches the address you browse to.** Form submissions are
  origin-checked and refused otherwise, and the WebAuthn relying-party ID is
  derived from the same value. A misconfigured `ORIGIN` breaks sign-in rather
  than weakening it.
- **Passkeys need a secure context.** The passkey controls appear only when
  `ORIGIN` is `https://` (or loopback in development); on a plain-HTTP LAN
  address they are absent, and passwords remain the only door. That is a
  browser rule, not a Continuum one.
- **Everyone with an account can read the whole ledger.** There is no
  multi-tenancy and no per-person data isolation: people are separate sign-ins
  over one shared household, by design. Roles separate administration only —
  members cannot manage people, tokens, modules, currency or backups, and those
  sections are never sent to them rather than merely hidden.
- **Backups are plain SQL.** The scheduled backup writes an unencrypted
  `continuum-backup.sql` plus copies of every uploaded file. Pointing
  `CONTINUUM_BACKUPS` at a cloud-synced folder hands that content to the sync
  provider. Encrypt the destination if that matters to you.
- **Demo mode is public by construction.** `DEMO=1` seeds a fictional household
  with a published password. Never enable it on an instance holding real data.

Current protections, for reference when assessing a report: passwords hashed
with Argon2id; session tokens, API tokens and enrollment links stored hashed,
never in plaintext; enrollment links single-use and expiring; passkeys requiring
user verification, with single-use challenges and a clone signal on the
signature counter; the relying-party ID derived from `ORIGIN` rather than
configured separately; failed sign-ins and failed bearer tokens rate limited per
address on separate budgets; the `/api/v1` surface read-only with no write
endpoints and no webhooks.

## In scope

- Authentication or session bypass; token forgery, reuse after revocation, or
  privilege escalation from member to administrator.
- Passkey ceremony flaws: challenge replay or reuse, relying-party or origin
  confusion, a credential registered to one person authenticating another,
  user verification not actually enforced.
- Enrollment-link flaws: a link that works twice, after expiry, after the
  person was deactivated, or that can be guessed from another one.
- Anything letting an unauthenticated caller read or modify ledger data.
- Injection: SQL, command, or template — including through parsed statement
  fields.
- Stored or reflected XSS, particularly through imported statement text,
  document names, notes and tags.
- Path traversal or arbitrary file read/write through document upload, file
  serving, or the backup path settings.
- Server-side request forgery through the Home Assistant provider, the FX rate
  fetch, or any other outbound request whose target is user-controlled.
- Secrets leaking into logs, error pages, the API, or backups.
- A dependency vulnerability with a demonstrated path through Continuum's own
  code.

## Out of scope

- Anything requiring physical access to the server, or an already-authenticated
  session belonging to the attacker.
- Consequences of exposing the instance to the internet without TLS or a proxy,
  or of running it on an untrusted network — see the assumptions above.
- Denial of service by resource exhaustion from an authenticated household
  member (huge uploads, expensive queries).
- Missing security headers, cookie-flag nitpicks, or scanner output with no
  demonstrated impact.
- Self-XSS, clickjacking on pages with no state-changing action, and reports
  that amount to "the demo password is public".
- Social engineering, phishing, or attacks on the maintainer's accounts.

If you are unsure which side of the line a finding falls on, report it
privately anyway and say so.
