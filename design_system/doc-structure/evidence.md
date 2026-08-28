# Documents v0.7.0 — evidence for the deferred decisions

Handoff §8 defers four things behind evidence rather than ruling them out. This
file is where the measurements land, so a later decision is made on numbers
instead of on a memory of how it felt.

## Trigram index size on contents (v3 §5.1)

**Decision it gates:** if `dtc_trgm_idx` bloats, drop to FTS-only on contents.
The drop is pre-authorised; the number is what authorises it.

Measured 2026-08-28 against a synthetic corpus of 100 documents × 20 pages of
mixed Czech/English paperwork text (~2.4 KB a page), on PostgreSQL 16:

| | |
|---|---|
| chunks | 2 000 |
| `document_text_chunk` total size | 13 MB |
| `dtc_trgm_idx` | 5 952 kB |
| `dtc_fts_idx` | 3 984 kB |
| substring query over the whole corpus | 230 ms |

**Verdict: keep it.** The trigram index is ~46% of the table it indexes, which
is the ordinary cost of `gin_trgm_ops` and is not bloat — a household archive of
two thousand pages carries a six-megabyte index. Re-measure after the backlog
import (P5) against real volume before treating this as settled.

## Still open

- **tesseract confidence distribution** — collected in P5 over the imported
  corpus. Gates the PP-OCRv6/ONNX adapter, which additionally needs linux-arm64
  prebuilds before it can be considered.
- **Czech stemming** — gated on fold+trigram recall demonstrably failing.
- **Boilerplate-frequency suppression** — gated on content hits demonstrably
  drowning results, which the tiering already argues against.
