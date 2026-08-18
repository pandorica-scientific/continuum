# Screenshot gallery

Every screenshot here is generated from the demo household by
`scripts/take-screenshots.mjs` against a running `DEMO=1` instance, in both
themes, so none of them can drift from the app. GitHub serves whichever theme
you are reading in.

To regenerate them, point the script at a running demo instance:

```sh
DEMO=1 docker compose up -d
node scripts/take-screenshots.mjs
```

## Overview

A board each person arranges for themselves, from thirteen panels.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/overview-dark-web.png">
  <source media="(prefers-color-scheme: light)" srcset="screenshots/overview-light-web.png">
  <img src="screenshots/overview-dark-web.png" alt="Overview — A board each person arranges for themselves, from thirteen panels">
</picture>

## Transactions

Search, split a receipt across categories, tag into projects.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/transactions-dark-web.png">
  <source media="(prefers-color-scheme: light)" srcset="screenshots/transactions-light-web.png">
  <img src="screenshots/transactions-dark-web.png" alt="Transactions — Search, split a receipt across categories, tag into projects">
</picture>

## Cash flow

A Sankey in the order money is committed.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/cashflow-dark-web.png">
  <source media="(prefers-color-scheme: light)" srcset="screenshots/cashflow-light-web.png">
  <img src="screenshots/cashflow-dark-web.png" alt="Cash flow — A Sankey in the order money is committed">
</picture>

## Property

Tenancies, drawable floor plans, bills with documents attached.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/property-dark-web.png">
  <source media="(prefers-color-scheme: light)" srcset="screenshots/property-light-web.png">
  <img src="screenshots/property-dark-web.png" alt="Property — Tenancies, drawable floor plans, bills with documents attached">
</picture>

## Loans

Fixation-period interest, what-if repayment and re-fix previews.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/loans-dark-web.png">
  <source media="(prefers-color-scheme: light)" srcset="screenshots/loans-light-web.png">
  <img src="screenshots/loans-dark-web.png" alt="Loans — Fixation-period interest, what-if repayment and re-fix previews">
</picture>

## Investments

Portfolio fed by broker report uploads.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/investments-dark-web.png">
  <source media="(prefers-color-scheme: light)" srcset="screenshots/investments-light-web.png">
  <img src="screenshots/investments-dark-web.png" alt="Investments — Portfolio fed by broker report uploads">
</picture>

## Retirement

Projection driven by a payslip-fed salary tracker.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/retirement-dark-web.png">
  <source media="(prefers-color-scheme: light)" srcset="screenshots/retirement-light-web.png">
  <img src="screenshots/retirement-dark-web.png" alt="Retirement — Projection driven by a payslip-fed salary tracker">
</picture>

## Tax

Yearly statements per person and country, pre-filled from payslips.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/tax-dark-web.png">
  <source media="(prefers-color-scheme: light)" srcset="screenshots/tax-light-web.png">
  <img src="screenshots/tax-dark-web.png" alt="Tax — Yearly statements per person and country, pre-filled from payslips">
</picture>

## Calendar

Ledger dates and your own events, two-way sync with Google and iCloud.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/calendar-dark-web.png">
  <source media="(prefers-color-scheme: light)" srcset="screenshots/calendar-light-web.png">
  <img src="screenshots/calendar-dark-web.png" alt="Calendar — Ledger dates and your own events, two-way sync with Google and iCloud">
</picture>

## Contacts

Tenants, tradespeople and bank contacts, linked to what they relate to.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/contacts-dark-web.png">
  <source media="(prefers-color-scheme: light)" srcset="screenshots/contacts-light-web.png">
  <img src="screenshots/contacts-dark-web.png" alt="Contacts — Tenants, tradespeople and bank contacts, linked to what they relate to">
</picture>

## Documents

Filed against something real, so renames follow and expiries surface.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/documents-dark-web.png">
  <source media="(prefers-color-scheme: light)" srcset="screenshots/documents-light-web.png">
  <img src="screenshots/documents-dark-web.png" alt="Documents — Filed against something real, so renames follow and expiries surface">
</picture>

## On a phone

Every screen reflows to one column.

<p align="center">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/overview-dark-mobile.png">
  <source media="(prefers-color-scheme: light)" srcset="screenshots/overview-light-mobile.png">
  <img src="screenshots/overview-dark-mobile.png" alt="Overview on a phone" height="420">
</picture>
&nbsp;
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/transactions-dark-mobile.png">
  <source media="(prefers-color-scheme: light)" srcset="screenshots/transactions-light-mobile.png">
  <img src="screenshots/transactions-dark-mobile.png" alt="Transactions on a phone" height="420">
</picture>
&nbsp;
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/calendar-dark-mobile.png">
  <source media="(prefers-color-scheme: light)" srcset="screenshots/calendar-light-mobile.png">
  <img src="screenshots/calendar-dark-mobile.png" alt="Calendar on a phone" height="420">
</picture>
&nbsp;
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/property-dark-mobile.png">
  <source media="(prefers-color-scheme: light)" srcset="screenshots/property-light-mobile.png">
  <img src="screenshots/property-dark-mobile.png" alt="Property on a phone" height="420">
</picture>
&nbsp;
</p>
