# Documents

The household's paper: filed on shelves you name, searchable by what is printed
inside it, and visible only to the people who should see it.

## The model, in four words

Four independent things describe a document. Keeping them apart is what stops
the archive turning into a folder tree nobody can navigate.

|           | What it answers                 | Shape                                    |
| --------- | ------------------------------- | ---------------------------------------- |
| **Shelf** | where in life it belongs        | one per document, a row you own          |
| **Type**  | what kind of paper it is        | one per document, a fixed list           |
| **Links** | what it concerns                | many — people, flats, accounts, subjects |
| **Tags**  | anything else you cut across by | many, free text                          |

A payslip lives on **Finance**, is of type **payslip**, links to **Jana**, and
might be tagged `2025 return`. Move the shelf and nothing breaks: the salary
tracker reads the type, never the shelf.

### Shelves are yours

Ten come with a fresh install — Inbox, Identity, Family, Health, Property,
Tenancy, Vehicles, Finance, Household, Statements — and every one of them can
be renamed, re-ordered, given a different emoji, or removed. Press the pencil
beside **SHELVES** in the rail: rows become draggable, a click on a name renames
it, `⋯` removes it, and `+ New shelf` adds one.

Shelves are one level deep and always will be. Volume is answered by filtering
and grouping, not by nesting folders.

**Deleting a shelf always moves its paper first.** The dialog asks where the
documents go and does both in one transaction; the database refuses the delete
otherwise, so there is no path — through the screen or otherwise — that leaves
a document unfiled.

**Inbox** and **Statements** are system shelves. You can rename them (_K
vyřízení_ is a fine name for the inbox) and change their emoji, but they cannot
be deleted: capture files into one and an accepted bank import files into the
other.

### Types

A closed list: contract, invoice, receipt, payslip, bank statement, insurance
policy, claim, identity document, certificate, medical record, tax document,
technical plan, correspondence, warranty, manual, other.

It is closed because behaviour hangs off it — the salary tracker reads
`payslip`, statement import writes `bank_statement`, tax attachments write
`tax_document`. Renaming those would quietly unhook a feature. For anything
specific to your household, use **tags**: free, searchable, and nothing in the
code depends on them.

## Adding paper

`+ Add document` takes one file or many. Each becomes its own document named
after its file, and every one lands in the **Inbox**. Nothing else is asked —
no name, no shelf, no date. A document with a file and a generated name is a
valid document.

Filing is a separate pass, so dropping twenty scans never turns into twenty
forms.

### Inbox review

**Review inbox** deals with them one at a time: the page on the left, the
fields on the right, `Skip` or `File & next →`. Enter files, Escape leaves.

- Shelf and type **carry over** from the previous filing — a folder import is
  twenty near-identical documents — and the word `kept` beside the label says
  so until you change it.
- `Skip` files nothing and deletes nothing, so a lap of pure skipping is a
  no-op. At the end it offers the ones you skipped, then leaves them in the
  Inbox.
- `Delete` is there for what should never have arrived: a duplicate, a photo of
  the floor. Two taps, and the file goes with the record.

## Expiry dates

Three verbs, and the word carries the meaning:

| Verb      | What it means                                                      | Reads as        |
| --------- | ------------------------------------------------------------------ | --------------- |
| `renews`  | a successor arrives on the date — insurance, an ID card            | blue, quietly   |
| `expires` | validity stops and nothing replaces it — a warranty, a certificate | purple, quietly |
| `due`     | money is owed by the date                                          | blue, quietly   |

The colour says whether a deadline has **fired**, not which kind it is: amber
inside 60 days (30 for `due`), red once it has passed. A lapsed `expires` drops
back to quiet after a month — nothing replaces it and nothing is owed, so the
alarm has said all it can. `renews` and `due` stay red until you change the date
or archive the subject, because nothing can know that the replacement was filed
or the bill was paid.

Dates use your platform's own date picker. A document with no date shows when it
arrived instead, in an outline pill — the same shape as its neighbours, with no
fill, because there is nothing behind it to act on.

### Archived subjects

Archive a subject — a sold car, a flat you no longer own — and its paperwork
leaves the default view without being deleted. Its expiry stops being red: it is
history, not a problem. **Include archived subjects** brings it back, and the
search says when matches exist only there.

## Finding things

The search field reads names, notes, tags, linked entities, shelf and type
labels — **and the text inside the documents**.

- Diacritics fold both ways: `rezim` finds `režim`, and the reverse.
- Identifiers work: a variable symbol like `10078410` is found inside a scanned
  page, which no word-based search would do.
- A name match always outranks a mention on page forty, and a document appears
  exactly once however many ways it matched.

Below the search field: filter by **type**, by **what it is about**, and by any
number of **tags** at once. Each offers only what is on the shelf in view, with
the count it would leave, so no filter empties the screen. Everything lives in
the URL — a bookmark is a saved view.

When the search finds nothing it says which part of the archive could not
answer: how many documents are still being read, how many have no searchable
text at all, and how many matches sit on archived subjects.

### How the text gets there

Every filed document with a readable file is queued for reading. A PDF gives up
its text layer page by page; a page without one is rendered and recognised
instead — so a typed contract with one scanned signature page is handled
correctly in both halves. Images are recognised, plain text and CSV are sliced.

Reading shares a single CPU slot with statement import, so a backlog is worked
through steadily rather than all at once, and large files are read in bounded
slices — the inspector says which pages are searchable and offers to continue.

Extraction never edits a document. It writes text and nothing else: no names,
no dates, no amounts.

## Restricted documents

An administrator can mark a document **restricted**. It is then _absent_ for
household members rather than locked: no row, no search hit, no count, no
briefing item, no calendar event, no file — a member cannot infer it exists from
a number that is one too high. Administrators see a quiet lock beside the name.

Restricted documents generate no calendar events for **anyone**, including
administrators, because a synced event lands on a device outside the app's
session entirely.

## Tags

**Tags** in the rail lists every tag with what it is on and what it has cost,
across documents and transactions alike. Each tag keeps one colour everywhere it
appears, derived from its name.

Adding a tag offers the ones you already have as you type, so `renovation` is
picked rather than retyped as `renovations`.

## Bulk changes

`Select` puts a checkbox on each row. The bar that appears sets shelf or type
(each document has one, so these replace), and adds links and tags (these are
sets, so they add — a bulk edit never silently clears what it did not mention).

## Importing a backlog

`scripts/import-documents.mjs` walks a directory and files what it finds:

```
DATABASE_URL=… node scripts/import-documents.mjs ~/scans --mapping mapping.json
```

A mapping table you edit turns a path segment into a shelf, a type and a tag.
Files already in the archive are recognised by their contents, not their names,
so a second run imports only what is new. **Anything the table does not cover
goes to the Inbox** rather than being guessed at, and each import is queued for
reading rather than read inline. `--dry-run` prints what it would do.

Deciding _who_ a document is about stays a job for the screen: a folder name
cannot know whose passport this is, and a wrong link is worse than none.
