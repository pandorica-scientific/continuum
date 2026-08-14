# Splits and tags

Status: approved design, not yet implemented.

One transaction currently carries one category, so a supermarket receipt that is
half groceries and half a kettle cannot be told the truth about. Tags do not
exist at all, so nothing can be grouped across categories — there is no way to
ask what a renovation has cost so far.

This design adds both: split lines that divide a transaction between categories,
and tags that group transactions and lines into projects with running totals.

## Scope

In scope:

- Dividing one transaction between several categories.
- Tags on transactions and on individual split lines.
- A running total per tag, and a screen that lists them.
- Filtering the register by tag, with line-aware category filtering and totals.

Out of scope, decided deliberately:

- **Person attribution.** Split lines do not name who the spending belongs to.
- **Reimbursables.** No settled/unsettled lifecycle, no matching a repayment.
- **Loan principal and interest.** Loans already book interest per fixation
  period; splitting the bank transaction as well would double-count in cash
  flow.
- **Tax treatment.** Tags carry no tax meaning. Tax treatment belongs to the
  tax module and will most likely sit at category level, not tag level.

## Schema

```
transaction_split
  id            text primary key
  transactionId text not null → transaction(id) on delete cascade
  amountMinor   bigint not null      -- minor units of the transaction currency
  categoryId    text → category(id) on delete set null
  note          text
  sort          integer not null default 0

tag
  id             text primary key
  name           text not null
  normalisedName text not null unique
  createdAt      timestamptz not null

transaction_tag
  transactionId text → transaction(id) on delete cascade
  tagId         text → tag(id) on delete cascade
  primary key (transactionId, tagId)

transaction_split_tag
  splitId text → transaction_split(id) on delete cascade
  tagId   text → tag(id) on delete cascade
  primary key (splitId, tagId)
```

`transaction` is unchanged structurally. Split lines inherit the transaction's
currency and are never re-denominated, consistent with the rest of the ledger.

Tags have no `kind` field. Both purposes they serve — projects and plain labels
— are satisfied by giving every tag a running total, so no distinction is
needed.

`normalisedName` is the name trimmed, lowercased and with internal whitespace
collapsed to single spaces. It carries the unique constraint, so `Renovation`,
`renovation` and `Renovation ` are one tag, while `name` preserves whatever
casing was typed first for display.

## The resolution seam

Splits are optional: an unsplit transaction has no `transaction_split` rows.
The risk in that model is a consumer that forgets to check for splits and
silently reports a wrong total.

Two decisions contain that risk.

**One accessor, one branch.** No consumer asks whether a transaction has splits.
A single pure function resolves a transaction into the lines that count:

```ts
effectiveLines(txn, splits): { categoryId: string | null; amountMinor: bigint }[]
```

An unsplit transaction yields one synthetic line carrying `transaction.categoryId`
and the full amount. A split transaction yields its split rows. Cash flow, the
briefing, the register, tag totals and any future consumer call this. The branch
exists once, is pure, and is unit-tested.

**Splitting nulls the parent category.** When a transaction gains splits,
`transaction.categoryId` is set to `null`. If some future query does forget the
branch, it then sees an uncategorised transaction and reports it as unfiled —
visible in the waterfall — rather than confidently attributing the full amount
to a stale category. The failure mode is noisy rather than silent.

## Invariants

1. Split amounts sum exactly to `transaction.amount`.
2. Every split amount has the same sign as `transaction.amount`.
3. A transaction with splits has `categoryId = null`.
4. A transaction has either zero splits or at least two. A single split is
   meaningless and is rejected — use the transaction's own category instead.

All four are enforced in one write path, `saveSplits()`, rather than at each
call site. No database trigger: it would be the only one in the schema, and the
existing correctness anchors are enforced in application code and tests.

**Bank fees.** Split amounts sum to `transaction.amount`, which is gross of any
`feeMinor`. Cash flow works in net terms (`amount - feeMinor`), so
`effectiveLines` subtracts the whole fee from the first line by `sort` order.
This keeps the lines summing to exactly the net amount with no rounding drift,
and it matches today's behaviour for an unsplit transaction, where the single
line is the whole net amount. Apportioning the fee across lines was rejected:
it introduces rounding for a value that is null on most rows.

