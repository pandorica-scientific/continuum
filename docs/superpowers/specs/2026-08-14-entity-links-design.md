# Entity links

Status: approved design, not yet implemented.

Documents are attached to people and flats by a free-text `subject` string,
matched case-insensitively against the entity's name. Three screens already
repeat that comparison:

| Screen     | How it links                                                          |
| ---------- | --------------------------------------------------------------------- |
| Retirement | `d.subject.trim().toLowerCase() === person.name.trim().toLowerCase()` |
| Property   | the same comparison against `property.name`                           |
| Documents  | derives its columns from the distinct `subject` strings present       |

There is no key, so nothing at the database level holds these together. **Rename
a person or a flat and every document about them silently orphans.** A typo
creates a phantom subject and a phantom column, indistinguishable from a real
one. And a document can concern only one subject, so a mortgage statement about
two people and two flats has to pick one.

This replaces the string match with real links, without losing what the
free-text subject was good at.

## Every document belongs to something

There is no free text. A document always concerns a person, a flat, an
investment, or the household — and the household is a **record**, not a
fallback string.

The schema comment states the old intent: _"a third flat or a new child creates
a column by itself — no configuration"_. That emergent quality survives, but
through a better mechanism: a new subject is a row you create once and then
link to, rather than a name you retype on every document and hope matches. A
typo in a record is visible and fixed once; a typo in a free-text field is a
phantom column that looks exactly like a real one.

**What can a document belong to:**

| Kind       | Record                                               |
| ---------- | ---------------------------------------------------- |
| Person     | `person`                                             |
| Flat       | `property`                                           |
| Investment | `account` where `kind = 'brokerage'`                 |
| Subject    | `subject` — the household, and anything else you add |

`subject` is where "the household", "the car", "the dog" live. Seeded with one
row for the household so there is always somewhere for a document to belong,
and the user adds more as needed. Adding one is creating a record, not typing a
string.

`document.subject` — the free-text column — is **dropped**. Nothing in the
schema accepts an unvalidated name for a thing.

## Scope

In scope:

- Several people and several properties per document, as typed join tables.
- Column derivation that follows a rename, because it reads the linked entity's
  current name.
- Tags widened beyond transactions, to documents, properties and loans.
- Backlinks visible on the entity screens.
- A migration that backfills existing links from the subject strings and reports
  what it could not match.

Out of scope, deliberately:

- **A generic edge table.** `link(fromType, fromId, toType, toId)` cannot be
  foreign-keyed in Postgres, so it would trade string fragility for key-less
  fragility — the same defect with better branding. It also cannot express
  cascade rules, and deleting a person must behave differently from deleting a
  tag.
- **User-defined relationship types.** No vocabulary of edge kinds until
  something concrete needs one.
- **A graph visualisation screen.** Links must be legible where you already are;
  a picture of the graph is a separate, later, optional thing.
- **Links for their own sake.** Each join table appears when a screen needs it,
  following `loanProperty`'s existing precedent, not speculatively.

## Schema

```
subject            id, name, emoji, createdAt   -- household, car, dog, …

document_person    documentId → document, personId → person      pk(both)
document_property  documentId → document, propertyId → property  pk(both)
document_account   documentId → document, accountId → account    pk(both)
document_subject   documentId → document, subjectId → subject    pk(both)

property_tag       propertyId → property, tagId → tag            pk(both)
loan_tag           loanId → loan, tagId → tag                    pk(both)
document_tag       documentId → document, tagId → tag            pk(both)
```

All cascade on delete of either side, except that the seeded household subject
cannot be deleted while documents point at it.

A document must link to **at least one** of the four. The add form enforces it;
saving with nothing ticked is refused, and the household is one click away, so
the rule costs nothing.

`loanProperty` already links loans to properties at explicit shares and is left
exactly as it is.

Documents currently carry a `tags` jsonb column of free strings. That is
superseded by `document_tag`, so document tags and transaction tags become the
same vocabulary rather than two that look alike. The migration moves them.

## Migration

Seed the `subject` table with one row, "Household".

Then for every document, classify its free-text subject:

1. Matches `person.name` (trimmed, lowercased) → insert `document_person`.
2. Otherwise matches `property.name` → insert `document_property`.
3. Otherwise matches a brokerage `account.name` → insert `document_account`.
4. Otherwise **a `subject` record is created from the text** (one per distinct
   name, reusing on repeat) and the document linked to it. An empty subject
   links to the household.

