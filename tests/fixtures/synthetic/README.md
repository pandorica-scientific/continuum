# The synthetic statement corpus

60 statements, 24 locales, 20 currencies, 16 layout archetypes, each emitted in up to
ten formats — 354 files in about 1.5 MB. Entirely synthetic: no real financial data,
which is why this lives in the repository and runs in CI, while the real samples in
`bank_data_examples_do_not_share/` cannot.

## Why it exists

The real samples are the ones the reader was _developed_ against, so a reader measured
only on those cannot tell competence from memory. The first run of this corpus made the
difference plain: eleven of nineteen real files worked, and **37 of 294** synthetic ones
did.

Everything it has found since has been a real defect, not a quirk of the generator:

- the generic reader split CSV on newlines before parsing quotes, so any statement with
  a wrapped payment note fragmented and lost rows
- the amount/balance differences test was specified and never built, so every headerless
  ledger was refused while its own last column proved every movement in it
- an adapter took a column heading as an ISO currency code

## Layout

```
expected/       60 ground-truth statements: exact per-row minor amounts,
                balances, fees, FX originals, archetype, locale, currency
csv/ tsv/       120 + 60 delimited variants (encoding × delimiter × header style)
pdf-text/       57 native-text PDFs
camt053/ mt940/ abo/    ISO 20022, SWIFT and Czech ABO/GPC
ofx/ qif/ xlsx/ ods/    formats we do not read yet, kept so the boundary is pinned
```

The ground truth is checked for self-consistency by the suite itself: every statement
with movements must satisfy `opening + Σ(amount − fee) = closing`. If the corpus stops
adding up, nothing measured against it means anything.

## Not committed

The OCR raster derivatives — 16 TIFF, 16 PNG, 16 JPEG and 16 scanned PDFs at 150–400 dpi,
about 46 MB — stay out of the repository until OCR is actually wired to a consumer. They
live under `scratch-workspace/synthetic-test/` alongside `ground-truth/ocr/`, which
records expected tokens, table regions and one named visual mutation per file.

## How it is enforced

`tests/acceptance/synthetic-corpus.test.ts`. Every file either reproduces its ground
truth exactly — same movements, same currency — or appears in `KNOWN_GAPS` with the
reason. **Both directions fail.** A gap that starts working breaks the suite, because the
recorded reason has become false and someone should say what changed. That is what keeps
the list from decaying into an alibi.

Currency is supplied the way production supplies it: from the account. Reading it off the
page is what filed a 140-row euro statement as Czech koruna.
