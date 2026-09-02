# Documents

The household's paper: filed on shelves you name, searchable by what is printed
inside it, and visible only to the people who should see it.

## The model, in four words

Four independent things describe a document. Keeping them apart is what stops
the archive turning into a folder tree nobody can navigate.

|           | What it answers                 | Shape                                                                                         |
| --------- | ------------------------------- | --------------------------------------------------------------------------------------------- |
| **Shelf** | where in life it belongs        | one per document, a row you own                                                               |
| **Type**  | what kind of paper it is        | one per document, a fixed list                                                                |
| **Links** | what it concerns                | many — a person, flat, tenancy, account, loan, contact, subject, transaction or tax statement |
| **Tags**  | anything else you cut across by | many, free text                                                                               |

A payslip lives on **Income & Tax**, is of type **payslip**, links to
**Zaměstnavatel s.r.o.**, and might be tagged `2025 return`. Move the shelf and
nothing breaks: the salary tracker reads the type, never the shelf.

Since v0.8.0 a fifth thing describes a payslip and not a boiler manual: which
**lane** on its card it sits in. That is not a fifth axis — a lane belongs to
one card, and a card belongs to one shelf — but it is what lets a shelf say
_March never arrived_.

### What a document can be about

A person, a flat, a tenancy, an account, a loan, a contact, a subject — and a
transaction or a tax statement, which are filed from their own screens rather
than picked here: a list of every transaction in the household is a list nobody
can read by eye. The inspector shows all of them under **About**. The first
seven are chips you tick; the last two are chips with a `✕`, because the only
thing to decide about them is whether they stay.

A payslip that was matched to the bank credit it was paid by links to that
transaction too, the same way a receipt links to the payment it evidences — so
the slip stating the gross and the credit stating the net are one click apart.
The match runs when the slip arrives after the credit, which is the ordinary
order; a slip filed before the bank statement that pays it leaves the two rows
side by side without the link.

**Save keeps every link it was shown.** That matters because it once did not:
the panel could offer people, flats and subjects, and saving replaced the whole
set with what it had offered — so opening a receipt and pressing Save threw away
the payment it evidenced. Removing a link is now something you do to a chip.

### Shelves are questions

**A shelf is one question, one unit, one template.** Eight come with a fresh
install, and each opens on a screen that answers its own question rather than
on a list of everything it holds.

| Shelf           | Asks                                    | A card is           | Draws               |
| --------------- | --------------------------------------- | ------------------- | ------------------- |
| 📥 Inbox        | What still needs deciding?              | the document itself | a queue             |
| 🪪 IDs          | Does everybody hold a valid document?   | a person            | a wallet            |
| 🧾 Statements   | Is any month missing?                   | an account          | a ribbon            |
| 🏛️ Income & Tax | Which filing never arrived?             | an organisation     | cards               |
| 🩺 Health       | What happened to this person, and when? | a person            | cards, oldest first |
| 🔧 Inventory    | Is this still under warranty?           | a thing you own     | cards with slots    |
| 🏠 Property     | What does this address require of us?   | an address          | cards               |
| 🚗 Vehicles     | Is this vehicle covered and legal?      | a vehicle           | cards               |

Seven of the eight cannot be deleted. Four because the application writes to
them by name — capture files into **Inbox**, an accepted import into
**Statements**, payslips and tax attachments into **Income & Tax**, bills into
**Property** — and three because they are the paper every household has:
**IDs**, **Health** and **Inventory**. **Vehicles** is removable: not every
household drives.

Every one of them can be renamed, re-ordered and given a different emoji.
Press the pencil beside **SHELVES** in the rail.

**Deleting a shelf always moves its paper first.** The dialog asks where the
documents go and does both in one transaction; the database refuses the delete
otherwise, so there is no path that leaves a document unfiled.

### Making a shelf of your own

`+ New shelf` asks for three things, because all three are what a shelf IS: a
name, a **template**, and what it is **organised by**. A shelf you make is as
good as one that ships — before v0.8.0 it got a plain list and no question,
which made it a folder.

Seven templates, four of which are the same engine with a different start:

| Template         | Starts with                                             |
| ---------------- | ------------------------------------------------------- |
| **Queue**        | one document at a time, until nothing is left           |
| **Wallet**       | a card per document, by whose it is                     |
| **Completeness** | a band per account, across the year                     |
| **Dossier**      | a card per counterparty, with what it owes you          |
| **Timeline**     | a card per person or thing, in the order it happened    |
| **Kit**          | a card per thing, with its receipt, warranty and manual |
| **Obligations**  | a card per thing, with what falls due and when          |

