# Read-only JSON API

Status: approved design, not yet implemented.

Continuum has no programmatic surface. Its only server routes are logout, the
ics feed, a config export and file serving, so nothing outside the browser can
read the ledger: no dashboard, no Home Assistant sensor, no phone view, no
automation.

This design adds a read-only JSON API under `/api/v1`, authenticated by bearer
tokens, covering the ledger core and the summary figures a dashboard actually
wants.

## Scope

In scope:

- Transactions, accounts, categories and tags as JSON.
- Net worth and cash-flow summary figures.
- Bearer-token authentication, with tokens created and revoked in Settings.

Out of scope, decided deliberately:

- **Writes.** Nothing in v1 creates, updates or deletes. Every write path in the
  app carries guards — rule scoring, split invariants, transfer pairing — and
  exposing them is a second, larger problem.
- **Webhooks.** A household produces a handful of events a week; polling this
  API gets the same result with no secrets to rotate, no retry queue and no
  outbound requests from the server. This was considered and rejected on those
  grounds, not overlooked.
- **Scopes on tokens.** The whole API is read-only, so a scope axis would
  describe a distinction that does not exist.
- **The asset modules.** Property, loans, investments, retirement and rules stay
  internal. Each would become a published shape that cannot casually change.

## Authentication

A new `api_token` table storing only the **sha256 of the token** — the same
approach `session` already takes, where the comment records that "the raw token
never touches the database". The token is shown once at creation and never
again.

```
api_token
  id         text primary key      -- sha256 of the bearer token
  label      text not null         -- "Home Assistant", "Grafana"
  createdAt  timestamptz not null
  lastUsedAt timestamptz
```

Presented as `Authorization: Bearer <token>`. A missing or unknown token is
`401`. `lastUsedAt` is stamped on each accepted request so a forgotten token is
visible as dormant in Settings before it is revoked.

**Failed attempts are rate limited**, reusing whatever the login route already
does — an unauthenticated endpoint that lets a caller try tokens without limit
is a guessing oracle, and the login screen has already solved this problem once.
Successful requests are not limited: a dashboard polling every few seconds is
the intended use.

Tokens are household-wide rather than per-person. Continuum's screens are not
per-person either — both people see the same ledger — so a per-person token
would imply an isolation the app does not have.

`/api/v1` is exempted from the session check in `hooks.server.ts`, exactly as
`/ics/<token>` already is, and authenticates itself instead.

## Shape

The version sits in the path so a future v2 can exist beside v1 rather than
breaking whatever is already subscribed.

| Endpoint                   | Returns                                                     |
| -------------------------- | ----------------------------------------------------------- |
| `GET /api/v1/transactions` | A page of rows with their splits and tags                   |
| `GET /api/v1/accounts`     | Accounts with balance, currency and kind                    |
| `GET /api/v1/categories`   | Categories with their group                                 |
| `GET /api/v1/tags`         | Tags with their running totals                              |
| `GET /api/v1/networth`     | The current figure with its asset and liability composition |
| `GET /api/v1/cashflow`     | Period totals: in, out, kept                                |

`/cashflow` takes `period=ytd\|month`, defaulting to `ytd`, matching the screen's
own `Period` type rather than inventing a second vocabulary.

`/tags` returns each tag's total as an array of per-currency figures, since a tag
can span currencies and stored amounts are never re-denominated:

```json
{ "id": "…", "name": "Renovation 2026", "totals": [{ "amountMinor": -455000, "currency": "CZK" }] }
```

`/transactions` accepts the register's filter parameters verbatim — `q`, `from`,
`to`, `account`, `category`, `dir`, `min`, `max`, `review`, `tag`, `page` — by
calling the same `parseFilter` and `registerPage` the screen calls. The API and
the register therefore cannot disagree about what a filter means, and the
parsing is already unit-tested. A category filter selects line-summed totals
there too.

## Money in JSON

Amounts are always an integer of minor units plus a currency code:

```json
{ "amountMinor": -455000, "currency": "CZK" }
```

Never a float, and never a pre-formatted string. A float would quietly lose the
precision the entire ledger is built to protect, and a formatted string would
force every consumer to parse language-specific separators back out. Consumers
that want a display string can format from these two fields.

`bigint` does not survive `JSON.stringify`, so serialisation converts to
`Number` only after checking the value is inside the safe integer range, and
throws rather than silently rounding if it is not. At household scale this
cannot trigger; the check exists so that if it ever does, it fails loudly.

## Errors and conventions

- `{ "error": "..." }` with a real status code: `401` unauthenticated, `404`
  unknown route, `400` a parameter that will not parse.
- `content-type: application/json; charset=utf-8`.
- `cache-control: no-store`, so a dashboard polling every minute sees current
  data rather than an intermediary's copy.
- Dates as ISO `yyyy-mm-dd`, matching how they are stored.
- Pagination as `{ "page": 1, "pageCount": 3, "total": 137, "rows": [...] }`.

## The cost of publishing a contract

Once something reads `/api/v1/transactions`, the shape of those rows stops being
free to change. This is the reason the API was sequenced after splits, tags and
the rules engine: each reshaped the transaction model, and doing this first would
have published a v1 that was already wrong.

The same logic applies going forward. The tax module will add concepts —
realised gains, per-year figures — and those belong in a later version rather
than being retrofitted into these shapes.

## Screens

Settings gains an API tokens panel: create a token with a label, see it once,
copy it, and a list of existing tokens showing label, created date and last
used, each with a revoke button. The panel states plainly that a token grants
read access to the entire ledger.

## Testing

Unit:

- Serialisation of a `bigint` amount into `{ amountMinor, currency }`.
- The safe-integer guard throws rather than rounding.
- Token hashing matches what the session code does.

E2E, extending the existing serial journey:

- Create a token in Settings; the raw value is shown once.
- `GET /api/v1/transactions` with that token returns the imported rows.
- The same request without a token, and with a wrong one, both return `401`.
- A filter parameter narrows the result the same way it narrows the register.
- Revoking the token makes the previously working request `401`.

## Build order

1. Schema and migration for `api_token`.
2. Token creation, hashing and verification, unit-tested.
3. The `/api/v1` guard in `hooks.server.ts` plus a first endpoint, proving the
   auth path end to end.
4. The remaining endpoints, each reusing the server functions the screens use.
5. The Settings panel.
6. E2E journey.

Step 3 is the checkpoint: if authentication works and an unauthenticated request
is refused, everything after it is shape.