Nothing is lost and nothing stays as loose text: after the migration every
document belongs to something, and the free-text column is dropped.

Existing `document.tags` entries become `tag` rows via the same normalisation
`normaliseTagName` already uses, and `document_tag` links.

**The migration reports its counts** — documents linked to people, properties,
accounts, and the subject records it had to create (with their names) — rather
than assuming. A surprising entry in that last list means a name changed at
some point and the link was already broken, or a typo has been masquerading as
a subject; either way it is now a visible record that can be renamed or merged,
not a phantom column.

## Reading a link

Column derivation on the Documents screen changes from "distinct subject
strings" to "linked people, then properties, then investment accounts, then
subject records". Every column now reads a record's current name, so **renaming
anything renames its column and keeps every document** — and a phantom column
can no longer exist, because there is no string to typo.

## UI principle

Links are only worth having if they are visible where you already are. This is a
requirement, not a preference, and it rules out the obvious implementations:

- **No collapsed "Related (5)" panel.** Information one click away is
  information that effectively does not exist. Linked items are listed inline,
  capped at a handful, with "+3 more" only on genuine overflow.
- **No separate graph screen as the way in.** Links belong on the flat's card,
  the document row, the person.
- **No extra step to create a link.** Today you type a subject while adding a
  document. Now you tick a person and pick a flat in that same form. If linking
  costs more interactions than the field it replaces, the refactor made the app
  worse to use however much better the schema is.
- **A count is not a link.** A backlinks strip shows the actual items. A number
  you must click implies work and hides the thing it is advertising.

**Checkboxes, not autocomplete.** A household has two or three people and one or
two flats. At that scale several-links is a row of checkboxes labelled with
names — visible at a glance, one click each, and the "both of us" case becomes
obvious rather than a chip-management exercise. Autocomplete is the right
control at fifty entities and the wrong one at three.

## Screens

| Screen              | Change                                                                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Documents, add/edit | Checkboxes: people, flats, investment accounts, subjects — at least one. A "＋ new subject" affordance creates the record in place. |
| Documents, list     | Shows what each document belongs to, as plain text                                                                                  |
| Documents, columns  | Derived from linked records' current names — phantom columns impossible                                                             |
| Property card       | The documents, loans and transactions referencing this flat, listed                                                                 |
| Retirement          | Payslips found by `document_person`, not by name comparison                                                                         |
| Tags screen         | Totals unchanged; a tag also lists the documents and properties it tags                                                             |

The subject-creation affordance lives inside the add-document form — a small
"＋" beside the subject checkboxes that asks for a name and ticks the new box —
so creating "Car" the first time costs one extra interaction, and never again.

## Consequences for work already planned

The tax-statements plan instructs its implementer to replicate the retirement
name comparison. **This lands first**, and that instruction is replaced by a
`document_person` join. Doing it the other way round would add a fourth consumer
of the string match and then migrate it days later.

## Testing

Unit:

- Column derivation reads linked records' current names.
- Renaming a person keeps their documents, where the old comparison lost them.
- A document linked to two people appears in both columns without being counted
  twice in any total.
- The migration's classifier: subjects matching a person, a property, a
  brokerage account, and nothing, land in the four expected buckets — and two
  documents with the same unmatched subject share one created record.
- A document with no links is refused at the save boundary.

E2E, extending the existing serial journey:

- Add a document ticking both people; it shows under both.
- Create a new subject from within the add form and file a document under it.
- ~~Rename a person in Settings; the document is still theirs.~~ No rename
  mechanism exists anywhere in the app, so this cannot run as E2E. The property
  is structural once links store ids rather than names, and is covered at unit
  level: column derivation reads the linked record's current name.
- A flat's card lists the documents referencing it, as items rather than a count.

## Build order

1. Schema and the join tables.
2. Migration with backfill, reporting its three counts.
3. Documents: add/edit checkboxes, list display, column derivation.
4. Retirement and Property read through the joins; the name comparison is
   deleted from both.
5. Tags widened to documents, properties and loans.
6. Backlinks strips.
7. Demo seeding and the E2E journey.

Step 4 is the checkpoint: when the last name comparison is deleted and the suite
is still green, the string match is gone for good rather than merely bypassed.