The last four all draw a **card**. What differs is what a new card begins with
and which way its history reads; nothing about a template removes a part, so a
card on a Timeline shelf that gains a yearly lane draws its cells.

### Cards

On the five card shelves, the shelf is a stack of cards — one per person,
organisation, address or thing. A card holds, top to bottom:

- **its name**, kind, and how much paper it holds;
- **a relationship line** where there is one: the current role, and when the
  whole thing began, which after a promotion are two different years;
- **the pinned document** the relationship rests on — the contract, the lease,
  the purchase;
- **lanes**, each with a rhythm and a row of cells;
- **history**, for the paper that has no rhythm, which is most of it.

Cards sort **findings first**: a card with a hole in it is what the shelf
exists to show. Every card opens expanded; a click on its header collapses it
to one line naming what it is hiding, and the set of collapsed cards is in the
address, so a bookmark keeps it.

**A card is made where it is used.** `+ New card` at the end of the stack asks
for a name and an emoji and seeds the shelf's lanes. People, accounts and
addresses have screens of their own, so those shelves offer no New card: a card
for each exists the moment the record does. Rename and archive live in the
card's own `⋯` menu.

**Paper that names no card sits on "Not assigned yet"**, last, and only when it
holds something. That is what makes filing to a shelf before its card exists a
safe thing to do.

### Lanes and slots

**A lane is a rhythm.** _Payslips, monthly._ _Technical inspection, every two
years._ It draws one cell per period, and each cell is in one of four states —
filed, a gap, not arrived yet, or before the relationship began. The last is
what stops a car bought in 2021 reading as missing five years of insurance.

**A slot is a lane that expects paper once.** Receipt, warranty, manual. One
cell, filled or not, carrying its own name — because a nameless empty square
says nothing about which paper is missing.

**A cadence is declared, never inferred.** One quarterly upload does not make
an account quarterly, and a taxpayer's declaration is annual because the law
says so.

**A document is in a lane because somebody put it there.** A lane's rule
_proposes_ one and a person confirms; matching alone cannot say which of two
lanes on one card holds a payslip when both match it. The Lane picker in the
inspector is where that is changed afterwards.

### The Inbox is a queue

Opening Inbox shows the oldest unfiled document: the file on the left, the
decision on the right. The decision is three steps, and they are three because
each narrows the next — **the shelf** decides which cards exist, **the card**
decides which lanes exist, and **the lane** decides what the paper probably is.

A card can be made on the way past. The moment you know the paper is the
Octavia's is the moment the shelf needs a card for it, and being sent elsewhere
to make one loses the document you were holding.

Where a rule matched, all three are pre-answered and the guess stays on screen
until somebody agrees with it. Skip files nothing and deletes nothing.

### As a list

Every shelf opens its own list: the same documents, grouped and sorted, with
the type, about and tag filters and bulk editing. It is one press away and it
is where a search always lands — a match is explained by the line it was found
in, and a card face has nowhere to put one.

**Everything** is that list with no shelf.

### Who a document was with

A shelf says where in life a document belongs and a subject says what it is
about. **An organisation says who it was with** — an employer, the tax office,
an insurer. It is a record, created once and linked to, for the same reason a
subject is one rather than a name retyped on a receipt: a string typed twice is
a string that will one day be typed differently, and then one employer is two
employers and nothing in the archive can say so.

It is not a contact. A contact is a person who happens to have an employer; two
colleagues at one institute would be two records, and an employer nobody knows
anyone at could not exist.

**A person's dealings with an organisation are role periods, and a promotion is
a second period rather than an edit to the first.**

```
Robert @ Institute of Physics
  PhD student         2018-09-01 → 2021-08-31
  Research scientist  2021-09-01 → (open)
```

Overwriting the role would be simpler and wrong. What the archive needs to know
is when the paperwork started arriving, and that is 2018 — so the relationship
counts from the earliest period, and a promotion cannot quietly move the
beginning forward and take three years of missing paperwork with it.

### Which shelf a document belongs on

