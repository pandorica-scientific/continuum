# Yearly tax statements

Status: approved design, not yet implemented.

Nothing in Continuum records what a household actually paid in tax. The salary
tracker knows gross pay from payslips, but a tax statement is a different
document with different figures, and there is nowhere to put it.

This records the yearly tax statement each person receives, in each country they
receive one, and draws the history.

## What this is not

**Not a tax engine.** It does not compute liability. There are no brackets, no
allowances, no contribution ceilings, no residency rules, no treaty handling, no
three-year time test. Those change annually per jurisdiction and being subtly
wrong about them has consequences beyond a wrong-looking chart.

The app does not assert what is owed. It remembers what a statement said.

## Scope

In scope:

- A statement per person, per country, per year.
- Two canonical figures every statement has, plus any number of labelled lines.
- The gross figure pre-filled from the salary tracker, correctable.
- Optionally attaching the statement document.
- Three history charts, one series per person and country.

Out of scope, deliberately:

- Any computation of what is owed.
- A validated country list. Country is free text; hard-coding jurisdictions is
  the sort of thing this codebase forbids, and it would have to be maintained.
- Currency conversion between statements. Each series is one person in one
  country, so a series never mixes currencies and nothing needs converting.
- Capital gains. See "Designed to grow" below.

## Schema

```
tax_statement
  id               text primary key
  personId         text not null → person(id) on delete cascade
  year             integer not null
  country          text not null            -- free text, e.g. "CZ", "PL"
  currency         text not null            -- the statement's own currency
  grossIncomeMinor bigint not null
  taxPaidMinor     bigint not null
  documentId       text → document(id) on delete set null
  note             text
  createdAt        timestamptz not null default now()
  unique (personId, year, country)

tax_statement_line
  id           text primary key
  statementId  text not null → tax_statement(id) on delete cascade
  label        text not null                -- "Social insurance", "Refund"
  amountMinor  bigint not null
  sort         integer not null default 0
```

The two canonical fields exist because every statement everywhere has a figure
for income and a figure for tax, which is what lets the charts always have
something to draw. Everything a particular country itemises separately —
social, health, credits, refund — is a labelled line, so no jurisdiction is
encoded in the schema.

One statement per person per country per year, edited rather than duplicated.

`documentId` points at the statement itself on the existing `tax` shelf in
Documents, rather than inventing a second place for files.

## Prefilling from payslips

When **creating** a statement, the gross figure is pre-filled from the salary
tracker's total for that person and year, with the source shown beside it ("from
12 payslips"). The user can change it before saving.

Two rules make this safe:

- Prefill happens only on creation. A saved figure is never re-derived or
  overwritten.
- The source of the saved number is **not** stored. The screen recomputes the
  payslip total at display time and quietly notes when the saved figure differs
  ("payslips total 1 240 000 — this statement says 1 305 000").

That divergence is normal and worth seeing rather than hiding: bonuses, other
income and corrections all make a declared figure differ from the sum of
payslips. Storing a "derived from payslips" flag would go stale the moment
either side changed; recomputing cannot.

## Charts

Three, each with one series per person and country:

| Chart                  | What it shows                                 |
| ---------------------- | --------------------------------------------- |
| Gross income by year   | the trajectory                                |
| Tax paid by year       | what it actually cost                         |
| Effective rate by year | the one that reveals a change in circumstance |

The effective rate is derived, never stored: `taxPaidMinor / grossIncomeMinor`.
A statement with zero gross shows no rate rather than a division error.

## Screens

A **Tax** screen, a toggleable module in the registry — unlike the register,
tags or rules, a household with one salary and no foreign income does not need
it. It sits in the Money group.

Statements grouped by person, then country, newest year first. Add and edit in a
dialog following the existing `Modal` precedent: year, country, currency, the two
figures, the labelled lines, an optional document, a note.

## Designed to grow

The parts most likely to be extended, and where that extension goes:

- **More figures** become labelled lines. No migration, no schema change.
- **New countries** need nothing: country is free text.
- **Capital gains**, when wanted, contributes a labelled line to an existing
  statement rather than a new table. `brokerPosition` already carries
  `openedAt`, `closedAt`, `purchaseValueMinor` and `saleValueMinor`, so the
  arithmetic of a realised gain is available; whether that gain is taxable is
  jurisdiction logic and stays out. The honest form of that feature surfaces
  "these lots were held under three years" as a fact to act on, not a tax figure
  the app invented.
- **The API** exposes none of this yet. When it does it belongs in a later
  version, per the API spec's own note.

## Testing

Unit:

- The effective rate, including a zero-gross statement yielding no rate rather
  than a division error.
- Chart series grouping: two people in two countries produce four series, and a
  person with statements in two countries is not merged into one line.
- The payslip-divergence note appears only when the figures actually differ.

E2E, extending the existing serial journey:

- Add a statement for a person and a year; the gross arrives pre-filled from the
  payslip total and can be changed before saving.
- The saved figure survives a reload rather than being re-derived.
- A labelled line is recorded and shown.
- The charts render a series for that person and country.

## Build order

1. Schema and migration.
2. Effective rate and series grouping, pure and unit-tested.
3. The Tax screen: list and add, with prefill.
4. Labelled lines and the document link.
5. The three charts.
6. Demo seeding and the E2E journey.
