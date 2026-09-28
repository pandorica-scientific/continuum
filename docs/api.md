# API and Home Assistant

## API

Settings → API tokens creates a bearer token (shown once) that is either
**read-only** or **read-write**. A token is read-only unless you choose otherwise
when creating it, and either can be switched later from the same list; the change
applies to the token's next request. A token carries no expiry: it works until you
revoke it, which takes effect at once. Settings shows when each was last used,
refreshed at most once every five minutes. Failed bearer attempts are
rate-limited the same way sign-in is; successful calls are not.

Both kinds read exactly the same data; they differ only in writing. A
**read-only** token gets a `403` for any method other than `GET` or `HEAD`; a
**read-write** token may also `POST`, `PATCH` and `DELETE`.

### Areas

A token reaches **everything**, or only the **areas** ticked for it — the module
toggles (Trips, Cookbook, Collections, Tax, Salary, Documents and the rest) plus
**Accounts & transactions** for the ledger no toggle owns and **Household** for
who lives here. It is chosen when the token is created and changeable later, like
read or read-write. Settings offers only the areas something belongs to:
Retirement adds up other areas' figures and Home Assistant lives in Settings, so
neither has anything of its own to reach.

Each table belongs to one area; `GET /api/v1/tables` lists a limited token's own
tables only, with each table's `area`. People, tags, organisations, currencies, the
entity registry and net worth serve every area at once, so only a token that
reaches everything reaches them — a token limited to Trips cannot read who lives in
the household or what anything else is tagged with. **Household** is the one
exception: it reads each person's `id`, `name`, `birth_year` and `citizenship`
under `/api/v1/tables/person`, and nothing else of theirs — not who is an
administrator or may sign in, and not the paper filed against them. It writes none
of it, whether the token is read-only or read-write; adding or renaming somebody
needs a token that reaches everything. Tick it beside Trips so a travel planner
can say who a trip's members are.

Of the endpoints below, accounts, transactions, categories and cash flow belong to
the ledger; tags and net worth to everything, and a transaction's tags are left out
for a token limited to the ledger. Anything outside a token's areas is a `403`.

A travel planner, for example, gets a **read-write** token limited to **Trips**: it
can add ideas and trips, attach a plan to either, and see nothing else.

A payslip needs **Salary** as well as whatever else would reach it, Documents
included. A token without Salary finds no payslip anywhere: not the document, its
text, its links or any other row naming one, under `/api/v1/tables` or
`/api/v1/files`. It cannot write a payslip, retype a document as one or link one
to anything either; those answer `403`. Changing or deleting a payslip answers
`404`, as a row that is not there does.

The endpoints below read accounts, transactions (accepting the register's filter
params, `group=<category group>` among them), categories, tags, net worth and
cash-flow totals under `/api/v1`. Every amount crosses the wire as integer minor
units plus a currency code, never a float:

```sh
curl -H "Authorization: Bearer <token>" \
  http://continuum.local/api/v1/networth
# { "total": { "amountMinor": 646055100, "currency": "CZK" }, … }
```

There are no webhooks — a household produces a handful of events a week, so a
dashboard polls.

`/api/v1/transactions` measures `from`, `to` and `month` on the day the money moved —
the value date where the bank printed one, the booking date otherwise — which is the
day cash flow sums on, so the same window means the same rows on both. Each row still
reports `bookedAt`, the day the bank booked it. An unusable filter value is ignored
rather than refused, and the response carries the page, the page count, the row
total and the totals for the whole filter, with each row's splits and, for a token
that reaches everything, its tags.

`/api/v1/cashflow` takes `period=ytd|month|12m` (`ytd` when absent; an unknown one is
a 400, unlike the screens, which fall back) and `anchor=YYYY-MM` for the month the
window ends on — a month outside the record is clamped to it rather than refused. It
answers with `period`, a `caption` naming the window in words, `totals` as the four
figures `in`, `out`, `saved` and `kept`, and `previous` — the same `caption` and
`totals` for the window one step back, or `null` where the record does not reach that
far. `kept` is the cash left over **after** saving; what was put aside is `saved`. All
four are display-grade sums converted into the base currency, not ledger-grade ones:
the per-transaction endpoints are the exact figures.

### Tables

The household's tables are also reachable under `/api/v1/tables` — trips, bottles,
recipes, loans, documents and the rest, within a token's areas — so anything the
screens hold can be read, and written with a read-write token. Names are the
database's own, so `\d loan_event` in `psql` documents the call.

