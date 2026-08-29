# Screenshot gallery

Every screenshot here is generated from the demo household by
`scripts/take-screenshots.mjs` against a running `DEMO=1` instance, in both
themes, rather than drawn by hand — so what you see is the app, as of the last
time the script was run. GitHub serves whichever theme you are reading in.

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

## Accounts

Balances stay in their own currency. Only totals convert.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/accounts-dark-web.png">
  <source media="(prefers-color-scheme: light)" srcset="screenshots/accounts-light-web.png">
  <img src="screenshots/accounts-dark-web.png" alt="Accounts — balances stay in their own currency. only totals convert">
</picture>

## Transactions

A month at a time: what it took in and what it spent, opened into its rows, and
a row opened into everything you can do to it — file it, split a receipt across
categories, tag it into a project, or turn it into a rule.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/transactions-dark-web.png">
  <source media="(prefers-color-scheme: light)" srcset="screenshots/transactions-light-web.png">
  <img src="screenshots/transactions-dark-web.png" alt="Transactions — a register of months, one of them opened into its rows">
</picture>

## Import

Statements in, transactions filed. Only the ambiguous ones ask for you.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/import-dark-web.png">
  <source media="(prefers-color-scheme: light)" srcset="screenshots/import-light-web.png">
  <img src="screenshots/import-dark-web.png" alt="Import — statements in, transactions filed. only the ambiguous ones ask for you">
</picture>

## Rules

What files itself, and how much each rule has earned your trust.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/rules-dark-web.png">
  <source media="(prefers-color-scheme: light)" srcset="screenshots/rules-light-web.png">
  <img src="screenshots/rules-dark-web.png" alt="Rules — what files itself, and how much each rule has earned your trust">
</picture>

## Tags

What each project has cost so far, across every category it touches.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/tags-dark-web.png">
  <source media="(prefers-color-scheme: light)" srcset="screenshots/tags-light-web.png">
  <img src="screenshots/tags-dark-web.png" alt="Tags — what each project has cost so far, across every category it touches">
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

## Salary

What was earned each month, read from payslips and from the ledger.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/salary-dark-web.png">
  <source media="(prefers-color-scheme: light)" srcset="screenshots/salary-light-web.png">
  <img src="screenshots/salary-dark-web.png" alt="Salary — what was earned each month, read from payslips and from the ledger">
</picture>

## Retirement

The projection model.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshots/retirement-dark-web.png">
  <source media="(prefers-color-scheme: light)" srcset="screenshots/retirement-light-web.png">
  <img src="screenshots/retirement-dark-web.png" alt="Retirement — the projection model">
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
