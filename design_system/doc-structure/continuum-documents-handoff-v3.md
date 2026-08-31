# Continuum — Documents: Organisation, Text Extraction, Search & UI

**Version 3 — locked implementation specification.** Supersedes v2 entirely. Incorporates the independent review (2026-08-28) after verifying every repository claim it made; verification results are cited inline as `[repo: path:line]` against v0.6.2.
**Companions:** scan-engine handoff v4 (capture → PDF, boundary unchanged); `ARCHITECTURE.md` for house rules.

---

## 0. Review reconciliation

All nine review changes accepted; none rejected. Two corrected outright errors in v2:

| # | Review point | Verdict | Verified against repo |
|---|---|---|---|
| 1 | `restricted` must be an app-wide read-path policy, not a Documents-screen filter | **Accepted, now D6** | `src/routes/(app)/files/[name]/+server.ts` auth-guards via layout then `openUpload(name)` — no document resolution. Briefing and calendar read expiries independently |
| 2 | Single-blob `document_text` breaks on PostgreSQL's 1 MB tsvector limit | **Accepted — v2 error.** Chunked model, §2.4 | Limit is documented PostgreSQL behaviour; 600-page OCR output plausibly exceeds it |
| 3 | Import queue is not reusable as-is; parallel per-kind queues allow 2 CPU jobs at once | **Accepted, §2.5** | `import/queue.ts`: `kind:'import'` hardcoded, lock key `'continuum:import-queue'`, dispatches `ingestFile` |
| 4 | Salary and statement ingestion also **write** shelf keys | **Accepted — v2's "one coupling" claim was wrong** | `salary/entries.ts:364 shelf:'payslips'`; `import/ingest.ts:885 shelf:'statements'`; demo seed |
| 5 | Migration wording conflicts with single-baseline convention | **Accepted, §3.4** | ARCHITECTURE.md ~334: fold into baseline; live instances migrate by hand |
| 6 | Weighted-tsvector-over-joins doesn't exist; use candidate UNION with tiers | **Accepted, §5** | Contacts precedent relies on folded expression matching the index exactly |
| 7 | 60% boilerplate guard is not a three-line heuristic | **Accepted — moved to §9 deferred** | — |
| 8 | D2 needs a shelf-management surface | **Accepted, §6.9** | — |
| 9 | Vacuous-all bug: zero-subject documents must stay visible | **Accepted verbatim, §2.3** | — |
| + | Bounded-work contract for extraction | **Accepted, §4.4** | — |

Refinements added in v3 beyond the review: restricted documents generate **no calendar events at all** (§2.6) — sync targets are outside the auth boundary, so role-filtering there is false safety; plain-text extraction chunks under the same cap as OCR (§2.4); staleness protection is belt-and-braces — cancel queued jobs on replacement *and* hash-guard the commit (§2.5).

---

## 1. Decisions

| # | Decision |
|---|---|
| D1 | Shelves are exactly one level. No parent column, ever. Volume is answered by filtering and grouping, never subdivision. |
| D2 | Shelves are data — `shelf` table, category-tree precedent (slug key immutable, rename free, delete requires `reassignTo` transactionally). Application code never branches on a non-system shelf; system rows (`inbox`, `statements`) are referenced by key through one repository helper. |
| D3 | `type` is a fixed code enum in the registry, orthogonal to shelf. Behaviour hangs off type (salary → `type='payslip'`), never shelf. |
| D4 | `subject` gains lifecycle: `archivedAt`, `activeFrom`, `activeTo` (+ CHECK). Archiving one subject demotes its linked documents in one reversible action. |
| D5 | One shelf per document; entity links many (`document_link`, exists); tags free (`tag_link`, exists). |
| D6 | **Visibility is an invariant, not a filter: every document read path applies `visibleDocumentPredicate(actor)` before returning metadata, content, files, counts, search hits, briefing items or calendar events.** v1 semantics: admin sees `normal+restricted`; member sees `normal`; counts computed after filtering; restricted never reaches calendar/ICS (§2.6). Blocking for v1 — sensitivity and its enforcement ship together. |
| D7 | `note` free text on document; the one user-authored phrase field, ranked above contents in search. |
| D8 | Extraction is post-ingest, behind `OcrProvider`, tesseract.js v1 (langs = household setting, default `ces+eng`, bounded by vendored tessdata). PP-OCRv6/ONNX is a later adapter; `engine`/`engineVersion` recorded per run. |
| D9 | Search: `simple` config + `contact_fold` + GIN, trigram for substrings, candidate-UNION ranking (§5). No stemming, no denormalized search table in v1. |
| D10 | `inbox` is a system shelf. The minimum valid document is file + generated name + inbox; **no required enrichment, ever** — capture completes with zero decisions. |
| D11 | One serialized CPU-job dispatcher for `kind ∈ {import, extract_text}`: exactly one CPU-heavy job runs globally. `calendar_sync` stays independent. |
| D12 | Extracted text is chunked per page/segment; all content indexes live on chunks. |

