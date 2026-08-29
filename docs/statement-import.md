# How statement import works

Reference for the reading engine: what it does, in what order, and — at the end —
what it still cannot do and why, so that work can be picked up later without
re-deriving the diagnosis.

---

## Which export to download

Most banks offer more than one, and only some of them are statements.

**Fio** — choose **Výpis z účtu**, not _Pohyby na účtu_. The movement list prints
no balances at all, so nothing in it can show whether every row is there;
Continuum refuses it and says so rather than pretending. The statement export
prints opening and closing balances and imports without trouble.

**Revolut** — the account statement CSV. It contains every _pocket_ you hold,
told apart by its `Product` column, and each keeps its own running balance.
Continuum reads one statement per pocket, so a Savings pocket does not get
checked against your current account's figures.

**Anything else** — a CSV, a spreadsheet or a PDF. The layout is worked out from
the file and checked against the statement's own balances, so no per-bank setup
is needed. If a file cannot prove itself, it is refused: see below.

## The governing rule

> **No preset may ever be the reason a statement is accepted. A preset can only make
> acceptance _fast_. Acceptance itself is always arithmetic.**

Everything below follows from that. A bank adapter, a saved layout, a mapping a
person confirmed by hand — each of them answers _what are these columns_, which is
a question about structure. None of them answers _do these movements add up_, which
is a question only the statement's own figures can settle.

The practical consequence is that this reader **refuses more than it guesses**. A
file it cannot prove is turned away with a reason, never filed on a plausible
reading. That is deliberate: a wrong number in a ledger is worse than a missing
one, because a missing one announces itself.

---

## The pipeline

### 1. Safety — `safety.ts`

Runs before any parser sees the bytes. Signature and size checks; for zip-based
formats (`.xlsx`, `.ods`) the archive is inspected, and then **actually inflated
under a shared byte budget**. The declared sizes in a zip's central directory are
written by whoever made the file, so they are read for their error message and
believed for nothing: a 299 KB upload declaring zero bytes of content expanded to
300 MB in testing. Sheet and cell caps apply after the workbook opens, because
bounding the compressed bytes bounds the XML and the XML is not what costs the
memory.

### 2. Format — `format.ts`

Sniffed from the **bytes**, never the extension. A `.txt` holding CAMT.053 is
CAMT.053; a `.csv` that is really a PDF is a PDF.

### 3. Reading

Three routes, all of which end at the same gate.

**Declared formats** — `standards/camt053.ts`, `mt940.ts`, `abo.ts`, `ofx.ts`.
These state their own structure, so nothing is inferred. They are read completely
and correctly: 47 of 47 corpus files, across every locale and currency in it.

**Bank adapters** — `adapters/*.ts`. Five hand-written mappings, kept as a fast
path. **None of them is load-bearing any more**: with every adapter bypassed, all
fourteen importing real statements are still read. An adapter's claim on a file is
a hypothesis — if it matches a signature and then cannot read the file, or reads no
movements, the file falls through to the generic reader rather than failing.

**The generic reader** — `tabular/`. Everything else. Described below.

### 4. The gate — `proof.ts`

Every route arrives here, including the adapters and the declared formats.

The statement's own arithmetic is tested against the rows that were read:

| Class  | Evidence                                                             |
| ------ | -------------------------------------------------------------------- |
| **P4** | running chain + opening and closing + stated totals + movement count |
| **P3** | a complete running balance chain                                     |
| **P2** | opening + movements = closing, corroborated by stated totals         |
| **P1** | opening and closing balances agree with the movements                |
| **P0** | nothing in the statement could be checked                            |

Ranked lexicographically — the class is decided by evidence, never by a weighted
score that could let a well-labelled failure outrank a proof. **Contradicted
evidence is fatal whatever else passed**: a chain closes over the rows it has, so
it cannot see a movement missing from the end; the printed closing balance can, and
does.

**Lexical checks gate every class.** Arithmetic closure alone is not proof — a
uniform 1000× misreading of amounts _and_ balances closes the chain perfectly. So
the displayed text is checked against the parsed values: monetary precision
compatible with the currency, consistent decimal and grouping, identifier columns
never reinterpreted as money.

P0 is refused. A confirmed mapping can carry a P1 or a P2 past the gate; it cannot
carry a P0, because confirming what the columns are says nothing about whether the
rows are all there.

### 5. Ingest — `ingest.ts`

Account resolution, deduplication by content hash and by transaction fingerprint,
transfer pairing, categorisation. One further arithmetic check lives here rather
than in the proof engine, because it needs data the file does not contain: a
running chain with **no printed opening balance** cannot see a movement dropped
from its head, so it is checked against the balance the account was last left at.
Beyond a month's gap nothing is said — a hole in someone's statement history looks
exactly like a hole in one statement.

---

## The generic reader

### Candidate readings

The file is read **several ways at once**, and the readings compete.