**A document files with its subject, not with its consequence.** A mortgage is
about the flat, so it goes on **Property**; a car loan goes on **Vehicles**; a
plumber's invoice goes on Property and a service invoice on Vehicles. There is
no shelf for "financial paperwork" as a category, because almost none of it is
about money in the abstract — it is about a thing you own, and that is where you
will look for it.

**One document, one shelf, and no links across shelves.** What a document may
be about is narrowed to its own shelf, so filing a car's policy offers the cars
and not the boiler — and not the insurer whose letters live on Income & Tax.
A car's insurer and the health insurer are two records because they answer to
two different shelves, which is the rule doing its job rather than a
duplication.

**Income & Tax** is what is left once that rule is applied: money that arrives
because of a _person_, and what the state takes of it. Payslips, tax returns and
the assessment, the employer's annual income confirmation, social security and
health insurance statements, employment contracts, and letters from the tax
office. A household where somebody is self-employed adds the invoices they
issued. Nothing here is about an object.

The case that looks like an exception and is not: **a mortgage-interest
confirmation**. Its subject is the flat, so it files on Property — and it reaches
the tax year through a **link**, not by changing shelf. That is what links are
for, and it is why a year's filing can gather papers from four shelves without
any of them being the wrong place. Shelf is where in life, type is what kind,
links are what it concerns.

Every shelf, list or not, now knows what it is for: an empty one says what
belongs on it, its type filter offers those kinds first, and picking a shelf
during inbox review shortens the type list to that shelf's own and chooses the
first — marked _suggested_, cleared the moment you touch the field, and never
overwriting an answer you gave already. `Show all types…` opens the full list
for the document that does not fit.

The inspector's own Shelf and Type fields work the same way, so filing a
document from the Inbox is the same act as filing it from review — and a
document that already has a type keeps it: a shelf fills the field in only when
nobody has answered it yet.

**A reminder window belongs to the kind of paper, not to the app.** A document
turns amber sixty days before it expires, which is right for most things and
wrong for a passport: replacing one takes half a year, so a warning with sixty
days left is a warning about a trip that can no longer be made. Identity
documents ship with six months, every other type uses the sixty-day default, and
the window is a property of the type — how long a replacement takes is a fact
about a country and a household, not about this repository.

**That list is yours.** Press the pencil beside **SHELVES** in the rail and each
row gains a tag button: it opens every type with the shelf's own ticked. It
works on a system shelf as much as on one you made — Identity cannot be deleted,
but what it suggests is your business. Nothing is ever refused by it: a shelf
takes any document of any type, and the list only decides what is offered
first.

### Identity details

An identity document carries five more fields, in the inspector: kind, country,
number, issued on, and issuer. All optional. The kind and the country are what
the wallet card draws; the number is shown only here, masked until you click it,
and is never searched.

**They are typed by hand, always.** Nothing reads the document to fill them in.
Continuum reads documents for their text so you can search inside them, and that
pipeline is forbidden from writing a record's fields — a passport number a
recogniser got wrong is worse than an empty box, because the empty box asks and
the wrong one is believed.

Changing a document's type away from _Identity document_ hides these fields and
keeps them. Change it back and what you typed is still there.

### Types

Seventeen come with the app: contract, invoice, receipt, payslip, bank
statement, broker report, insurance policy, claim, identity document,
certificate, medical record, tax document, technical plan, correspondence,
warranty, manual, other.

**You can add your own.** Open a shelf's type list from the rail and name one —
a vaccination book, a lease annex. It behaves like any other type from then on:
filed, filtered, grouped, offered first by whichever shelves you tick it onto.

The seventeen cannot be removed, because behaviour hangs off them — the salary
tracker reads `payslip`, statement import writes `bank_statement`, an uploaded
broker report writes `broker_report`, tax attachments write `tax_document`, and
the Identity wallet reads `id_document`. Removing one would quietly unhook a
feature. Yours carry no behaviour at all, which is what makes them safe to
invent, and one that nothing is filed as can be removed again.

For something that cuts across types — a renovation, a holiday — use **tags**
instead: free, searchable, and nothing in the code depends on them either.

## Subjects

A subject is a thing in the household that has paperwork but no screen of its
own: the car, the dog, the household itself. A flat has a Property screen and a
loan has a Loans screen, so their paper is filed against those records; a car
has neither, and inventing a screen for it would be building a module to hold
four documents.