---

## 2. Schema

### 2.1 `shelf`

```
shelf: id uuid PK · key text UNIQUE (immutable slug) · label text · emoji text
       sortOrder int · system bool DEFAULT false · createdAt timestamptz
document.shelf_id uuid NOT NULL REFERENCES shelf(id) ON DELETE RESTRICT
```

Delete = transactional reassign-and-delete only, refused otherwise. System shelves: label/emoji editable ("K vyřízení" is a legal name for inbox), key and existence are not. `document.shelf` (text) and its CHECK leave the enum registry; `document.type`, `document.sensitivity`, and extraction enums enter it — the registry itself documents that open sets live outside it, so this split is the registry's own architecture.

### 2.2 `document` — new columns

`type` (enum as v2: contract · invoice · receipt · payslip · bank_statement · insurance_policy · claim · id_document · certificate · medical_record · tax_document · technical_plan · correspondence · warranty · manual · other), `note text`, `sensitivity` (`normal|restricted`).

### 2.3 `subject` lifecycle — with the vacuous-all fix

```
archivedAt timestamptz NULL · activeFrom date NULL · activeTo date NULL
CHECK (active_from IS NULL OR active_to IS NULL OR active_from <= active_to)
```

**Hide predicate — exactly this, to keep unlinked documents visible:**

```
hide(document) ⇔ EXISTS(link to a subject) AND NOT EXISTS(link to an active subject)
```

| Subject links | Default |
|---|---|
| none | visible |
| active car | visible |
| archived car | hidden |
| archived car + any active subject | visible |
| only archived subjects | hidden |

### 2.4 `document_text` + `document_text_chunk`

```
document_text:  documentId uuid PK FK CASCADE · engine · engineVersion · languages
                meanConfidence real · extractedAt · complete bool NOT NULL DEFAULT true
                pagesExtracted int NULL
document_text_chunk: documentId FK document_text CASCADE · ordinal int · pageNo int NULL
                     source text (text_layer|ocr|plain) · text text · PK(documentId, ordinal)
```

