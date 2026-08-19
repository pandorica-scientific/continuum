# Stated totals and counts are printed but not read

**Status:** identified, not implemented
**Date:** 2026-08-19
**Found while:** debugging the `RK_Bank_01:2025.pdf` corpus failure

## The finding

Statements print corroborating evidence that the reader does not extract, so
readings sit at a lower proof class than the page actually supports. The
consequence is not cosmetic: P1 and P2 do not file unattended, so a person is
asked to confirm a layout that the page itself could have proven.

Komerční banka's last page prints all of this. Figures below are
**illustrative** — the source statement is real and lives in
`bank_data_examples_do_not_share/`, so the shape is reproduced here and the
amounts are not:

```
Rekapitulace transakcí na účtu          Připsáno      Odepsáno
Celkový počet transakcí                        1            27
Obraty na účtu                        100 000,00    -60 000,00

Zůstatek podle data
07.12.2024   50 000,00 │ 15.12.2024   90 000,00 │ 02.01.2025   95 000,00
09.12.2024   45 000,00 │ 16.12.2024   88 000,00 │ 03.01.2025   92 000,00
11.12.2024   44 000,00 │ 23.12.2024   85 000,00 │ 06.01.2025   90 000,00
12.12.2024   43 000,00 │ 30.12.2024   80 000,00
13.12.2024   99 000,00 │ 31.12.2024   78 000,00
```

The reading of that file is 28 rows. The page states **28** transactions
(1 + 27) in the count row, and a credit and debit turnover whose net equals the
sum of those 28 movements exactly. Both agree with the reading. Yet its proof
reports:

```
running balance: unavailable
opening and closing: pass
stated totals: unavailable      ← printed on the page
movement count: unavailable     ← printed on the page
monetary precision: pass
```

Result: **P1**, the weakest class that proves anything, on a statement the page
corroborates three separate ways. With the stated totals it would be **P2**;
with the daily balances reconstructed into a chain, **P4**.

## Why it is missed

The evidence scanner in `tabular/statement.ts` is vocabulary-driven, and the
vocabulary is incomplete rather than wrong:

| Printed                   | Term list            | Contains                  | Result     |
| ------------------------- | -------------------- | ------------------------- | ---------- |
| `Počáteční zůstatek`      | `OPENING`            | `pocatecni`               | matched    |
| `Konečný zůstatek`        | `CLOSING`            | `konecny`                 | matched    |
| `Celkový počet transakcí` | `COUNTS`             | `pocet polozek` only      | **missed** |
| `Obraty na účtu`          | `CREDITS` / `DEBITS` | neither                   | **missed** |
| `Zůstatek podle data`     | `SUMMARY_TERMS`      | German `kontostande` only | **missed** |

This is the extension point `vocabulary.ts` was designed for — _"Data, not
logic — the whole point is that adding Portuguese or Hungarian is an edit here
and nothing else."_ These are standard Czech banking phrases, not KB
inventions, so the entries will also serve Česká spořitelna and
Raiffeisenbank. Note German `kontostande` is already present for exactly the
balance-recap table Czech lacks a term for, which is what marks this as a gap
rather than a special case.

## Three pieces of work, increasing in size

### 1. Count vocabulary — one line

Add `celkovy pocet transakci` (and `pocet transakci` for the shorter phrasing)
to `COUNTS` in `statement.ts`. The existing extractor already pulls the first
integer out of the matched row.

Caveat: KB prints the count as two figures in two columns, `1` and `27`, and
the current code takes `/(\d+)/` — the **first** integer, giving 1 rather than 28. So the count row needs the same two-value handling as item 2.

### 2. Turnover vocabulary plus two-value rows — the real work

`Obraty na účtu` states credit and debit on **one** row in two columns.
`labelledValue(row)` returns a single value, so a new vocabulary entry alone
would capture only one of the two.

Needed: a `labelledPair(row)` that returns both trailing numeric cells of a
labelled row, used for `CREDITS`/`DEBITS` and for `COUNTS`, keeping the existing
single-value path for statements that print the two on separate lines.

Once `statedCreditTotalMinor` and `statedDebitTotalMinor` are populated,
`proveStatement` already does the rest — the `stated totals` check and the P2
promotion exist and are simply never reached.

### 3. Daily balances as a chain — largest, highest value

`Zůstatek podle data` is a running balance at day granularity. Reconstructed, it
gives every movement a balance to sit on and would carry the reading to P4 —
proven without any human confirmation.

This is more than vocabulary. It needs the recap parsed as a date→balance map
(across its three column pairs), then each movement's `balanceAfterMinor`
derived by accumulating within a day and checking the day's end against the
recap. Design questions to settle first:

- Movements within one day have no printed order, so per-row balances are not
  recoverable — only the day's closing balance is checkable. That is still a
  far stronger chain than none, but it is a **day** chain, not a row chain, and
  `testChain` currently assumes per-row. Adding a day-granular chain model is
  the substantive part.
- `chainModel` would need a third value beside `as listed` and `newest first`.

## Why this is worth doing

- **It removes questions the page already answers.** Every KB statement
  currently needs one manual layout confirmation; with item 2 it files itself.
- **It raises proof classes across the corpus**, so the effect should be
  measured, not assumed. Six corpus entries currently expect P2, and several may
  move to P3/P4 once totals and counts are read. Those expectations will need
  updating, and that is the point rather than a side effect.
- **It catches errors P1 cannot.** P1's documented weakness is two omitted
  movements that offset each other; they cannot also leave both stated totals
  intact. This is precisely the corroboration the class is missing.

## Consequence for the corpus test today

`RK_Bank_01:2025.pdf` expects `outcome: 'imports', proof: 'P1'`. It does not
import, because `decideImport` deliberately stopped filing P1 and P2 unattended
(commit `08a688b`) and that change was correct — the docblock and `wizard.ts`
both claimed it was already enforced when it was not.

So the entry is stale, and there are two honest ways to settle it:

1. **Implement item 2.** The file reaches P2, and the expectation becomes
   `proof: 'P2'`. This is the better outcome: the file proves itself.
2. **Change the expectation** to record that the file is read correctly but
   requires one confirmation. The corpus vocabulary has only `imports` and
   `refuses`, and neither describes "read completely, 28 rows, reconciles,
   pending confirmation" — so this needs a third outcome to avoid recording
   something false.

Until one of those lands, that single corpus entry stays red. It is the only
failure in the suite, and it predates the v0.3.9 branch.

## Related work already done

Two defects found in the same investigation are fixed:

- A region that failed the gate discarded regions that had already accounted for
  the whole file — a balance recap read as movements took a complete statement
  down with it. Now settled by `accountsForWholeFile` in `proof.ts`.
- `readGenerically` reported `firstReason` rather than `refusedReason`, so the
  error blamed an irrelevant date ambiguity in a fragment that lost instead of
  naming the proof gate that actually decided.