Subjects live in the rail, under **SUBJECTS**, and behave much like the shelves
above them. A row filters the list to the paper about that subject without
leaving the shelf you are on, and the pencil turns the section into its own
settings — click a name to rename it, pick a different emoji, `⋯` to archive one
or bring it back, `+ New subject` to add one. The one thing you cannot do is
re-order them: they are sorted by name, so there is no order to drag into. Two
subjects cannot share a name, and _Car_ and _car_ count as the same name.

### Archiving

Archive a subject — a car you have sold — and its paperwork leaves the default
view without being deleted. Its expiry dates stop being red: they are history,
not a problem, and a lapsed insurance policy painted red on every visit is how a
person learns to ignore red. Archiving is the only removal a subject has, and
the dialog says how many documents move before you agree to it: what once held
paper is put away rather than deleted.

Archived rows are dimmed rather than removed from their own section, and appear
only while **Include archived subjects** is on. When it is off, the section
carries a **Show N archived** row saying how many it is holding back, so a
subject you archived is never behind a door with no handle. The search says the
same thing in its own words: when every match sits on an archived subject, it
offers to show them rather than reporting nothing.

The household itself can be renamed and given a different emoji but never
archived. It is the one subject every document may belong to, so archiving it
would hide the household's own paper from the household.

## Adding paper

`+ Add document` takes one file or many. Each becomes its own document named
after its file, and every one lands in the **Inbox**. Nothing is required — no
name, no shelf, no date. A document with a file and a generated name is a valid
document.

Under **About — optional** it offers the same chips the inspector does, grouped
by kind, so a lease you have just scanned can be filed against the tenancy while
you still remember whose it is. Typing into **Or a new subject** makes one on the
spot; a name that already exists files against it rather than making a second.
Coming from another screen, the record you came from is shown ready-linked: a
pickable kind arrives already ticked in its group, while a transaction or a
tax statement — neither offers a pickable list — arrives as a read-only chip
instead, since there is nothing to tick it out of.

Filing is still a separate pass, so dropping twenty scans never turns into twenty
forms.

### Filing from the queue

The Inbox draws the queue itself — see _The Inbox is a queue_ above. Shelf,
card and lane, then `File it`; the next document takes its place immediately.

- The **shelf carries over** from the previous filing, because a folder import
  is twenty near-identical documents. The card and the lane do not: a folder of
  everything must not file its second document onto the first one's card.
- Choosing a lane also answers the **type**, where the lane's rule names one.
  Proposed, never imposed — the select is still there.
- `Skip` files nothing and deletes nothing.
- `Delete` is there for what should never have arrived: a duplicate, a photo of
  the floor. Two taps, and the file goes with the record.

## On a record's own screen

The Documents screen is not the only place paper appears. Every record with a
screen of its own shows the same card there — a flat and its tenancy on
Property, a loan on Loans, an account under **Statements and reports**, a
contact in its edit panel, a transaction's **Receipts** in its dialog, a tax
statement's **Attachments** on Tax, and broker reports under **Reports** on
Investments. It is one card everywhere on purpose: when each screen drew its own
list, each of them came to know a different amount about expiry dates,
unlinking, and what a restricted document is.

A row is the document itself. Its file opens in the viewer, and under the name
sits the shelf it lives on and when it falls due — red once the date has passed,
amber inside the window, quiet otherwise, on the same rule as the Documents
screen. The blue and purple that say which _kind_ of deadline it is do not come
with it: one line has no room to explain the difference between two quiet
states. **Open in Documents →** goes to the full list filtered to that record,
which is the same filter the rail's subject rows write.

Below the rows are the two ways paper is added by hand. Either can be absent,
and the absence is the screen's answer rather than an oversight:

- A picker reading _Attach a document you already have…_, with an **Attach**
  button beside it, files a document already on a shelf against this record too
  — the lease you scanned into the Inbox last week, now linked to the tenancy.
  It offers only what is not linked yet, and only what you are allowed to see.
  A flat, a tenancy, a loan, an account, a contact and a transaction all have
  one.
- **➕ Add a document** opens capture with this record already ticked and its
  shelf already chosen, so filing from the flat you were looking at costs no
  retyping. A flat, a tenancy, a loan and a contact have it.

Everywhere else, paper arrives some other way and the card lists rather than
collects: an account's statements come from importing them, a broker report from
the upload above the card on Investments, and a receipt and a tax attachment
from their own drop zone beside it.

