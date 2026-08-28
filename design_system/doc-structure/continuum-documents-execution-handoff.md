# Continuum Documents — Unified Execution Handoff

**For:** Claude Code, implementing in `pandorica-scientific/continuum` (v0.6.2 baseline).
**Authority chain:** this document is the single build order. It merges `continuum-documents-handoff-v3.md` (locked architecture — still authoritative for any behaviour question this file doesn't answer) and the accepted design pass (`Continuum Documents Refinement.dc.html` + `design-rationale.md`, reconciled below with three amendments). `docs/ui-guidelines.md` binds all UI code; `ARCHITECTURE.md` binds everything else.
**Design reconciliation verdict:** all rationale decisions accepted except amendments A1–A3 below; both flagged judgement calls (green-wash empty Inbox = a state, not a mood; 1px left rule on snippets) accepted as designed.

---

## 0. Amendments to the design pass

- **A1 — rail scroll height.** Not `max-height: 340px`. The shelf list is a flex child with `min-height: 0; overflow-y: auto` so it uses available viewport; a fixed 340px scrolls while the page has room.
- **A2 — expiry pill verb shedding (<1200px).** Sheds the verb **only in the normal (grey/green) state**. Amber and red pills keep their verb at every width: "due" vs "renews" changes what the user must do, and urgent rows are few enough to afford the 12px.
- **A3 — canonical microcopy supplied (§7).** The DC's placeholder honesty strings are replaced verbatim from the table below; blocks grow downward if a string exceeds two lines at 340px.
- **Artifact note:** the DC's ~9 hex literals are its self-contained token block — fine for a mock, **zero** color literals in shipped code (lint rule exists).

---

## 1. Build order — five phases, gated

Phases are sequential; each gate is green CI (`npm run lint`, `npm run check`, integration suite) plus the listed acceptance checks. **P1 is the foundation: no P3–P4 code reads documents except through the P1 predicate.**

### P0 — Schema & migration
1. New tables/columns per §2. Enum registry: add `document.type`, `document.sensitivity`, `document_text_chunk.source`, `job.kind += extract_text`; **remove** `document.shelf`.
2. Repository helpers `shelfIdByKey(key)` / `systemShelfId('inbox'|'statements')` in `src/lib/server/documents/`; domain code never writes shelf keys or UUID literals.
3. Migrate the five write/read couplings: `salary/entries.ts:364` (create → finance + `type='payslip'`), `salary/entries.ts:270` + `salary/backfill.ts:57` (reads → `type='payslip'`), `import/ingest.ts:885` (→ `systemShelfId('statements')` + `type='bank_statement'`), `system/demo.ts` seeds, Documents form plumbing (`SHELVES` const dies; `?addShelf=` → `addShelfKey`).
4. **Two migration deliverables** (single-baseline convention, ARCHITECTURE ~334): (a) baseline updated to create final schema + `pg_trgm` + expression indexes + system shelf rows directly, snapshot promoted; (b) one idempotent transactional upgrade script `0.6.2 → documents-v2` (create+seed shelf → add `shelf_id` → map old shelf→shelf/type, insurance by linked entity, unresolved→inbox+`tag:insurance` → rewrite system-created rows → text tables/indexes → drop old column+CHECK).
5. **Gate:** `tests/integration/baseline-migration` extended and green; upgrade script run twice on a seeded 0.6.2 DB is a no-op the second time; vacuous-all predicate unit tests pass the §2.3 truth table.

### P1 — Visibility invariant (D6)
1. `visibleDocumentPredicate(actor)` — one SQL fragment in the documents service.
2. New route `/documents/[id]/file` (auth against the document row, streams stored file); all document links move to it; `/files/[name]` keeps serving avatars/property media only.
3. Briefing source, calendar generation, all counts, and every Documents load apply the predicate. Restricted documents generate **no calendar events and no ICS lines for anyone**.
4. **Gate:** regression test — a `member` session requesting a restricted document's stored name via `/files/` and `/documents/[id]/file` gets 404/403; member search/counts/briefing/ICS contain no trace; admin sees all; counts computed post-filter.

### P2 — Dispatcher & extraction
1. Refactor `import/queue.ts` → CPU-job dispatcher: one advisory lock (`'continuum:cpu-queue'`), claim **one job across `import|extract_text`**, dispatch by kind; `calendar_sync` untouched; orphan recovery unchanged.
2. `extract_text` job: routing per v3 §4.1 (mupdf per page; ≥~50 folded chars → `text_layer` chunk, else rasterize 300 DPI grayscale → OCR; images → OCR; txt/csv/md → iconv-lite plain chunks ≤~100 KB). `OcrProvider` seam, tesseract.js impl, worker create→recognize→terminate per job.
3. Bounded work: config `extraction.maxFileBytes / maxPageDim / maxOcrPagesPerRun (100) / maxPlainBytes`; partial runs record `complete=false` + `pagesExtracted`; `Continue extracting` enqueues the next slice.
4. Staleness: enqueue stores `contentHash`; file replacement cancels queued jobs + re-enqueues; commit guarded `WHERE document.content_hash = job.expected_hash`; late finishers mark stale, discard.
5. Household setting `ocr.languages` (default `ces+eng`, bounded by vendored tessdata).
6. Enqueue on: create-with-file, file replace, admin re-extract, and a one-time backfill sweep.
7. **Gate:** replace-during-extraction test yields B's text, never A's; a 600-page image PDF stops at 100 pages with `complete=false`; import and extract_text never run concurrently (lock test).

### P3 — Search
1. Server-side `q` in the Documents load. Candidate UNION per v3 §5.1 (tiers A name/tags · B entity/type/shelf labels · C note · D chunk FTS + chunk substring), aggregate best tier per document, recency tiebreak.
2. Substring predicate: `public.contact_fold(text) LIKE '%'||public.contact_fold(:q)||'%'` (trigram-indexed); `similarity()` only as typo fallback. Expressions match indexes exactly.
3. Content hits return `pageNo` + snippet; result rows labelled "Matched in contents"/"in note".
4. Honesty counts from `document with stored file AND no document_text row` + archived-only match detection.
5. **Gate:** `10078410` finds the claim invoice via chunk substring; folded diacritics match both directions; member results exclude restricted at SQL level (reuses P1 predicate); EXPLAIN shows index usage on both GIN indexes; trigram index size recorded after backlog import (drop to FTS-only if it bloats — v3 §5.1).

### P4 — UI (four surfaces + capture)
Implement the DC as reconciled. Binding specifics beyond the mock:

- **Main:** row grid `38px ext · minmax(0,1fr) · 140px expiry` (128px <1200 with A2 verb rule; two-line wrap <640). Group headers: label 13/500, bare mono count right, 1px `--bd` rule. Rail per A1; counts mono+`tabular-nums`, post-predicate, never filter-dependent; `railEmoji` resolved **off**. Inbox strip: amber pill only, "N documents are waiting in Inbox — Review inbox →".
- **Inspector:** ~440–480px in-content panel; read values in `min-height: var(--control-h)` boxes with the input's 10px inset (no read↔edit jump); preview `max-height: 260px`, `object-fit: contain` on `--card2`; quiet 13px `--fg3` lock after name (admin); `⋯` fixed order Replace file · Re-extract (greyed for members) · Download · Delete (link-cascade confirm); metadata-only = dropzone in the preview slot, `Edit` primary, `Open file` absent; native date inputs; URL `?shelf=…&doc=<uuid>`; mobile full-screen, Back restores shelf/query/filters/scroll.
- **Inbox review:** 58/42 panes; default zoom Width; fields incl. expiry verb+date and compact sensitivity; sticky shelf/type with 11.5px `--fg3` "kept" that vanishes on change; Enter = File & next; Skip wraps ("2 skipped"), never files/deletes, exits when only skipped remain; empty state on `--green-wash`.
- **Shelves settings:** `ShelfRow` (handle · emoji button · label · System grey pill · `⋯`); drag sets `sortOrder`, dragged row `--card3`, no lift/shadow; add = inline row, one field; delete = "N documents need another shelf first — Move them to [ … ] — Move & delete", transactional; system shelves relabel-only; `EmojiPicker` = 24×36px grid + two-char field.
- **Search UI:** three row variants; `SnippetMark` (600 weight on `--yellow-tint`, 3px radius, term only); 1px `--bd2` left rule on snippets; honesty blocks with §7 strings; archived-only hint links "Show archived matches".
- **Capture:** `+ Add document` → capture panel only (UploadDropzone; `Scan with this device` first on mobile); "Added to Inbox" (+ contextual "Added to Property, linked to Karlín" when `?add=1&propertyId=…`); optional `File it now`.
- **New components — exactly three:** `SnippetMark`, `ShelfRow`, `EmojiPicker`. New `Icon` paths: lock, drag-handle, search. Everything else reuses `Pill/Icon/Eyebrow/Field/Modal/FileViewer/ListPager/Segmented/TagInput/ScreenHeader/UploadDropzone` and the `mono ext` badge.
- **Loading:** three static `--card2` row-height blocks; no shimmer, no spinner.
- **Gate:** ui-guidelines "before you call it done" checklist per screen, both themes toggled by hand; **explicit light-theme contrast check on `SnippetMark`** — if it fails, darken the term ink to `--fg1`, never deepen the tint; expired-on-archived-subject renders plain mono date, no red.

### P5 — Backlog import CLI & close-out
`scripts/import-documents.mjs`: walk directory, user-edited mapping table (path segment → shelf key / type / tag), `contentHash` dedup, remainder → inbox; subject/entity assignment stays a UI bulk action. Run tesseract confidence distribution over the imported corpus; record trigram index size; file both under §8 evidence triggers.

---

## 2–6. Schema, predicate, routing, search SQL, shelf set

As v3 §2–§5 verbatim — including the vacuous-all hide predicate and truth table (v3 §2.3), chunked `document_text`/`document_text_chunk` with the three expression indexes (v3 §2.4), and the target shelf seed (v3 §3.1). Do not re-derive; implement.

## 7. Canonical microcopy (single source — use verbatim)

| Context | String |
|---|---|
| Inbox strip | `N documents are waiting in Inbox` · `Review inbox →` |
| Capture ack | `Added to Inbox` / `Added to {Shelf}, linked to {Entity}` · `File it now` |
| Search empty | `No documents match "{q}". Try fewer words or remove a filter.` |
| Search empty, gaps | `No match in names, entities, tags, notes or searchable contents.` + `N documents don't have searchable contents.` |
| Search pending | `No match yet. N documents are still being prepared for content search.` |
| Archived-only | `No active documents match "{q}". N matches belong only to archived subjects.` · `Show archived matches` |
| Archive scope | `Active subjects · N documents hidden from archived subjects` · `Include archived subjects` · chip `Archived subject` |
| Match labels | `Matched in contents` · `Matched in note` |
| Extraction processing | `Preparing contents for search…` |
| Extraction failed | `Couldn't read searchable text from this file. The document itself is safe and still available.` · `Retry` |
| Extraction partial | `Pages 1–{n} are searchable. This file is larger than the automatic extraction limit.` · `Continue extracting` |
| Restricted helper (edit) | `Restricted documents do not appear in search, document lists, briefing, calendar or downloads for household members.` |
| Metadata-only | `No file attached` · `Attach file` |
| Shelf delete | `Delete "{Shelf}"? N documents need another shelf first.` · `Move them to` · `Cancel` · `Move & delete` |
| Review counter | `N remaining` / `N skipped` |

## 8. Deferred, evidence-triggered (do not build)

Boilerplate-frequency suppression · PP-OCRv6/ONNX adapter (triggers: confidence distribution or real misses; gate: linux-arm64 prebuilds) · Czech stemming · per-person ACLs · anything in v3 §6.11/§9.

## 9. Definition of done

All five gates green · upgrade script proven idempotent on a copy of a real instance · repo UI checklist passed per screen in both themes · `design_system/` updated in the same pass as any primitive change · v3 §7 table reflects final state.