For delimited text: encoding × delimiter, plus a repair pass that rejoins fields
split by a delimiter that is also the decimal mark (`799,56` → `799` + `56`).
For PDFs: two independent assemblers, below. For workbooks: one candidate per
sheet.

Readings are ranked by **proof class first, then coverage**. Where two equally
complete readings of equal proof contradict each other, the file is refused as
genuinely undecided rather than resolved by preference.

Sheets are the exception: a workbook's sheets are separate **parts**, not rival
readings, so every one of them is kept. Choosing between them would silently drop
an account.

### The two PDF assemblers

A PDF has no columns, only glyphs at coordinates. Two different approaches recover
a table, and neither dominates:

**`frompdf.ts` — line classification.** Asks of each line "does this start a
movement?" and absorbs continuation lines into the record above. Reads
one-line-per-movement layouts well.

**`rhythm.ts` — record rhythm.** Never classifies a line. Asks what the page's
record _beat_ is: cells cluster into columns (left edge for text, right edge for
figures, because statements right-align money); within one column, cells of one
type recurring at regular spacing form a **run**, which is a hypothesis that the
table beats there; content hangs _below_ its anchor. A hypothesis is valid when the
table it implies has one figure per record and a date in nearly every record.

Both are offered to the proof engine, which chooses. On one statement the first
reads 140 movements the second fragments; on four banks the second reads what the
first cannot.

### Working out what the columns mean

In order: a **saved profile** matched by header labels (never by position); the
**header dictionary** in `tabular/vocabulary.ts`; then **shape**, and finally
**arithmetic**.

The arithmetic is the strongest signal and is what makes a headerless ledger
readable at all: if one column's consecutive differences equal another column's
values, the first is a running balance and the second is the movement — and neither
needed a label to say so.

Several repairs run afterwards, each of which exists because a real statement
defeated the step before it:

- **One amount column, and it is the filled one.** A statement can print two columns
  whose labels both say "amount" — the movement and its foreign original. Coverage
  separates them.
- **The booking date is on every movement.** A second date column may have gaps; the
  complete one is the booking date whatever the header calls it.
- **A numeric role moves to the column that holds the numbers.** A stacked header
  merges labels whose midpoint is nowhere near the figures they name.
- **A figure in another currency is not a movement in this ledger.** It is the
  foreign original of the movement above it, and belongs in `originalAmountMinor`.

### Currency

**The account is the authority.** A statement is imported _into_ an account whose
currency its owner stated, and that is what the reader uses. What the document
appears to say is corroboration.

This matters more than it sounds. Reading currency from the page produced `CZK` for
a euro statement, `#Numer rachunku` (a Polish column heading) for a Polish one, and
`SYN` from the account number `SYN-0001`. Currency codes are now checked against
the platform's own locale data — three capital letters is a shape, not a fact.

---

## When it cannot work something out

It asks. `previewLayout` returns what the reader saw in a file it could not file —
headers, inferred roles, sample rows, and what stopped it — and the mapping wizard
puts one question per column in the words a statement uses: _Date_, _Amount_,
_Money in_, _Money out_, _Balance after_.

The answer is saved as a profile keyed on the header **labels**, so the next
statement from that bank arrives already understood. If the bank later adds a
column, the wizard opens again with the columns it already knew filled in — matching
by position would instead shift every role one to the right and read plausibly.

---

## The file itself

Every accepted statement is **filed in Documents**, on the Statements shelf,
tagged with the bank, the account and the year, and linked to two things. The
first is the account it was read into, so the file sits under **Statements and
reports** on that account's own screen alongside anything else filed there. The
second is the import that read it: the import row carries the document's id, so
deleting the statement from Documents is refused — _This is the statement behind
an import; it stays with the import._ — rather than leaving the import unable to
show what it read.

The original file was always kept on the data volume, so a parser change re-reads
history rather than asking for seven years of exports again. What changed is that
the file is now reachable from either end — the register or the account — instead
of only through the filesystem.

---

## Provenance

Every filed row records **how it was read** and **how strongly it was proven**;
every file records its checks. The register shows the method for readings whose
structure was _inferred_ — PDF layout, record rhythm, rejoined fields, pixels — and
offers it as a filter. It is not a warning: nothing reaches the ledger without
proving itself. It answers "if a figure ever looks wrong, where do I start?"

---

## What does not work, and why

Measured on a 294-file synthetic corpus (24 locales, 20 currencies, 16 layout
archetypes) and 18 real files. **274 of 294 are read exactly.** The twenty that are
not are listed here with what would unblock them.

### 1. QIF — 8 files. Refused by design.

QIF records a date, an amount, a payee and a memo, and **nothing that could confirm
them**: no balances, no totals, no count. It is parseable and unverifiable.

