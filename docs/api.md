# API and Home Assistant

## Read-only API

Settings → API tokens creates a bearer token (shown once) that grants read-only
access to the whole ledger under `/api/v1` — accounts, transactions (accepting the
register's filter params), categories, tags, net worth and cash-flow totals. Every
amount crosses the wire as integer minor units plus a currency code, never a
float:

```sh
curl -H "Authorization: Bearer <token>" http://your-server/api/v1/networth
# { "total": { "amountMinor": 646055100, "currency": "CZK" }, … }
```

There are no write endpoints and no webhooks — a household produces a handful of
events a week, so a dashboard polls.

## Smart-meter billing

When connecting Home Assistant, choose the lived-in property whose bill the meter
should feed and enter the energy price with its currency. On that property, mark
exactly one bill with the meter control. The hourly sync updates only that row and
converts the price into the property's currency; it never creates a guessed
"energy" bill. If the provider or target changes while a slow snapshot is in
flight, that stale reading is discarded.