Deleting splits restores the transaction to unsplit. `categoryId` stays null and
`reviewState` returns to `needs_review`, so the transaction goes back to the
review queue rather than silently reverting to a category nobody chose.

## Tag totals

A tag's total is the sum of the effective lines it covers.

- A transaction-level tag covers every effective line of that transaction.
- A split-level tag covers only its own line.
- If a transaction carries a tag and one of its splits carries the same tag,
  the transaction counts once, at transaction level.

That last rule is the only place a tag total could silently inflate, so it is
stated explicitly and tested directly.

Totals are summed per currency and never re-denominated. The converted figure
alongside them converts each line at its own transaction's effective date
(`valueDate` falling back to `bookedAt`), which is exactly what `cashflow.ts`
already does — not at today's rate, so a tag total does not drift when rates
move.

## Screens

**Register.** Rows gain tag chips. A split transaction expands to show its
lines. Filters gain a tag filter. The category filter changes meaning: a
transaction matches when any of its effective lines match.

The filtered total sums matching **lines**, not matching transactions. Filtering
by Groceries when a receipt was half groceries shows the groceries half. This is
the single most likely thing to get wrong, and it has a test of its own.

**Split dialog.** Follows the existing `Modal.svelte` and `RepayDialog`
precedent. Lines carry an amount, a category and an optional note, with the
remainder computed live so the form cannot be saved unbalanced.

**Tags screen.** A list of tags with running totals at `/tags`, in the Money
nav group with no module toggle, matching how the register and cash flow are
treated as core money screens. Each tag links into the register filtered by it.

**Tag input.** A combobox that creates tags on the fly, available on register
rows and in the split dialog.

## Interaction with the categoriser

`learnRule` currently learns "this counterparty means this category" whenever a
transaction is filed. A split transaction has no single answer, so:

- Splitting does not teach a rule.
- The register's File control is hidden for split rows.
- Splitting marks the transaction `confirmed`, so it leaves the review queue.

## Consumers to update

| File                             | Change                                                              |
| -------------------------------- | ------------------------------------------------------------------- |
| `src/lib/server/cashflow.ts`     | Aggregate over `effectiveLines` instead of `transaction.categoryId` |
| `src/lib/server/briefing.ts`     | Overspend detection reads lines (see note below)                    |
| `src/lib/server/transactions.ts` | Line-aware category filtering, line-summed totals, tag filter       |
| `src/routes/(app)/transactions/` | Tag chips, expandable split rows, split dialog                      |
| `src/lib/server/demo.ts`         | Seed one split transaction and one tag                              |

`briefing.ts` is the one consumer that aggregates in SQL, joining
`transaction.categoryId` to `category` and grouping in the database. It cannot
call `effectiveLines` as it stands. Rather than reproduce the branch as a SQL
view — a second implementation of the same rule, free to drift from the first —
it moves to fetching rows and aggregating in JavaScript through the seam, which
is what `cashflow.ts` already does. At household data volumes this is not a
performance concern, and `cashflow.ts` already selects the full table elsewhere.

Ingest, the fingerprint scheme and the transfer-pairing machinery are untouched:
splits are derived from a transaction after import, never imported.

## Testing

Unit:

- `effectiveLines` for both shapes, including a split transaction whose parent
  category is null.
- The four invariants, each rejected at the `saveSplits()` boundary.
- The tag double-count rule, specifically a transaction tagged at both levels.
- Line-summed filter totals: filtering by one category of a split receipt
  returns that category's share, not the whole amount.

E2E, extending the existing serial journey:

- Split an imported transaction between two categories.
- Confirm cash flow attributes both categories.
- Tag it, and confirm the tag total on `/tags`.

## Build order

1. Schema and migration.
2. `effectiveLines` and `saveSplits()` with their unit tests.
3. Cash flow and briefing moved onto the seam — no UI yet, existing tests must
   stay green, which proves the seam is behaviour-preserving for unsplit data.
4. Split dialog and expandable register rows.
5. Tags: schema, input, chips, register filter.
6. Tags screen with totals.
7. Demo seeding, E2E journey.

Step 3 is the safety checkpoint: if the whole suite passes after moving cash
flow onto `effectiveLines` while no transaction is yet split, the seam is proven
before any feature depends on it.