Refusing it is the governing rule working, not a gap in the reader — a QIF could
only ever be taken on trust. It is detected so it can be turned away for the right
reason and pointed at the formats the same bank almost certainly also offers.

**What would change this:** a deliberate decision that a person confirming a
previewed statement may file a P0. That is a real option and a real weakening — the
preview shows a handful of sample rows, and in a P0 statement a dropped row is
undetectable by anyone. If it is ever taken, the wizard should show **every** parsed
row rather than a sample, and the provenance should record that a person vouched
for the rows rather than the arithmetic.

### 2. Currencies that are not two-decimal — 4 PDF files.

`statement-018` and `042` are **JPY**, which has no fractional part; `022` and `046`
are **KWD**, which has three. The rows are read — 018 recovers all six exactly — but
the arithmetic does not come out, so they land at P0 and are refused.

One root cause, not four. Two pieces of it are already fixed: the decimal-mark
resolver now takes the currency's precision, so `1.234` is a decimal in KWD and a
group in EUR; and a zero-decimal currency now settles the question trivially,
because a yen has no decimal mark to find. What remains is role assignment on these
files — 018 is `sparse-right-aligned`, where a `Debit`/`Credit` pair right-aligns
into columns that shift by row.

**What would unblock it:** more statements in non-two-decimal currencies. Two
archetypes over four files is thin evidence for a general fix, and the risk of
tuning to them specifically is high.

### 3. Statements with no movements — 6 files.

Three TSV and three CSV `non-statement` fixtures: a dormant account's statement,
with a header and no rows, or in the CSV case a comma-on-comma file whose header
cannot be split either. There is nothing in them to read and nothing to check.

Refusing is right, and a dormant month is legitimately empty, so this is really a
question about what the product should _say_. The semicolon variants of the same
statements are accepted as empty statements, because their metadata parses and
opening equals closing; the comma ones cannot get that far.

### 4. OpenDocument spreadsheets — 1 file.

`.ods` is not read. It is a zip of XML like `.xlsx` and the safety boundary already
covers it; what is missing is the reader. Same for legacy `.xls`, which is a
different binary format entirely and is refused with a message telling the person to
re-save.

### 5. A workbook fixture with no ground truth — 1 file.

`multi-account-ambiguous-workbook.xlsx` exists to demonstrate the multi-sheet drop,
which is fixed — both accounts now import, in their own currencies. It has no
expected-rows file of its own, so the suite counts it as a gap. A bookkeeping
artefact rather than a defect.

---

## Things that were tried and rejected

Recorded so they are not retried.

- **Whitespace-band segmentation** for multi-line records. No threshold exists:
  one bank separates records by 14 pt and their own lines by 12 pt, and another
  vertically _centres_ its rows so gaps inside a record run smaller than gaps
  between them.
- **Template induction with sequence labelling.** Breaks wherever the line carrying
  the date is not the line carrying the amount.
- **Splitting regions by column shape rather than exact width.** Correct for ragged
  geometry grids and wrong for everything else — it merges a summary row into the
  transaction table. The narrower rule that survived is: never split one movement
  from another.
- **Choosing between candidate readings by row count.** "Most rows wins" is a
  heuristic deciding what the arithmetic was supposed to decide, and it picks
  wrongly exactly where it matters: one statement reads 44 rows one way and 43 the
  other, and the 43 are the ones that reconcile.
- **Defining a continuation line as "carries no amount".** Helped none of the
  multi-line banks and split a 140-row statement into seven.

---

## Where to look

| Concern                             | File                                |
| ----------------------------------- | ----------------------------------- |
| Format sniffing                     | `format.ts`                         |
| Upload safety, zip bombs, caps      | `safety.ts`                         |
| Routing, candidate readings, gate   | `detect.ts`                         |
| Proof classes and the policy        | `proof.ts`                          |
| Declared formats                    | `standards/`                        |
| Grids, encodings, delimiters        | `tabular/grid.ts`                   |
| Regions and headers                 | `tabular/regions.ts`                |
| Column roles, rows, evidence        | `tabular/statement.ts`              |
| What is decidable and what is asked | `tabular/determinacy.ts`            |
| PDF table recovery                  | `tabular/frompdf.ts`, `rhythm.ts`   |
| Header vocabulary                   | `tabular/vocabulary.ts`             |
| Saved layouts                       | `profiles.ts`, `tabular/profile.ts` |
| The mapping wizard                  | `wizard.ts`                         |
| Reading from pixels                 | `ocr.ts`                            |
| Background reading                  | `queue.ts`                          |
| Accounts, dedup, pairing            | `ingest.ts`                         |

Acceptance suites: `tests/acceptance/corpus.test.ts` (the private real samples,
skipped where absent) and `tests/acceptance/synthetic-corpus.test.ts` (the committed
294-file corpus). Both name every file and what it must do; the synthetic one fails
in **both** directions, so a gap that starts working breaks the build until its
recorded reason is corrected.
