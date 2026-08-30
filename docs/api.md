# API and Home Assistant

## Read-only API

Settings → API tokens creates a bearer token (shown once) that grants read-only
access to the whole ledger under `/api/v1` — accounts, transactions (accepting the
register's filter params, `group=<category group>` among them), categories, tags,
net worth and cash-flow totals. Every amount crosses the wire as integer minor
units plus a currency code, never a float:

```sh
curl -H "Authorization: Bearer <token>" http://your-server/api/v1/networth
# { "total": { "amountMinor": 646055100, "currency": "CZK" }, … }
```

There are no write endpoints and no webhooks — a household produces a handful of
events a week, so a dashboard polls.

`/api/v1/transactions` measures `from`, `to` and `month` on the day the money moved —
the value date where the bank printed one, the booking date otherwise — which is the
day cash flow sums on, so the same window means the same rows on both. Each row still
reports `bookedAt`, the day the bank booked it.

`/api/v1/cashflow` takes `period=ytd|month|12m` (an unknown one is a 400, unlike the
screens, which fall back) and `anchor=YYYY-MM` for the month the window ends on — a month
outside the record is clamped to it rather than refused. It answers with `period`, a
`caption` naming the window in words, `totals` as the four figures `in`, `out`, `saved`
and `kept`, and `previous` — the same `caption` and `totals` for the window one step back,
or `null` where the record does not reach that far. `kept` is the cash left over **after**
saving; what was put aside is `saved`. All four are display-grade sums converted into the base
currency, not ledger-grade ones: the per-transaction endpoints are the exact figures.

## Smart-meter billing

When connecting Home Assistant, choose the lived-in property whose bill the meter
should feed and enter the energy price with its currency. On that property, mark
exactly one bill with the meter control. The hourly sync updates only that row and
converts the price into the property's currency; it never creates a guessed
"energy" bill. If the provider or target changes while a slow snapshot is in
flight, that stale reading is discarded.
