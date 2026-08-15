# Passkey authentication and account management

Status: approved design, not yet implemented.

Continuum's authentication was built for one moment: the setup wizard, where
every household member is created at once with a name and a password typed by
whoever runs the wizard. Everything after that moment is missing. There is no
way to change a password, no way to remove or suspend a person, and no
distinction between an administrator and an ordinary member — `person.role`
exists in the schema but nothing reads it.

Adding a person after setup does work today (`settings/+page.server.ts`,
`addPerson`), but it inherits the wizard's flaw: the creator types the new
person's password and therefore knows it.

This design adds passkeys as a second way to sign in, moves the deployment onto
Tailscale so passkeys are possible at all, and closes the account-management
gaps around both.

## Why Tailscale

WebAuthn — the browser API behind passkeys — refuses to run outside a secure
context. The current deployment serves plain HTTP on the LAN
(`compose.yaml`: `ORIGIN: ${ORIGIN:-http://localhost}`, README documents
`http://continuum.local`), so passkeys are impossible as things stand.

Three routes to a trusted certificate were considered:

- **An internal certificate authority** (`mkcert`). Nothing public at all, and
  the existing `.local` hostname survives. Costs a one-time CA install on every
  device, including a multi-step profile install on iOS.
- **Tailscale.** A WireGuard mesh, private by default: only devices on the
  tailnet can reach the machine. `tailscale serve` publishes to the tailnet;
  the public-internet command is `tailscale funnel`, which is a separate and
  deliberate opt-in. Devices need no CA install and the app works away from
  home.
- **Caddy with a public domain.** Equivalent to Tailscale for certificate
  purposes but requires owning a domain and managing DNS.

**Tailscale was chosen.** The accepted trade-off is that its certificate comes
from Let's Encrypt, and every Let's Encrypt certificate is published to public
Certificate Transparency logs — so the tailnet hostname becomes publicly known.
Nothing is reachable at that name; only the name leaks.

Google and Apple sign-in were considered and rejected. Both require an HTTPS
redirect URI on a domain the provider can verify, which rules out `.local` names
and private addresses regardless of how traffic actually flows; Apple further
requires a paid Developer Program membership and public domain verification.
Passkeys reach the same goal without a third party learning when the household
logs in, and without depending on an internet connection at login time.

## Scope

In scope:

- WebAuthn passkey registration and login, alongside the existing passwords.
- Tailscale as the deployment transport: a compose sidecar by default, with the
  host-installed path documented.
- Changing your own password.
- Enrollment links, replacing creator-typed passwords for new people.
- Deactivating and reactivating a person.
- An administrator role gate, built on the existing `person.role` column.

Out of scope, decided deliberately:

- **Removing passwords.** They stay as a permanent fallback. A household
  self-hosting its own financial records has no mail server to send a reset
  link, and the tailnet is already a closed set of trusted devices, so the
  marginal risk of keeping passwords is small against the risk of lockout.
- **Hard deletion of a person.** `person` is referenced by `session`,
  `account.owner_person_id`, `property.owner_person_id`, `loan.owner_person_id`,
  `document_person` and `tax_statement.person_id`. Deletion would silently null
  out ownership on accounts, properties and loans and cascade-delete tax
  statements and document links. Deactivation covers the actual need.
- **Recovery codes.** A separate subsystem to build and test, for a household
  that already holds the server's keys. The documented database one-liner is the
  escape hatch.
- **Conditional UI** (passkey suggestions autofilling into the password field).
  Nicer, but it complicates the login page for a screen seen on a handful of
  devices.
- **Trusting Tailscale identity headers** in place of app-level login. It would
  weld the app to Tailscale, leave every other documented deployment with no
  authentication at all, turn a misconfigured proxy into a total bypass, and
  still require a tailnet-user-to-person mapping.
- **Narrowing non-account settings.** Module toggles, base currency and backup
  settings stay open to any member.

## Approach

Passkeys are added as a **credential table alongside `person`**, not as a
generalised authentication-method table. `person.password_hash` stays where it
is; a new `credential` table carries WebAuthn credentials with a foreign key to
`person`; both login paths converge on the existing `createSession`.

The alternative — moving `password_hash` into an `auth_method` table with a type
discriminator — was rejected as speculative. It buys uniformity for a third
authentication type that has been explicitly ruled out, at the cost of a
migration that rewrites all three current authentication touchpoints (`setup`,
`login`, `settings`). Since passwords are staying, there is no migration to
justify.

Two new runtime dependencies are required: `@simplewebauthn/server` and
`@simplewebauthn/browser`. The project's dependency list is deliberately lean,
so this is a real cost, accepted because the alternative is owning hand-written
CBOR decoding and COSE signature verification inside an authentication path.

## Schema

One migration, generated by `drizzle-kit generate`.

### `person` — three changes

