# Entity Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every document belongs to real records — people, flats, investment accounts, or subject records — through typed join tables. The free-text `subject` column and the jsonb `tags` column on documents are dropped; tags widen to documents, properties and loans.

**Architecture:** Typed join tables following `loanProperty`'s precedent, never a generic edge table. The migration backfills links from the existing subject strings inside the SQL migration itself (before the columns drop), creating `subject` records for anything that matches no entity, so nothing is lost and nothing stays as loose text.

**Tech Stack:** SvelteKit (Svelte 5 runes), TypeScript strict, PostgreSQL via Drizzle ORM, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-14-entity-links-design.md`

## Global Constraints

- **Robert makes all git commits.** Never run `git commit`. Each task ends with a verification checkpoint; stop there and report.
- Money is integer minor units (`bigint`) plus a currency code.
- Nothing variable is hard-coded.
- Server-only code lives under `src/lib/server/`; pure logic elsewhere under `src/lib/`.
- **UI principle from the spec is a requirement:** no collapsed "Related" panels, no extra clicks to link (checkboxes in the existing add form), a count is never shown where the items could be.
- Tests: `npm test`, `npm run test:e2e` (needs `npm run build` and the database), `npm run check`, `npm run lint`.
- `drizzle-kit` needs `DATABASE_URL` even to generate: prefix with `DATABASE_URL='postgres://continuum:continuum@localhost:5432/continuum'`.

## Context the implementer needs

**Every writer and reader of `document.subject` / `document.tags`, verified by grep:**

| Site                                      | What it does today                                                                                                                                                               |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `documents/+page.server.ts` load          | derives columns from distinct subjects; `matchesQuery` searches subject + tags; tag chips from jsonb `tags`; `subjectSuggestions`; prefill `?subject=`                           |
| `documents/+page.server.ts` `addDocument` | writes `subject` and `tags` from the form                                                                                                                                        |
| `retirement/+page.server.ts`              | filters payslips by `subject === person.name` (lowercased/trimmed); payslip upload writes `subject` (line ~215)                                                                  |
| `property/+page.server.ts`                | filters documents by `subject === property.name` (line ~227); bill upload writes `subject: rows[0].name` (line ~412) with `tags: ['bill']`; `addDocumentHref` passes `&subject=` |
| `demo.ts`                                 | seeds payslips with `subject: 'Jana Nováková'` and a tenancy doc with `subject: 'Flat Karlín'`                                                                                   |
| `tests/e2e/flow.spec.ts`                  | two tests fill `input[name=subject]` (documents ~line 285, property ~line 306)                                                                                                   |

Dropping the columns makes every one of these a **type error**, which is the safety net: the compiler finds all sites, so none can be missed. The E2E selector changes are legitimate behaviour changes, not weakened tests — the assertions (column derives, document appears on the flat) stay.

**No rename UI exists** for people or properties, so rename-safety is proven at unit level (derivation reads current names), not E2E.

**Migration numbering:** the last migration is `0014_silly_kylun.sql` (api_token), so this is `0015_*`.

---

## File Structure

**Create:**

- `src/lib/documents-links.ts` — pure column derivation from links. Client-safe.
- `tests/unit/document-links.test.ts`.
- `scratch-workspace/verify-links-migration.mjs` — seeds old-shape rows and checks the backfill buckets (throwaway, not committed).

**Modify:**

- `src/lib/server/db/schema.ts` — `subject` table, 4 document joins, 3 tag joins; drop `document.subject`, `document.tags`.
- `drizzle/0015_*.sql` — generated, then hand-extended with the backfill **before** the column drops.
- `src/routes/(app)/documents/+page.server.ts`, `+page.svelte` — checkboxes, links, tag table.
- `src/routes/(app)/retirement/+page.server.ts`, `+page.svelte` — payslips via `document_person`; upload sends `personId`.
- `src/routes/(app)/property/+page.server.ts` — documents via `document_property`; bill upload links; href passes `propertyId`.
- `src/routes/(app)/tags/+page.svelte`, `+page.server.ts` — a tag also lists the documents and properties it tags.
- `src/lib/server/demo.ts`, `tests/e2e/flow.spec.ts`.

---

### Task 1: Schema, migration and backfill

**Files:**

- Modify: `src/lib/server/db/schema.ts`
- Create: `drizzle/0015_*.sql` (generated + hand-extended)

- [ ] **Step 1: Add the tables, drop the columns**

Add to `schema.ts` (after the `tag` table so references resolve):

```ts
// ---- Subjects and entity links ----