Where a card offers it, the `✕` on a row removes the **link**, not the document:
the paper stays on its shelf, so a mis-click costs one re-attach and nothing
else. Receipts are the exception — deleting a receipt from a transaction deletes
the document, so that one asks twice. A tax attachment you want gone rather than
merely unhooked is deleted from the Documents screen, where every other document
is deleted.

## Deleting a document

`Delete` on a document removes the row, the file and every link to it. What
hangs off the paper decides what happens next, and the rule is the same
wherever the delete is pressed:

- **A bill or a receipt keeps its row.** The expense was recorded from the
  ledger, not from the paper; the transaction simply loses its paperclip.
- **A payslip takes its salary entry with it.** The month's pay was read off
  that slip, and leaving the figure behind would count a month of pay with
  nothing on screen to account for it. Where the bank credit for that month had
  been merged into the same entry, the credit is re-recorded on its own — the
  bank proved that figure, and the slip's departure does not unprove it. The
  transaction itself is untouched.
- **A bank statement behind an accepted import cannot be deleted.** It answers
  _This is the statement behind an import; it stays with the import._, because
  the import register exists to show what it read, and a file that is gone
  cannot be re-read when a parser improves.

The same reasoning stops two edits rather than deletes: a payslip that carries a
salary entry cannot be retyped as something else, and the person it belongs to
cannot be unticked. Both leave the figure counted and unaccounted for, so both
are refused with _This payslip carries a salary entry; delete it from the Salary
screen to unhook it._ — the screen where the figure is visible is the screen
that should decide.

A member who cannot see a restricted document is told it is not there rather
than that they may not have it, for the same reason the rest of the rule works
that way.

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

File a lease against its tenancy, or a re-fixation letter against its loan, and
give it the same date the tenancy or loan already carries — the tenancy's end,
the loan's current fixation end — and the Overview and calendar remind you once,
from the record, rather than twice for the same deadline. Date the document
differently and both reminders stand; the rule only ever collapses an exact
duplicate.

## Finding things

The search field reads names, notes, tags, linked entities, shelf and type
labels — **and the text inside the documents**.

- What a document is about counts for every kind, under the name you were
  shown: a receipt is found by the shop its transaction names, a lease by its
  tenant, a mortgage statement by the name of the loan, a tax attachment by the
  year. None of those words is anywhere on the paper.
- Diacritics fold both ways: `rezim` finds `režim`, and the reverse.
- Identifiers work: a variable symbol like `10078410` is found inside a scanned
  page, which no word-based search would do.
- A name match always outranks a mention on page forty, and a document appears
  exactly once however many ways it matched.

Below the search field: filter by **type**, by **what it is about**, and by any
number of **tags** at once. **What it is about** offers every kind the paper on
the shelf points at, under the heading it belongs to — a transaction carries its
amount, because a shop and a date do not tell two payments apart. Each filter
offers only what is on the shelf in view, with the count it would leave, so no
filter empties the screen. Everything lives in
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

The rule follows the paper onto every other screen, and stops there. What a
member loses is the row, the name, the paperclip and the file — wherever they
would have appeared. A salary month still shows its gross and net and only loses
the paperclip; a tax statement still shows what it declared and what was paid,
without the attachment; the document is off the flat's card, off the loan's, off
a transaction's receipts, off the Investments reports, and out of the Tags view
— the tag's count included. Only the paper is hidden, because a module's own
figures were never the document's, and hiding a salary because its slip is
private would be answering a different question from the one that was asked.

Restricted documents generate no calendar events for **anyone**, including
administrators, because a synced event lands on a device outside the app's
session entirely.

## Tags

**Tags** in the rail lists every tag with what it is on and what it has cost,
across documents, properties, loans and transactions alike — a tag applied only
to a line of a transaction has no card to list, so it shows instead as a line
count. Each tag keeps one colour everywhere it appears, derived from its name.

Adding a tag offers the ones you already have as you type, so `renovation` is
picked rather than retyped as `renovations`. Deleting one says first what it
would untag — the transactions and split lines with no card in the list
included — and how many rules would stop applying it.

## Bulk changes

`Select` puts a checkbox on each row. The bar that appears sets shelf or type
(each document has one, so these replace), and adds links and tags (these are
sets, so they add — a bulk edit never silently clears what it did not mention).

A payslip that carries a salary entry keeps its type: retyping it would leave a
month's pay counted with nothing on screen to account for it. Everything else in
the same edit still applies to it, and the message above the list says how many
were left as they were.

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