- **`role` becomes the permission field**, with exactly two values, `'admin'`
  and `'member'`. This is not a new column; it gives an existing incoherent one
  a single meaning. Today the schema defaults to `'adult'`, the demo seeder
  writes `'admin'` and `'member'`, the setup wizard never sets it, and the only
  consumer is a display string in Settings. The migration sets the earliest
  person by `created_at` to `'admin'` and every other person to `'member'`. The
  demo seeder already writes exactly these two values and needs no change. The
  setup wizard, which currently never sets `role` at all, must apply the same
  rule for fresh installs: the first person in the wizard becomes `'admin'`,
  any others `'member'`. Without this a new installation would have no
  administrator.
- **`password_hash` becomes nullable.** Forced by enrollment links: a person now
  exists between being created and choosing a password. `verifyPassword` gains a
  null guard so a person who has not enrolled can never log in.
- **`deactivated_at`** — new nullable `timestamptz`.

### `credential` — new

| column         | type          | note                                        |
| -------------- | ------------- | ------------------------------------------- |
| `id`           | `text` PK     | base64url credential ID                     |
| `person_id`    | `text` FK     | → `person.id`, on delete cascade            |
| `public_key`   | `text`        | base64url COSE key                          |
| `counter`      | `bigint`      | signature counter, for clone detection      |
| `transports`   | `jsonb`       | browser hints: `['internal']`, `['hybrid']` |
| `label`        | `text`        | human name, e.g. "Robert's iPhone"          |
| `created_at`   | `timestamptz` |                                             |
| `last_used_at` | `timestamptz` | nullable                                    |

### `enrollment_token` — new

Stores only the hash, following the convention `session` and `api_token` already
set, where the schema comment records that "the raw token never touches the
database".

| column       | type          | note                             |
| ------------ | ------------- | -------------------------------- |
| `id`         | `text` PK     | sha256 hex of the token          |
| `person_id`  | `text` FK     | → `person.id`, on delete cascade |
| `expires_at` | `timestamptz` | 7 days from issue                |
| `used_at`    | `timestamptz` | nullable; single use             |

### No challenge table

WebAuthn challenges live in a short-lived `httpOnly` cookie. They are
per-browser and expire in minutes, so a table would only add a cleanup job.

## Configuration

The relying-party ID is **derived from `ORIGIN`**, never configured separately:
`new URL(env.ORIGIN).hostname`. A mismatch between origin and relying-party ID
is the classic WebAuthn failure, and deriving one from the other makes it
impossible to misconfigure.

The server exposes a single computed **secure-context flag**: `ORIGIN` uses
`https://`, or its host is `localhost`. When false, the passkey interface is
absent rather than broken. This keeps `npm run dev` working — localhost is a
secure context, so passkeys are testable locally — and keeps the documented
plain-HTTP deployment honest instead of showing a button that always fails.

## Endpoints

WebAuthn requires a two-step JavaScript round trip, which SvelteKit form actions
do not fit. Four dedicated endpoints:

```
POST /auth/passkey/login/options      public
POST /auth/passkey/login/verify       public
POST /auth/passkey/register/options   session required
POST /auth/passkey/register/verify    session required
```

`PUBLIC_PATHS` in `hooks.server.ts` gains `/auth/passkey/login` — that prefix
specifically, not all of `/auth`, so the registration endpoints remain behind a
session. This matches the existing comment there: public means exempt from the
redirect to `/login`, not exempt from authentication.

## Flows

### Registering a passkey

From Settings, on a logged-in account. Registration options use:

- `residentKey: 'required'` — credentials must be **discoverable**, which is
  what lets the login screen skip the person-picker.
- `userVerification: 'preferred'`.
- `attestation: 'none'` — a household ledger has no reason to identify
  authenticator makes and models.
- `excludeCredentials` set to the person's existing credentials, so one device
  cannot silently register twice.

The challenge goes into the `httpOnly` cookie. On verification the credential
row is inserted with a label the person types, defaulting to a value derived
from the user agent.

### Logging in with a passkey

`allowCredentials` is empty. With discoverable credentials the authenticator
returns a `userHandle` carrying the person ID, so one tap signs in without
first stating who you are.

Verification looks up the credential, checks the signature against the stored
public key, confirms the person is not deactivated, updates `counter` and
`last_used_at`, and calls the existing `createSession`.

**The signature counter rule.** Clone detection compares the authenticator's
counter against the stored one, but Apple's iCloud Keychain and most synced
passkeys always report `0`. The check must therefore flag a clone only when the
stored counter and the incoming counter are **both greater than zero** and the
incoming one has not advanced. A naive `incoming > stored` comparison rejects
every Apple passkey on its second use. This requires a regression test.

### Enrollment link

Adding a person becomes name, birth year and role, with **no password field**.
The server creates the person with `password_hash` null, mints an enrollment
token, and reveals the link once, in the same style as existing API tokens. The
link is delivered out of band by the administrator.

The new person opens `/enroll/<token>`, a public path outside the app shell, and
sets their own password, with passkey registration offered immediately after —
subject to the same secure-context flag, so over plain HTTP enrollment is
password-only. On submission the token is verified as unexpired and unused, the
password hash is written, the token is marked used, and a session is created.