// What a document can belong to when it is not a person, flat or investment:
// the household, the car, the dog. A record created once and linked to — never
// a name retyped and hoped to match. Seeded with one row for the household.
export const subject = pgTable('subject', {
	id: text('id').primaryKey(),
	name: text('name').notNull().unique(),
	emoji: text('emoji').notNull().default('🏠'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const documentPerson = pgTable(
	'document_person',
	{
		documentId: text('document_id')
			.notNull()
			.references(() => document.id, { onDelete: 'cascade' }),
		personId: text('person_id')
			.notNull()
			.references(() => person.id, { onDelete: 'cascade' })
	},
	(t) => [primaryKey({ columns: [t.documentId, t.personId] })]
);

export const documentProperty = pgTable(
	'document_property',
	{
		documentId: text('document_id')
			.notNull()
			.references(() => document.id, { onDelete: 'cascade' }),
		propertyId: text('property_id')
			.notNull()
			.references(() => property.id, { onDelete: 'cascade' })
	},
	(t) => [primaryKey({ columns: [t.documentId, t.propertyId] })]
);

export const documentAccount = pgTable(
	'document_account',
	{
		documentId: text('document_id')
			.notNull()
			.references(() => document.id, { onDelete: 'cascade' }),
		accountId: text('account_id')
			.notNull()
			.references(() => account.id, { onDelete: 'cascade' })
	},
	(t) => [primaryKey({ columns: [t.documentId, t.accountId] })]
);

export const documentSubject = pgTable(
	'document_subject',
	{
		documentId: text('document_id')
			.notNull()
			.references(() => document.id, { onDelete: 'cascade' }),
		subjectId: text('subject_id')
			.notNull()
			.references(() => subject.id, { onDelete: 'cascade' })
	},
	(t) => [primaryKey({ columns: [t.documentId, t.subjectId] })]
);

export const documentTag = pgTable(
	'document_tag',
	{
		documentId: text('document_id')
			.notNull()
			.references(() => document.id, { onDelete: 'cascade' }),
		tagId: text('tag_id')
			.notNull()
			.references(() => tag.id, { onDelete: 'cascade' })
	},
	(t) => [primaryKey({ columns: [t.documentId, t.tagId] })]
);

export const propertyTag = pgTable(
	'property_tag',
	{
		propertyId: text('property_id')
			.notNull()
			.references(() => property.id, { onDelete: 'cascade' }),
		tagId: text('tag_id')
			.notNull()
			.references(() => tag.id, { onDelete: 'cascade' })
	},
	(t) => [primaryKey({ columns: [t.propertyId, t.tagId] })]
);

export const loanTag = pgTable(
	'loan_tag',
	{
		loanId: text('loan_id')
			.notNull()
			.references(() => loan.id, { onDelete: 'cascade' }),
		tagId: text('tag_id')
			.notNull()
			.references(() => tag.id, { onDelete: 'cascade' })
	},
	(t) => [primaryKey({ columns: [t.loanId, t.tagId] })]
);
```

Then delete `subject: text('subject')...` and `tags: jsonb('tags')...` from the `document` table. `npm run check` will now light up every consumer — that list must match the table in "Context" above.

- [ ] **Step 2: Generate, then reorder**

Run: `DATABASE_URL='postgres://continuum:continuum@localhost:5432/continuum' npm run db:generate`

**The trap of this migration:** drizzle emits `ALTER TABLE "document" DROP COLUMN "subject"` / `"tags"` in the same file as the CREATEs. The backfill reads those columns, so the two DROP statements must be **moved to the end of the file**, after the hand-written backfill below. Verify by reading the final SQL top to bottom: creates → seed → backfill → drops.

- [ ] **Step 3: Hand-write the backfill**

Insert between the creates and the drops (each statement separated by `--> statement-breakpoint`):

```sql
-- One place for a document to always belong: the household.
INSERT INTO "subject" (id, name, emoji) VALUES (gen_random_uuid()::text, 'Household', '🏠');
--> statement-breakpoint
-- 1. Subjects naming a person.
INSERT INTO "document_person" (document_id, person_id)
SELECT d.id, p.id FROM "document" d
JOIN "person" p ON lower(trim(d.subject)) = lower(trim(p.name))
WHERE d.subject <> '';
--> statement-breakpoint
-- 2. Subjects naming a flat.
INSERT INTO "document_property" (document_id, property_id)
SELECT d.id, pr.id FROM "document" d
JOIN "property" pr ON lower(trim(d.subject)) = lower(trim(pr.name))
WHERE d.subject <> ''
  AND NOT EXISTS (SELECT 1 FROM "document_person" dp WHERE dp.document_id = d.id);
--> statement-breakpoint
-- 3. Subjects naming a brokerage account.
INSERT INTO "document_account" (document_id, account_id)
SELECT d.id, a.id FROM "document" d
JOIN "account" a ON a.kind = 'brokerage' AND lower(trim(d.subject)) = lower(trim(a.name))
WHERE d.subject <> ''
  AND NOT EXISTS (SELECT 1 FROM "document_person" dp WHERE dp.document_id = d.id)
  AND NOT EXISTS (SELECT 1 FROM "document_property" dr WHERE dr.document_id = d.id);
--> statement-breakpoint
-- 4. Everything else becomes a subject record, one per distinct name.
INSERT INTO "subject" (id, name, emoji)
SELECT gen_random_uuid()::text, trim(d.subject), '📁'
FROM "document" d
WHERE d.subject <> ''
  AND NOT EXISTS (SELECT 1 FROM "document_person" dp WHERE dp.document_id = d.id)
  AND NOT EXISTS (SELECT 1 FROM "document_property" dr WHERE dr.document_id = d.id)
  AND NOT EXISTS (SELECT 1 FROM "document_account" da WHERE da.document_id = d.id)
GROUP BY trim(d.subject)
ON CONFLICT (name) DO NOTHING;
--> statement-breakpoint
INSERT INTO "document_subject" (document_id, subject_id)
SELECT d.id, s.id FROM "document" d
JOIN "subject" s ON s.name = trim(d.subject)
WHERE d.subject <> ''
  AND NOT EXISTS (SELECT 1 FROM "document_person" dp WHERE dp.document_id = d.id)
  AND NOT EXISTS (SELECT 1 FROM "document_property" dr WHERE dr.document_id = d.id)
  AND NOT EXISTS (SELECT 1 FROM "document_account" da WHERE da.document_id = d.id);
--> statement-breakpoint
-- Empty subjects belong to the household.
INSERT INTO "document_subject" (document_id, subject_id)
SELECT d.id, s.id FROM "document" d, "subject" s
WHERE d.subject = '' AND s.name = 'Household';
--> statement-breakpoint
-- Old jsonb tags become real tag rows, same normalisation as normaliseTagName.
INSERT INTO "tag" (id, name, normalised_name)
SELECT gen_random_uuid()::text, t.name, lower(regexp_replace(trim(t.name), '\s+', ' ', 'g'))
FROM (SELECT DISTINCT jsonb_array_elements_text(tags) AS name FROM "document") t
WHERE trim(t.name) <> ''
ON CONFLICT (normalised_name) DO NOTHING;
--> statement-breakpoint
INSERT INTO "document_tag" (document_id, tag_id)
SELECT d.id, tg.id FROM "document" d
CROSS JOIN LATERAL jsonb_array_elements_text(d.tags) AS el(name)
JOIN "tag" tg ON tg.normalised_name = lower(regexp_replace(trim(el.name), '\s+', ' ', 'g'))
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- The report the spec requires: visible in the boot log.
DO $$
DECLARE np int; nr int; na int; ns int; created text;
BEGIN
  SELECT count(*) INTO np FROM document_person;
  SELECT count(*) INTO nr FROM document_property;
  SELECT count(*) INTO na FROM document_account;
  SELECT count(*) INTO ns FROM document_subject;
  SELECT coalesce(string_agg(name, ', '), '(none)') INTO created FROM subject WHERE name <> 'Household';
  RAISE NOTICE 'entity-links backfill: % person, % property, % account, % subject links; subjects created: %', np, nr, na, ns, created;
END $$;
```

- [ ] **Step 4: Verify against old-shape data**

Fresh databases run this migration with zero documents, so the backfill is a no-op there. Prove it against real old-shape rows the way the rules migration was proven: write `scratch-workspace/verify-links-migration.mjs` that (a) creates a scratch database, (b) applies migrations up to 0014, (c) inserts a person "Jana Nováková", a property "Flat Karlín", and four documents with subjects `'jana nováková '`, `'Flat Karlín'`, `'Vehicle'`, `''` plus one with `tags: ['bill']`, (d) applies 0015, (e) asserts: one `document_person`, one `document_property`, a created subject "Vehicle" with its link, the empty one linked to Household, a `tag` row "bill" with its `document_tag`, and that `information_schema` no longer has `document.subject`. Print the buckets.

- [ ] **Step 5: Checkpoint**

`npm run check` is expected to FAIL at this point — the consumers are broken by design and fixed in Tasks 2–4. Report the failure list and confirm it matches the "Context" table exactly. Robert reviews; **no commit yet** (the tree does not type-check; Tasks 1–4 land as one commit).

---

### Task 2: Pure column derivation

**Files:**

- Create: `src/lib/documents-links.ts`, `tests/unit/document-links.test.ts`

**Interfaces:**

```ts
interface LinkedDoc {
	id: string;
	// current names of everything this document belongs to, already joined
	people: string[];
	properties: string[];
	accounts: string[];
	subjects: string[];
}
/** Column labels in display order: people, properties, accounts, subjects. */
function deriveColumns(docs: LinkedDoc[]): { label: string; docIds: string[] }[];
/** True when the document belongs to nothing — refused at the save boundary. */
function isUnlinked(picked: {
	people: string[];
	properties: string[];
	accounts: string[];
	subjects: string[];
}): boolean;
```

- [ ] **Step 1: Failing tests** — a doc linked to two people appears in both columns and is counted once per column; column order is people → properties → accounts → subjects, alphabetical within each; renaming is structural (the label is whatever name is passed in, so the test feeds a changed name and the docs follow); `isUnlinked` true only when all four lists are empty.
- [ ] **Step 2:** Run `npx vitest run tests/unit/document-links.test.ts` — FAIL on missing module.
- [ ] **Step 3:** Implement — a `Map<label, docIds>` built in order, no dedup across columns (both-people is the point), dedup within a column.
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5:** Report. Still no commit (tree still red from Task 1).

---

### Task 3: Documents screen on links

**Files:**

- Modify: `src/routes/(app)/documents/+page.server.ts`, `+page.svelte`

- [ ] **Step 1: Load** — fetch people, properties, brokerage accounts, subjects and all four join tables plus `document_tag`+`tag`; build `LinkedDoc[]` and derive columns via `deriveColumns`. `matchesQuery` searches linked names and tag names instead of the dropped columns. Tag chips come from the `tag` table. Prefill accepts `?personId=`, `?propertyId=` (ids, not names).
- [ ] **Step 2: Add form** — replace the subject input with four checkbox groups (people, flats, investments, subjects) labelled by name, plus a "＋ new subject" affordance: a small input revealed by the ＋ that posts `newSubject` and ticks it. Tags become a text input backed by `upsertTag`, comma separated as before.
- [ ] **Step 3: `addDocument` action** — collect `personIds[]`, `propertyIds[]`, `accountIds[]`, `subjectIds[]`, optional `newSubject`. If `newSubject` is non-empty, insert the subject record (unique on name; on conflict reuse) and add its id. **If all four are empty after that, `fail(400, 'A document has to belong to something — tick the household if nothing else fits.')`.** Insert the joins; tags via `upsertTag` + `document_tag`.
- [ ] **Step 4: List display** — each document card shows what it belongs to as plain text (`Jana · Flat Karlín`), always visible, never a count.
- [ ] **Step 5:** Report. Still no commit.

---

### Task 4: Retirement, property and demo on links — delete the name comparison

**Files:**

- Modify: `src/routes/(app)/retirement/+page.server.ts`, `+page.svelte`, `src/routes/(app)/property/+page.server.ts`, `src/lib/server/demo.ts`

- [ ] **Step 1: Retirement reads** — payslips found by `document_person` join on `personId` instead of the subject comparison. **Delete the comparison.** The payslip upload form sends `personId` (the select's value becomes the id; its label stays the name); the insert writes the join row. `learnAmountLabel` keeps receiving the person's _name_ — its learned labels are keyed by name in settings and that key is orthogonal to this change.
- [ ] **Step 2: Property reads** — documents on the flat's card via `document_property`. **Delete the comparison.** The bill upload inserts a `document_property` row and a `document_tag` for "bill" (via `upsertTag`). `addDocumentHref` passes `&propertyId=${current.id}`.
- [ ] **Step 3: Demo** — payslips link `document_person` to Jana's id; the tenancy contract links `document_property` to Flat Karlín. Seed subjects: the migration's Household insert only runs via SQL on upgrade paths where the migration executes with the table present — it always runs, so demo needs no extra seed; verify one Household row exists after demo boot.
- [ ] **Step 4: The checkpoint** — `grep -rn "subject.trim().toLowerCase()" src/` returns **nothing**, `npm run check` returns 0 errors for the first time since Task 1, `npm test` green, `npm run build && npx playwright test` — the two E2E tests that filled `input[name=subject]` now fail; update them to the new interaction and keep their assertions:
  - documents test: tick the "Jana Nováková" checkbox instead of typing; still assert the column appears with her name and the document in it.
  - property test: assert the form arrives with the flat's checkbox pre-ticked (from `?propertyId=`); still assert the document lands on the flat's card.
- [ ] **Step 5:** All green → **this is the commit point for Tasks 1–4.** Report totals. Robert reviews and commits.

---

### Task 5: Tags widened — visible where you already are

**Files:**

- Modify: `src/routes/(app)/tags/+page.server.ts`, `+page.svelte`

- [ ] **Step 1:** The tags screen's rows gain, beneath the money totals, the documents and properties carrying that tag — listed inline by name (linking to the document file / the property screen), capped at five with "+N more" only past that. Money totals are unchanged: document and property tags carry no amounts.
- [ ] **Step 2:** `property_tag` and `loan_tag` exist in schema from Task 1; wiring TagInput onto the property and loan screens follows the register's existing pattern (`TagInput` + a `tags` action). Keep it to exactly that — no new UI concepts.
- [ ] **Step 3:** `npm test && npm run check && npm run lint && npm run build && npx playwright test` all green. Report. Robert reviews and commits.

---

### Task 6: E2E journey and demo verification

**Files:**

- Modify: `tests/e2e/flow.spec.ts`

- [ ] **Step 1: New tests** (after the API tests): add a document ticking **both** people → it appears under both columns; create a new subject ("Car") via the ＋ affordance in the same form → a Car column exists with the document.
- [ ] **Step 2:** Full suite: target **29 E2E**. Boot demo mode fresh and confirm the documents screen shows columns for Jana and Flat Karlín derived from links, and the boot log contains the backfill NOTICE.
- [ ] **Step 3:** Report. Robert reviews and commits.

---

## Notes for the implementer

**The migration reorder is the trap.** Drizzle emits the DROP COLUMN statements with the creates; the backfill must run between them. Read the final SQL top to bottom before applying it anywhere.

**Tasks 1–4 are one commit.** Dropping the columns intentionally breaks every consumer so the compiler enumerates them; the tree does not type-check again until Task 4 Step 4. Do not "fix" the type errors by re-adding the columns.

**Do not weaken the two updated E2E tests.** The interaction changes (checkbox instead of text input); the assertions — column derived, document on the flat — do not.

**A count is never the UI.** Anywhere this plan says "listed", it means the items, inline, capped with "+N more" only on genuine overflow.
