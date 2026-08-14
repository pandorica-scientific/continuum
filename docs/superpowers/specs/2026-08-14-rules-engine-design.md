# Rules engine

Status: approved design, not yet implemented.

The categoriser today is a matcher, not an engine. A rule is one field, one
pattern, one category, and the unique index on `(matcherType, pattern)` means a
counterparty maps to exactly one category forever. Rules are invisible: they are
learned silently from corrections and there is no way to see them, edit them, or
write one by hand. "Only when the amount is over 4 000" cannot be expressed at
all.

This design replaces it with a rule engine that carries several conditions,
applies more than one kind of action, and learns how much to trust itself from
whether its suggestions survive contact with a human.

## What is preserved

The existing categoriser has one property worth more than any feature: it never
guesses silently. Two rules that disagree send the row to review rather than
picking a winner. That guarantee survives here in a stronger form — the row
still goes to review, but now arrives with the best-supported suggestion already
filled in, instead of nothing.

## Scope

In scope:

- Rules with several conditions, all of which must hold.
- Two actions: set a category (exclusive) and add tags (additive).
- A confidence per rule, derived from how often its suggestions were accepted or
  corrected.
- A rules screen: list, create, edit, delete, and preview which existing
  transactions a rule would match before saving it.

Out of scope, decided deliberately:

- **Transfer marking.** `markTransferRule` and the transfer-pairing evidence
  tiers are untouched. That code has a history of silent corruption and is not
  worth disturbing for tidiness.
- **Splitting by rule.** A rule cannot divide a transaction into proportions.
  Worth revisiting once splits have been in use for a while.
- **Notes.** No rule-stamped free-text field; `description` belongs to the bank
  and must not be overwritten.
- **Regular expressions.** Text conditions keep normalised whole-word
  containment. A bad regex is hard to debug and easy to make slow.
- **AND/OR nesting.** Conditions are ANDed. Nesting turns the editor into a
  query builder, which would be most of the work for a case a second rule
  already covers.

## Schema

```
rule
  id              text primary key
  name            text not null
  enabled         boolean not null default true
  provenance      text not null            -- seeded | learned | manual
  conditions      jsonb not null           -- array of {field, op, value}, ANDed
  categoryId      text → category(id) on delete set null   -- null = tags only
  acceptedCount   integer not null default 0
  correctedCount  integer not null default 0
  createdAt       timestamptz not null default now()

rule_tag
  ruleId text → rule(id) on delete cascade
  tagId  text → tag(id) on delete cascade
  primary key (ruleId, tagId)
```

Conditions live in `jsonb` rather than a child table: they are always read as a
set with their rule and never queried independently, and `jsonb` already has
precedent in this schema.

Condition fields and operators:

| Field            | Operator                                   |
| ---------------- | ------------------------------------------ |
| `counterparty`   | normalised whole-word containment          |
| `description`    | normalised whole-word containment          |
| `counterAccount` | exact, whitespace stripped                 |
| `variableSymbol` | exact                                      |
| `amount`         | magnitude between an inclusive min and max |

Text normalisation is the existing `normalise()`: lowercased, diacritics
stripped, punctuation collapsed. Amount conditions compare magnitudes, so they
read the same either side of zero, consistent with the register's filters.

**The unique index goes away.** Today `(matcherType, pattern)` is unique, so one
pattern means one category. The new model allows two rules to claim the same
counterparty — that is what makes a contested row possible, and contested rows
are the mechanism by which the engine asks instead of guessing. It is a real
loosening of a constraint, made on purpose.

## Deciding

`decide()` stays pure: it takes a row and the rules, and returns a decision. It
never touches the database.

**Tags are additive.** Every matching rule contributes its tags. Two rules
cannot disagree about a tag, so no weighing is involved.

**Category is exclusive**, and confidence decides it. A rule's confidence is the
**Wilson score lower bound** on `accepted / (accepted + corrected)`:

```
confidence = (p + z²/2n − z·√[(p(1−p) + z²/4n) / n]) / (1 + z²/n)
where p = accepted / n,  n = accepted + corrected
```

Wilson is used rather than a plain ratio because a household sees a given
merchant a handful of times a year. A rule that was right once has a plain ratio
of 100%, which is precisely when it should not be trusted; the Wilson bound is
conservative at small `n` and relaxes as evidence accumulates. `z` is a
mathematical constant for the chosen confidence level, which is the kind of
constant this codebase permits. The **auto-file threshold is a setting**, not a
constant.

**Both seeded and learned rules begin with a prior.** A curated starter rule
behaves as though already accepted a few times, so a fresh install files
automatically from the first import rather than asking about every supermarket.
A learned rule gets the same treatment for a different reason: it exists only
because a human explicitly chose that category, which is itself an acceptance.
Without this, migration would reset every learned rule to zero evidence, push it
below the threshold, and dump years of previously-automatic filings into the
review queue — the exact regression step 4 of the build order is meant to catch.