Invalid, expired and used tokens produce the same neutral message: an enrollment
link is a bearer credential, so distinguishing "expired" from "never existed"
leaks whether a token was ever real. The existing `ratelimit.ts` module guards
the endpoint by client address, as login already is.

A person who has not enrolled shows as **pending** in Settings, with a control
to reissue the link. With a null `password_hash` and no credentials, both login
paths reject them.

### Changing your own password

Current password, new password, confirmation. On success **every other session
for that person is revoked** and the current one is kept — changing a password
after a scare should actually eject the other device.

### Deactivation

Administrator-only and non-destructive: it sets `deactivated_at` and deletes
that person's sessions. Credentials and password hash are left intact so
reactivation is a clean undo rather than a re-enrollment. `validateSession` and
both login paths check `deactivated_at`, so a live session dies on its next
request.

Guards: a person cannot deactivate themselves, and the last remaining
administrator cannot be deactivated.

### The administrator gate

A `requireAdmin(locals)` helper beside the existing authentication code, applied
to person creation, enrollment links, deactivation, role changes and API-token
management.

`SessionPerson` gains `role`, and `validateSession` gains the deactivation
check. Both are small changes in `auth/index.ts`, the single place every request
already passes through. The login page's `load`, which today selects every
person, must exclude deactivated people so they do not appear in the picker.

A person cannot demote themselves while they are the last administrator.
Together with the documented database escape hatch, there is no reachable state
in which the instance has no administrator.

## Interface

**Login screen.** A single "Sign in with a passkey" button above the existing
person-picker, rendered only when the secure-context flag is true. The current
person list and password field are unchanged. A cancelled system prompt or a
device with no passkey returns silently to the password form — cancelling is a
deliberate act, not an error.

**Settings — People.** The section grows enough to move into its own component
rather than extending `settings/+page.svelte`, which already carries module
toggles, backup and currency settings. It shows each person's registered
passkeys with labels and last-used dates, each individually removable; marks
pending people and offers link reissue; renders deactivate, reactivate, promote
and demote for administrators only; and offers "Change password" and "Add a
passkey" on your own account. Hiding administrator controls is courtesy — the
server enforces the gate regardless.

**Enrollment page.** Standalone at `/enroll/<token>`, outside the app shell,
since the person has no session yet.

## Deployment

`compose.yaml` gains a `tailscale` sidecar sharing a network namespace with the
application, running `tailscale serve` to terminate HTTPS and proxy to port 3000. `ORIGIN` defaults to the `.ts.net` name. Requires `TS_AUTHKEY` in `.env`.

The application's LAN port mapping is removed — Tailscale becomes the only way
in. This means the `/ics` calendar feed and the read-only `/api` tokens also
become tailnet-only: a phone subscribing to the calendar needs Tailscale
connected for the feed to refresh.

README additionally documents the host-installed path, for a machine already on
a tailnet: the required `ORIGIN` value and the `tailscale serve` command.

**Cutover sequencing.** README instructs keeping the LAN port published until a
passkey login over the tailnet has been confirmed working, then removing it.
This is the one step that feels irreversible, and it does not need to be a flag
day.

**Administrator escape hatch.** Rather than adding a command-line subsystem,
README documents a `docker compose exec` one-liner against Postgres to set
`role = 'admin'`. The box is already owned by whoever needs this, so it adds no
attack surface.

## Testing

**Unit.** The signature-counter rule, explicitly including the Apple case where
both counters are zero and login must succeed. Enrollment token lifecycle:
valid, expired, already used, unknown. `requireAdmin` and both last-administrator
guards. Deactivation blocking both login paths and invalidating live sessions.
Relying-party ID derivation and the secure-context flag across `https://`,
`http://localhost` and `http://continuum.local`.

**End-to-end.** WebAuthn is testable without hardware through Chromium's CDP
virtual authenticator (`WebAuthn.enable`, `addVirtualAuthenticator`), which
registers and asserts real credentials against a software authenticator.
Journeys: register a passkey then sign in with it; an enrollment link end to
end; deactivation locking a person out.

The existing end-to-end suite signs in by password throughout, and passwords are
staying, so it should pass unchanged. A failure there signals a regression in
the existing path, which is the principal risk in this change.

## Documentation

`ARCHITECTURE.md` (authentication section), `README.md` (Tailscale sidecar,
host-installed alternative, cutover sequencing, administrator escape hatch),
`docker/DOCKERHUB.md` (`TS_AUTHKEY` and `ORIGIN`), and `CHANGELOG.md`. This is a
breaking deployment change, so **v0.3.0**.

## Risk

This change touches the code path standing between the household and its own
financial records.

Mitigations: passwords remain untouched as a working fallback; the passkey path
is purely additive; the existing end-to-end suite acts as a regression net on
the old path; and no migration destroys data — `password_hash` becoming nullable
and `role` being rewritten are both non-destructive.

The residual risk is the deployment cutover, addressed by the sequencing note
above.