Chunk = one PDF page, one image, or ≤ ~100 KB slice of plain text (the same tsvector wall applies to a big CSV as to OCR). Indexes on **chunks only**, expressions matching the query fold exactly, in raw migration SQL beside the entity triggers:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- schema-qualified refs, as unaccent already is
CREATE INDEX dtc_fts_idx  ON document_text_chunk USING gin (to_tsvector('simple', public.contact_fold(text)));
CREATE INDEX dtc_trgm_idx ON document_text_chunk USING gin (public.contact_fold(text) gin_trgm_ops);
CREATE INDEX document_name_trgm_idx ON document USING gin (public.contact_fold(name) gin_trgm_ops);
```

Buys: bounded index entries, page-aware snippets, per-page provenance, and mixed PDFs for free — **per-page routing is therefore v1**: page with usable text → `text_layer` chunk; page without → rasterize + OCR chunk.

### 2.5 Jobs — generalize, don't parallelize

`job.kind` gains `'extract_text'`. Refactor `import/queue.ts` into a CPU-job dispatcher: one advisory lock (`'continuum:cpu-queue'`), claim **one job across both kinds**, dispatch by `job.kind`. Orphan recovery and sweep semantics unchanged.

**Staleness invariant:** enqueue records the document's `contentHash`; replacing a file cancels its queued extraction and enqueues anew; commit is conditional —

```
UPDATE … WHERE document.content_hash = job.expected_hash
```

— a run finishing after replacement marks itself stale and discards output. Both ends of the race are closed.

### 2.6 Visibility seam

`visibleDocumentPredicate(actor)` in `src/lib/server/documents/` — one SQL fragment used by: Documents load/search, briefing source, calendar generation, counts, and file serving. Files move to **`/documents/[id]/file`** where authorization resolves against the document row; `/files/[name]` remains for avatars/property media and stops being linked for documents. Restricted documents emit **no generated calendar events and no ICS lines for anyone** — the feed and synced calendars live outside the session boundary; briefing filters per viewer role. `document.expiresOn` calendar write-back applies only to events that exist, so nothing new opens there.

---

## 3. Shelf set & migration

### 3.1 Target shelves (seeded; households edit freely)

`inbox*` · identity · family · health · property · tenancy · vehicles · finance · household · `statements*` (* = system). Old `payslips/tax/insurance/loans` survive as type + links + tags, per v2 §3; insurance splits by linked entity, unresolvable → inbox + `tag:insurance`.

### 3.2 Write-path couplings — all of them

Domain code ceases writing shelf keys. Repository helpers `systemShelfId('statements')` / `shelfIdByKey(key)` hide the UUID. Known call sites to migrate:

| Site | Today | Becomes |
|---|---|---|
| `salary/entries.ts:364` (payslip create) | `shelf:'payslips'` | `shelf_id = shelfIdByKey('finance')`, `type='payslip'` |
| `salary/entries.ts:270`, `backfill.ts:57` (reads) | `shelf='payslips'` | `type='payslip'` |
| `import/ingest.ts:885` (auto-file) | `shelf:'statements'` | `shelf_id = systemShelfId('statements')`, `type='bank_statement'` |
| `system/demo.ts` seeds | shelf keys | keys → ids via helpers |
| Documents UI/form plumbing (`SHELVES` const, `?addShelf=`) | code enum | DB rows; param becomes `addShelfKey` resolved by key |

### 3.3 Backlog import CLI

As v2 §3.3 (path-segment mapping table, `contentHash` dedup, remainder → inbox), unchanged.

### 3.4 Two migration deliverables — matching the single-baseline convention

1. **Fresh install:** the one Drizzle baseline is updated to create the final schema, extensions, expression indexes, triggers and system shelf rows directly.
2. **Existing instance:** one explicit, idempotent, transactional upgrade script `0.6.2 → documents-v2`: create+seed `shelf` → add `shelf_id` → map old shelf → shelf/type (insurance rule; unresolved → inbox) → rewrite salary/statement-created rows → add text tables/indexes/extension → drop old column+CHECK. Baseline snapshot promoted afterwards so `meta/` still describes the schema.

---

## 4. Extraction

### 4.1 Routing (per page where pages exist)

PDF → mupdf structured text per page; page ≥ ~50 folded chars → `text_layer` chunk, else rasterize that page (300 DPI, grayscale, streamed) → OCR chunk. Images (jpg/png/webp/heic) → OCR. txt/csv/md → iconv-lite, sliced into plain chunks. Other extensions → no `document_text` row.

### 4.2 Engine

tesseract.js behind `OcrProvider` (D8); worker per job, create → recognize → terminate; failures land on the job row; document stays filed and metadata-searchable.

### 4.3 What extraction never does

No PDF rewriting, no field extraction into metadata, no writes to name/dates/amounts. Text → chunks, nowhere else.

### 4.4 Bounded-work contract

Configured limits, defaults tunable: max input file size, max decoded page dimensions, **max OCR pages per automatic run** (suggest 100), max plain-text bytes. Hitting a limit is recorded, never silent: `complete=false` + `pagesExtracted`; inspector shows "Pages 1–N are searchable" with `Continue extracting` to run the next batch through the same queue. A 600-page manual therefore occupies the single CPU worker in bounded slices, not for an afternoon.

---

## 5. Search

Server-side, one load path, folded both sides through `contact_fold`.

### 5.1 Candidate UNION — no denormalized index, no rename triggers

```
name match                    → tier A        tag match            → tier A
linked-entity label match     → tier B        type/shelf label     → tier B
note match                    → tier C
chunk FTS match               → tier D        chunk substring match → tier D
```

UNION the candidate queries, aggregate per document id, keep best tier; recency breaks ties. Substring/identifier queries (`10078410`, variable symbols) use the trigram-indexable predicate `contact_fold(text) LIKE '%'||contact_fold(:q)||'%'` — not `similarity()` sorting; similarity stays as the typo fallback. Content hits carry pageNo + snippet and are labelled ("Matched in contents" / "in note"). **Benchmark the chunk trigram index after the backlog import** before treating it as free; drop to FTS-only on contents if it bloats.

### 5.2 Honesty states

Empty: "No match in names, entities, tags, notes or searchable contents · N documents don't have searchable contents." Pending: "…still being prepared for content search." Archived-only matches: "N matches belong only to archived subjects — Show archived matches." Restricted documents are absent from results, counts and hints for members — no teaser rows.

---

## 6. UI — four surfaces

Restraint rules apply throughout: no animation, quiet hover/fill, sentence case, row-based density, no thumbnails in lists (preview lives in the inspector).

> **Amended in v0.7.4.** "No thumbnails in lists" still holds for the list, which has none. It does not hold for a shelf drawing its own layout: the Identity shelf opens as a wallet of ID-1 cards, and a card has a face. That face is generated country artwork rather than the scan — see §6.11.


### 6.1 Documents (main)

Keep the ~218px shelf rail + one vertically scannable result list; **a document appears once** (the current subject-derived column duplication goes). Rail: `Everything`, `Inbox` (amber count only when non-zero — work waiting, not an error), divider, shelves by `sortOrder`, `Manage shelves` at bottom. Rail counts respect visibility + archive scope, never search/filter state. Inbox strip above the canvas when non-empty: "6 documents are waiting in Inbox — Review inbox →", framed as unfiled, not invalid.

### 6.2 Rows

Line 1 name · line 2 entities + useful tags · line 3 note excerpt when present; right side expiry state (existing traffic-light semantics) + overflow. Never show raw vocabulary (`type:`, `shelf:`, `source: ocr`, confidence). Restricted shows a quiet lock to admins only.

### 6.3 Inspector

Row click opens a ~440–480px in-content inspector (not a modal; not the file): preview, `Open file` (→ `/documents/[id]/file`, new tab), filed-in / type / about / expiry / tags / note; `Edit` swaps the metadata region to inputs. The read view shows restricted state as the same quiet lock the row uses, beside the name — an admin must not need edit mode to confirm it. The `⋯` overflow is pinned to exactly: Replace file · Re-extract (admin) · Download · Delete (link-cascade confirmation). Expiry dates use the native date input, never a text mask — `12/01/2027` is a DD/MM-vs-MM/DD bug in a Czech household. Metadata-only documents show "No file attached · Attach file". URL: `/documents?shelf=…&doc=<uuid>` — Back closes, deep links work. Mobile: full-screen detail instead; Back restores shelf, query, filters, scroll.

### 6.4 Capture

`+ Add document` opens a capture panel only: drop/choose file, `Scan with this device` (first on mobile). On arrival: "Added to Inbox", done — extraction starts silently; optional `File it now`. Contextual adds (`?add=1&propertyId=…`, `addShelfKey=…`) pre-apply what Continuum already knows.

### 6.5 Inbox review

Purpose-built triage: preview left, filing fields right, `Skip` / `File & next →`, next document replaces immediately. No wizard, no progress screens — email-triage cadence. The panel includes **expiry** (`[verb ▾][date]`) and a compact **sensitivity** toggle: this flow touches every backlog document exactly once, and renewal dates and restricted flags are the two fields a second pass costs most. All fields stay optional (D10). Shelf and type are **sticky from the previous File & next** within a session — a folder import is twenty near-identical documents, and sticky defaults make that twenty Enters; they cost nothing when documents differ. Enter = File & next.

### 6.6 Bulk

Hover/`Select` checkboxes; sticky bar `Shelf ▾ Type ▾ Link ▾ Tags ▾ Restricted ▾ Done`. Links and tag-adds are additive; shelf/type replace (singular); tags also bulk-remove.

### 6.7 Search & filters

Prominent search field ("Search documents and their contents…"), debounced as-you-type, `q=` in URL. Primary filters Type/Entity/Tag + `More filters` (expiry, year, sensitivity [admin], content-searchable state, archived subjects); active filters are removable chips; **all state in the URL** — bookmarking is the saved-view mechanism. Scope = selected shelf, or everything visible; never a hidden scope switch.

### 6.8 Grouping & sorting

`Group: Type ▾` (Type/Entity/Year/Expiry/None — presentation only) · `Sort: Newest ▾` (added desc/asc, name, expiry soonest). Year uses `periodOn`, falls back to `addedOn`. Expiry groups: Expired / Next 30 days / Later / No expiry.

### 6.9 Shelf management (Documents → Settings)

Drag to reorder (`sortOrder`), rename, change emoji, `+ Add shelf`; delete always via "32 documents need another shelf first → Move them to [ … ] → Move & delete". System shelves relabelable, never deletable, key immutable.

### 6.10 Extraction states

Indexed = nothing shown. Processing: "Preparing contents for search…". Failure: "Couldn't read searchable text from this file — the document itself is safe. Retry." Partial: §4.4 copy. Engine/confidence/provenance only under an admin `Technical details` disclosure.

### 6.11 Explicitly not built

Folder tree, ~~card/thumbnail grid~~, drag-and-drop between shelves, AI classification, saved-view management, separate advanced-search screen, permanent OCR column, upload wizard, metrics dashboard. A very good filing cabinet with excellent search — not a DMS.

> **Reversed in v0.7.4, for one shelf.** The card grid is built, on Identity only, and the reasoning that ruled it out was about the wrong shelf: a grid of thumbnails is a worse list of invoices, and it is a better wallet. What made it worth building is what the cards show. The face is drawn artwork picked by country and kind, never the scan — seven photographs of seven cards on white A4 are seven identical pale rectangles, which is slower to read than the list. Everything written over it comes from the record, so a card cannot state something the document does not.
>
> The list is unchanged, still has no thumbnails, and is one click away on every shelf; a search returns to it everywhere. Family, Health and Household have layouts specified and not yet built. Property, Finance, Statements and Inbox stay lists permanently: a layout is earned when the paper has a shape a person already pictures, and a mortgage agreement has none.
>
> The rest of this line stands. This is still a filing cabinet.

---

## 7. Open decisions — final state (v0.7.0 shipped, v0.7.1 amended)

| Item | Status |
|---|---|
| Restricted semantics + enforcement | **Shipped.** `visibleDocumentPredicate` is applied by the Documents load, search, every count, the briefing, calendar generation, the ICS feed and both file routes. A null actor is a member, so the token-authenticated feed cannot leak. |
| Restricted semantics on the module screens | **Shipped in v0.7.1**, and narrowed to D2: only the PAPER is hidden. Salary history, tax attachments and their picker, the property and loan cards, transaction receipts, the Investments reports and the Tags view (its counts included) all take an `Actor` and apply the predicate in SQL; a module's own figures — the salary a month is credited with — stay. |
| One link seam | **Shipped in v0.7.1** as `src/lib/server/documents/targets.ts`: nine linkable kinds in one registry, with `documentsAbout`, `candidateDocuments(For)`, `attachDocument`/`detachDocument`, search Tier B and the about-filter all built from it. The five hand-written per-screen lists it replaced are gone, and `tests/integration/document-targets` holds the subtraction from `ENTITY_KINDS`. |
| Documents on a record's screen | **Shipped in v0.7.1** as one component, `DocumentsCard` (`bare`, `confirmDetach`): property and tenancies, loans, accounts, contacts, transactions, tax statements and investments. A screen drawing its own list is now a bug. |
| Subjects UI | **Shipped in v0.7.1.** `subject` had a lifecycle since v0.7.0 and no writer; the rail's `SUBJECTS` section now renames, changes the emoji, adds, archives and unarchives, rows filter `?entity=`, archived rows are dimmed behind `Include archived subjects`, and the household is refused archiving in `subjects.ts` rather than in the markup. There is no `removeSubject` and there will not be one. |
| The record owns the deadline | **Shipped in v0.7.1** (D7) as `documents/deadlines.ts`: a document dated exactly as its linked tenancy's end or its loan's current fixation end reminds through the record only. A different date is not a duplicate and still reminds on its own. |
| Payslip ↔ bank credit cross-link | **Shipped in v0.7.1** (D6) as a `document_link` row written when a slip claims a recorded credit. Credit-then-slip only: a slip filed before the statement that pays it leaves two rows and no link, which is the pre-existing matching gap and out of scope here. |
| Upgrade path | **Not shipped, either release.** The `scripts/upgrade-documents-v2.mjs` this document expected was removed before v0.7.0 shipped, and v0.7.1 does not add one: it is fresh-install and demo only. A hand-migrated instance runs the operator SQL in the v0.7.1 plan after a backup. |
| Mixed PDFs | **Shipped** via per-page routing: a page with ≥50 folded characters becomes a `text_layer` chunk, one without is rasterised and OCR'd. |
| Tenancy → property shelf merge | Still deferred, and now cheap: shelves are rows, so it is a rename and a reassign rather than a migration. |
| Property lifecycle (sold flat) | Still deferred — a separate session with the finance side. `subject.archivedAt` and the archive-scope predicate are the half of it that landed. |
| Enum registry | Resolved as planned: `document.shelf` left, `document.type`, `document.sensitivity` and `document_text_chunk.source` entered, `job.kind` gained `extract_text`. |
| Trigram index on contents | **Kept.** 5 952 kB over 13 MB of chunks; the FTS-only fallback stays pre-authorised but is not needed. |
| PP-OCRv6/ONNX adapter | **Still deferred.** meanConfidence 93.25 mean over the rendered corpus; the `OcrProvider` seam is in place if real paper says otherwise. |
| Backlog import | **Shipped** as `scripts/import-documents.mjs`: mapping table, `contentHash` dedup, unmapped paths to the inbox, extraction queued rather than run inline. |

Two shapes departed from this document during the build, both recorded where
they landed rather than here:

- The **upgrade script was to live in `scripts/`**, not beside the baseline —
  `drizzle/` holds exactly one file and `tests/integration/baseline-migration`
  asserts it, so a second file there fails the suite. It was then removed
  before v0.7.0 shipped and never replaced; see the Upgrade path row above.
- The **drag handle reuses the existing `grip` icon** rather than adding a
  third new path. Two handle glyphs that look identical is the near-duplicate
  the icon set exists to avoid.

## 8. Deferred, with evidence triggers

Boilerplate-frequency suppression (only if content hits demonstrably drown results — tiering already outranks them) · PP-OCRv6/ONNX adapter (only if `meanConfidence` distribution or real search misses on the imported corpus say so; gate: linux-arm64 prebuilds) · Czech stemming (only if fold+trigram recall demonstrably fails) · per-person restricted ACLs (column unchanged either way).

## 9. Not in scope

Field extraction into metadata, PDF text layers / PDF/A, classification, versioning, sharing outside the instance, embeddings/semantic search, any scan-engine change.