| Call                                  | Does                                                                                                        |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/tables`                  | Every reachable table: its columns (type, nullable, default, writable, updatable) and its primary key       |
| `GET /api/v1/tables/<table>`          | Rows in primary-key order; `limit` (default 100, at most 1000), `offset`, and `<column>=<value>` to filter  |
| `POST /api/v1/tables/<table>`         | Insert one row (a JSON object) or up to 1000 (an array), all or none; answers `201` with the rows as stored |
| `PATCH /api/v1/tables/<table>?<key>`  | Change the columns in the JSON body on the one row the primary key names                                    |
| `DELETE /api/v1/tables/<table>?<key>` | Delete that one row, answering with what it held                                                            |

`<key>` is every primary-key column and nothing else — `?id=…` for most tables,
`?tag_id=…&target_id=…` for a link table — so a mistyped filter cannot widen a
change or a delete to the whole table. A one-column uuid key left out of an insert
is minted the way the app mints it; the all-zeros uuid is refused, since the app
uses it to mean "no such row". Timestamps are ISO 8601 strings with an offset, such
as `2026-09-27T08:00:00Z` or `2026-09-27T10:00:00+02:00`, from the year 100 on;
one without an offset is refused rather than read in the server's time zone. A
filter on a timestamp matches to the millisecond, as the answers are written, and
its `+` may be sent as it is. Days are `2026-09-27` and nothing else. Numbers are
JSON numbers or decimal strings, never `NaN` or `Infinity`, and text is a string —
`true` sent to a text column is refused rather than stored as the word. `bigint`
columns (the money columns among them) are whole numbers, as elsewhere in the API,
from −9007199254740991 to 9007199254740991 — the range a JSON number carries
exactly.

```sh
# Every trip, then a new one, then its notes changed
curl -H "Authorization: Bearer <token>" http://continuum.local/api/v1/tables/trip
curl -X POST -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"name": "Lisbon", "starts_on": "2026-10-01", "ends_on": "2026-10-08"}' \
  http://continuum.local/api/v1/tables/trip
curl -X PATCH -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"notes": "Tram 28"}' \
  "http://continuum.local/api/v1/tables/trip?id=0190…"
```

A write is a row, not an action. The database's own rules still apply — foreign
keys, CHECK constraints, and the triggers that register a record for tagging — and
a refusal comes back as a `400` or `409` in Postgres's own words: a `409` when the
row conflicts with rows already there, and a `413` for a body larger than the
server takes. Nothing the
screens do around a write runs: no import deduplication, no transfer pairing, and
no file on disk created or removed with a document row.

A trip or an idea removed in the app is hidden for a minute, so the undo bar can
bring it back, and then deleted with the documents attached to it alone — other
than a payslip or a document another record cites, which only lose the link. A client
can do the same by setting `removed_at`, rather than deleting the row, which leaves
its documents behind. Whatever time is sent, `removed_at` is stamped with the time
of the call, and `null` brings the record back within that minute.

Never reachable, not even to read: `api_token`, `session`, `enrollment_token`,
`setup_claim` and `settings`, which decide who can sign in or hold the Home
Assistant token. A person's password hash and a calendar's credential are left out
of their rows; a person's role and whether they may sign in can be read but not
written; a connected calendar is read-only. Those are Settings actions. A column
naming an uploaded file — a document's `stored_name`, a photo, a property's
images — can be read but not written: a file uploaded under `/api/v1/files` is
named by the server, so all a caller could put there is another row's file. The
job queue is read-only too, since a queued import carries its file's bytes and
`/api/v1/files` is the one way in for those; a job's row leaves those bytes out.

A shelf's `key` is written when the shelf is added and fixed after, since it is
how the app finds the inbox and the other shelves it files paper on; whether a
shelf is a system one, and a document type built in, can be read but not written.
A system shelf, a built-in document type and an administrator cannot be deleted
over the API, and answer `409`.

### Files

A PDF can be attached to any record a token reaches — a trip, a trip idea, a bottle,
a recipe — and is filed in the archive as a document linked to it, on the Inbox
shelf, the way the Trips screen files a booking confirmation, and read for search
like any other document. PDF only, checked by
the file's contents: an HTML page served from Continuum's own address could run
script as whoever opened it.

| Call                                 | Does                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `POST /api/v1/files`                 | Attach a PDF: multipart `file`, `attach_to` (the record's id) and optional `name`; answers `201` |
| `GET /api/v1/files?attached_to=<id>` | What is attached to that record                                                                  |
| `GET /api/v1/files/<id>`             | The PDF itself                                                                                   |
| `DELETE /api/v1/files/<id>`          | Remove it and its file, to replace a plan                                                        |

A limited token sees and removes a document only when every record it is attached
to is inside its areas, so a passport scan filed against a trip and a person stays
out of a travel planner's reach. A record outside its areas answers `404`, as a
record that does not exist does. A token given **Documents** reaches the whole
archive instead — every document, whatever it is filed against, and the list of
what is attached to any record — as the Documents screen does. A file over the
upload limit answers `413`, and anything but a PDF `415`.

```sh
# A plan for an idea
curl -X POST -H "Authorization: Bearer <token>" \
  -F file=@lofoten.pdf -F attach_to=0190… -F name="Lofoten in March" \
  http://continuum.local/api/v1/files
```

## Smart-meter billing

When connecting Home Assistant, choose the lived-in property whose bill the meter
should feed and enter the energy price per kWh. The price is optional; without one
the sync does nothing. It is taken in the base currency in force when you type it,
and stored with that currency, so changing the household's base currency later does
not silently reprice the meter.

On that property, mark exactly one bill with the meter control — marking a second
moves the mark rather than adding one. The sync updates only that row and converts
the price into the property's currency; it never creates a guessed "energy" bill.
It runs every hour, and also the moment you connect Home Assistant or mark a bill.
If the provider or target changes while a slow snapshot is in flight, that stale
reading is discarded.