Only a rule written by hand starts from no evidence, and even then its author
can see the confidence climb on the rules screen.

**Ties are broken deterministically**: the rule with more conditions wins, being
the more specific; if still tied, the older rule wins. A tie never changes
whether the row is contested — it only decides which category is pre-filled.

Given the matching rules that carry a category:

| Situation                              | Outcome                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------- |
| No category-bearing match              | `needs_review`, reason "first time seeing this counterparty"                          |
| One distinct category, above threshold | Filed automatically                                                                   |
| One distinct category, below threshold | `needs_review` with that category pre-filled                                          |
| Several distinct categories            | Contested: `needs_review`, highest confidence pre-filled, reason names the contenders |

## Learning

- Confirming a suggestion in review increments `acceptedCount` on the rule that
  proposed it.
- Changing the category of a row a rule decided increments `correctedCount` on
  that rule, and creates or reinforces a rule for the category actually chosen —
  the existing `learnRule` behaviour.
- On a **contested** row, every matching rule that proposed a category other
  than the one chosen also takes a `correctedCount`. They were in the room and
  they were wrong; without this a persistently mistaken rule would keep
  contesting rows forever without ever losing standing.

**Silence is not consent.** An auto-filed row that nobody looked at does not
increment `acceptedCount`. Only an explicit confirmation counts. Otherwise
confidence would compound on rows no human ever checked, and the engine would
grow more certain the less it was supervised.

A consequence worth stating plainly: once a rule is above the threshold and
filing silently, its confidence can only fall, because the only signal it can
still receive is a correction. That is the intended behaviour, not an
oversight — a trusted rule stays trusted until it is shown to be wrong.

Scoring needs to know which rules had an opinion about a row. Rather than store
rule ids on the transaction, the matcher is re-run against the current rules at
correction time: the row and the rules are both to hand, and the result names
every rule that matched and what each proposed. If the rules have changed since
the row was filed this scores the present rule set rather than a historical one,
which is the more useful of the two.

The transaction gains one column, `suggestedCategoryId`, so the review queue can
show its pre-filled guess without recomputing on every render.

## Scope of application

Rules never modify a `confirmed` row. A human decided those, and no rule
outranks that.

Rules re-run on import, when a rule is created or edited, and after a
correction — which is what `pairAndCategorise()` already does today.

The preview runs the same pure matcher over existing transactions and writes
nothing, so a broad rule can be inspected before it touches anything.

## Screens

A `/rules` screen in the Money nav group, no module toggle, consistent with how
the register and cash flow are treated as core money screens.

Each rule shows its name, conditions, actions, confidence, and its accepted and
corrected counts, so a rule that keeps being overridden is visible as such. The
editor builds conditions from the table above and previews matches against real
transactions before saving.

The review queue gains the suggested category pre-filled, and the reason names
the rule that suggested it.

## Migration

The 42 seeded rules and every learned rule migrate to single-condition rules of
the new shape: `matcherType` becomes the condition field, `pattern` becomes its
value, `categoryId` carries over, and `provenance` is preserved. Both seeded and
learned rules receive the prior described above, so nothing that files
automatically today starts asking for confirmation tomorrow.

`categoryRule` is dropped once the migration has run.

## Testing

Unit:

- The Wilson bound at `n = 0`, `n = 1` and larger `n`, showing it stays
  conservative when evidence is thin.
- `decide()` across all four situations in the table above.
- Multi-condition matching: a rule with a counterparty and an amount range
  matches only inside the range.
- Amount conditions compare magnitudes, so a rule matches money out and money in
  alike.
- Tags from two matching rules both apply; categories from two matching rules
  contest.
- A `confirmed` row is never modified by any rule.
- Ties break by condition count, then by age, deterministically.
- A migrated learned rule clears the threshold immediately, so migration does
  not push previously-automatic filings back into review.

E2E, extending the existing serial journey:

- Create a rule with two conditions on the rules screen, preview its matches,
  save it, and see it file a transaction.
- Correct a rule-filed transaction and see the rule's corrected count rise.
- A contested transaction reaches review with a suggestion rather than nothing.

## Build order

1. Schema, migration from `categoryRule`, keeping the old matcher working.
2. Confidence arithmetic, pure and unit-tested on its own.
3. The new `decide()` over the new rule shape, unit-tested against the four
   situations.
4. Ingest and `pairAndCategorise()` moved onto it; existing tests must stay green
   with the migrated rules, which proves the migration behaviour-preserving.
5. Accepted and corrected counting wired into review and correction.
6. The rules screen: list and confidence.
7. The rule editor and the match preview.
8. Demo seeding and the E2E journey.

Step 4 is the safety checkpoint, as it was for splits: if the suite passes with
migrated rules and no UI yet, the new engine is a faithful replacement before
anything new depends on it.
