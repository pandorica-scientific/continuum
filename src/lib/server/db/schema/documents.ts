// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Filed paperwork, the subjects it is filed under, and the tags applied to it.
 */

import { sql } from 'drizzle-orm';
import {
	boolean,
	date,
	index,
	integer,
	pgTable,
	primaryKey,
	real,
	text,
	timestamp,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';
// Relative, not aliased: drizzle-kit loads these files outside Vite and
// does not resolve SvelteKit's $lib.
import type { DocumentTypeKey, EnumValue } from '../../../enums';

// ---- Documents ----

/**
 * Where in life a document belongs — one level, never a tree.
 *
 * Rows rather than an enum, on the category-tree precedent: the slug `key` is
 * immutable and is what code refers to, the `label` is the household's to
 * change, and deleting one is a transactional reassign-and-delete because a
 * document must always be somewhere. Volume is answered by filtering and
 * grouping; there is no parent column and there will not be one.
 *
 * `system` marks the four rows the application refers to by key: `inbox`,
 * where capture lands; `statements`, where an accepted import files itself;
 * `finance`, where the salary tracker files payslips and tax attachments; and
 * `property`, where bills file themselves. Their label and emoji are the
 * household's ("K vyřízení" is a legal name for the inbox); their key and
 * their existence are not.
 */
export const shelf = pgTable('shelf', {
	id: uuid('id').primaryKey(),
	key: text('key').notNull().unique(),
	label: text('label').notNull(),
	emoji: text('emoji').notNull().default('🗂️'),
	sortOrder: integer('sort_order').notNull().default(0),
	system: boolean('system').notNull().default(false),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const document = pgTable(
	'document',
	{
		id: uuid('id').primaryKey(),
		name: text('name').notNull(),
		// ON DELETE RESTRICT, not CASCADE: deleting a shelf must never delete the
		// paper on it. The only legal delete is the transactional reassign-and-
		// delete in `shelves.ts`, and this constraint is what proves it.
		shelfId: uuid('shelf_id')
			.notNull()
			.references(() => shelf.id, { onDelete: 'restrict' }),
		// What kind of paper this is, independent of where it sits. The salary
		// tracker reads this; it used to read the shelf, which meant renaming a
		// shelf could silently unhook a feature.
		// A foreign key into `document_type`, not a CHECK: the household grows the
		// list, so what is valid is a row rather than a constant.
		// RESTRICT, not cascade: deleting a type the household still files under
		// must be refused, never allowed to take the paper with it. The key is a
		// row rather than a CHECK because a household invents its own types, and a
		// constraint is not something a person can add a value to.
		type: text('type')
			.$type<DocumentTypeKey>()
			.notNull()
			.default('other')
			.references(() => documentType.key, { onDelete: 'restrict' }),
		// The one user-authored phrase field, ranked above contents in search.
		note: text('note'),
		// Absent for members everywhere — list, search, counts, briefing,
		// calendar, ICS and the file itself. Enforced by
		// `visibleDocumentPredicate`, never by a screen.
		sensitivity: text('sensitivity')
			.$type<EnumValue<'document.sensitivity'>>()
			.notNull()
			.default('normal'),
		// uploaded file on the data volume; a document may be metadata-only
		storedName: text('stored_name'),
		ext: text('ext').notNull().default('PDF'),
		addedOn: date('added_on').notNull(),
		expiresOn: date('expires_on'),
		// how the expiry reads: expires | ends | renews
		expiryVerb: text('expiry_verb')
			.$type<EnumValue<'document.expiry_verb'>>()
			.notNull()
			.default('expires'),
		// The month a document is ABOUT, not the day it was filed. A payslip's own
		// figures and currency live on `salary_entry`; what the document adds is
		// which month the paper covers, which is how a re-uploaded slip finds its
		// own row again — see `payslipMatchingContent`.
		periodOn: date('period_on'),
		/**
		 * The last day this document covers, where it covers a span.
		 *
		 * `_on` because it is a date, which is this schema's naming rule —
		 * `tests/integration/schema-invariants` fails on a `date` column called
		 * anything else, and `period_end` was exactly that.
		 *
		 * Only statements need it so far, and they genuinely need it: `period_on`
		 * alone cannot say whether a statement is one month or a quarter, and the
		 * coverage ribbon draws exactly that difference. Null means the document
		 * covers the single month of `period_on`.
		 */
		periodEndOn: date('period_end_on'),
		// SHA-256 of the stored file's bytes, so the same file uploaded twice is
		// recognised as the same file. A month may hold more than one payslip
		// since v0.5.5, which removed the only key that used to catch a
		// re-upload — see `payslipMatchingContent`. Null on a document filed
		// before this column existed, and on a metadata-only one; filled in the
		// first time something has to compare against it.
		contentHash: text('content_hash')
	},
	(table) => [
		index('document_shelf_id_idx').on(table.shelfId),
		index('document_type_idx').on(table.type),
		index('document_content_hash_idx').on(table.contentHash)
	]
);

/**
 * That a document's text was read, and by what.
 *
 * One row per document. The text itself is NOT here — see the chunk table
 * below, and §2.4 of the handoff for why a single column cannot hold it.
 *
 * `complete=false` with `pagesExtracted` is the bounded-work contract: a
 * 600-page manual occupies the single CPU worker in slices rather than for an
 * afternoon, and the inspector says which pages are searchable instead of
 * quietly indexing a third of the file.
 */
export const documentText = pgTable('document_text', {
	documentId: uuid('document_id')
		.primaryKey()
		.references(() => document.id, { onDelete: 'cascade' }),
	engine: text('engine').notNull(),
	engineVersion: text('engine_version').notNull(),
	languages: text('languages').notNull(),
	meanConfidence: real('mean_confidence'),
	extractedAt: timestamp('extracted_at', { withTimezone: true }).notNull().defaultNow(),
	complete: boolean('complete').notNull().default(true),
	pagesExtracted: integer('pages_extracted')
});

/**
 * What kinds of paper this household files.
 *
 * Seventeen ship as built-ins and a household adds its own — a vaccination
 * book, a lease annex. Rows rather than a CHECK because the list is theirs to
 * grow, and a constraint is not something a person can add a value to.
 *
 * A built-in may be RELABELLED and never removed: `payslip` is what the salary
 * tracker reads, `bank_statement` what an accepted import writes, `id_document`
 * what puts the identity fields on a document. The key is the contract, the
 * label is the household's. Their own types carry no behaviour at all, which is
 * exactly why they are safe to invent.
 */
export const documentType = pgTable('document_type', {
	/** The value stored on a document. Immutable, and what code refers to. */
	key: text('key').primaryKey(),
	label: text('label').notNull(),
	/** True for the seventeen the app ships and reads by name. */
	builtin: boolean('builtin').notNull().default(false),
	sortOrder: integer('sort_order').notNull().default(0),
	/**
	 * How many days before its expiry a document of this kind turns amber.
	 *
	 * NULL means the sixty-day default in `view.ts`, so this is an OVERRIDE and
	 * not a second copy of it. It lives on the type rather than in code because
	 * how long a replacement takes is a fact about a country and a household,
	 * not about this repository: a passport is six months here and three
	 * elsewhere, and that should not need a release to change.
	 */
	reminderDays: integer('reminder_days')
});

/**
 * The types a shelf offers first, which the household may change.
 *
 * Seeded from `SHELF_PROFILES` and then owned by whoever is filing: the
 * registry's guess at what belongs on Health is a good one and it is still a
 * guess, and the household filing the paper knows better by the second week.
 *
 * It ORDERS and shortens the picker; it never restricts. A shelf still takes
 * any type — behaviour hangs off type and never off shelf — so a car insurance
 * policy filed under Identity is filed, not refused.
 */
export const shelfType = pgTable(
	'shelf_type',
	{
		shelfId: uuid('shelf_id')
			.notNull()
			.references(() => shelf.id, { onDelete: 'cascade' }),
		// CASCADE here, unlike on `document`: a deleted type should take its
		// mention in a shelf's picker with it, since a picker offering a type that
		// no longer exists is the one thing worse than a shorter picker.
		type: text('type')
			.$type<DocumentTypeKey>()
			.notNull()
			.references(() => documentType.key, { onDelete: 'cascade' }),
		/** The order they are offered in, which is the order they were ticked. */
		ordinal: integer('ordinal').notNull()
	},
	(table) => [
		primaryKey({ columns: [table.shelfId, table.type] }),
		// The primary key leads with `shelfId`, so it does not cover a lookup by
		// type alone — which is what deleting a household's own type does.
		index('shelf_type_type_idx').on(table.type)
	]
);

/**
 * What an identity document says on its face, entered by hand.
 *
 * One row per document, and only for `type = 'id_document'`. Nothing extracts
 * these: `documents/extract` reads text into chunks and is forbidden from
 * writing a record's fields, and a passport number filled in wrong by a
 * recogniser is worse than an empty box, because it is believed.
 *
 * Expiry is NOT here. It stays on `document.expires_on`, where the briefing,
 * the calendar feed and the wallet card all already read it — a second date
 * column would be a second answer to when the passport runs out.
 *
 * The row survives a change of type. A document retyped away from
 * `id_document` stops showing these fields and keeps them; retyping back
 * restores what was entered rather than asking for it again.
 */
export const documentIdentity = pgTable('document_identity', {
	documentId: uuid('document_id')
		.primaryKey()
		.references(() => document.id, { onDelete: 'cascade' }),
	kind: text('kind').$type<EnumValue<'document_identity.kind'>>().notNull().default('other'),
	/** ISO 3166-1 alpha-2, upper case; the shape is a CHECK in the appendix. */
	country: text('country'),
	/** Shown in the inspector, never on a card face, and never searched. */
	number: text('number'),
	issuedOn: date('issued_on'),
	issuer: text('issuer')
});

/**
 * The other numbers on an identity document, named by whoever typed them.
 *
 * One document really can carry several: a residence permit with a card number
 * and a personal number, a driving licence with a licence number beside a
 * national identifier. Rows rather than more columns, because there is no
 * ceiling to guess — a fifth column would be right until the household files
 * something with six.
 *
 * The LABEL is theirs too. Numbering schemes differ by country and by document
 * and a fixed list of names would be wrong somewhere on the first day.
 */
export const documentIdentityNumber = pgTable(
	'document_identity_number',
	{
		documentId: uuid('document_id')
			.notNull()
			.references(() => documentIdentity.documentId, { onDelete: 'cascade' }),
		/** Position in the form, which is the order they were typed in. */
		ordinal: integer('ordinal').notNull(),
		label: text('label').notNull(),
		value: text('value').notNull()
	},
	(table) => [primaryKey({ columns: [table.documentId, table.ordinal] })]
);

/**
 * One PDF page, one image, or a ≤100 KB slice of a plain-text file.
 *
 * Every content index lives here and nowhere else. The two GIN indexes are
 * expression indexes over `public.contact_fold(text)` and are written by hand
 * in the baseline appendix, because the query has to fold identically for the
 * index to be used at all — the contacts search already learned this.
 */
export const documentTextChunk = pgTable(
	'document_text_chunk',
	{
		documentId: uuid('document_id')
			.notNull()
			.references(() => documentText.documentId, { onDelete: 'cascade' }),
		ordinal: integer('ordinal').notNull(),
		/** Null for plain-text slices and single images: they have no page. */
		pageNo: integer('page_no'),
		source: text('source').$type<EnumValue<'document_text_chunk.source'>>().notNull(),
		text: text('text').notNull()
	},
	(table) => [
		primaryKey({ columns: [table.documentId, table.ordinal] }),
		index('dtc_document_idx').on(table.documentId)
	]
);

// Cross-cutting groupings: a renovation, a holiday. Every tag has a running
// total, which is why no kind column is needed.
export const tag = pgTable('tag', {
	id: uuid('id').primaryKey(),
	name: text('name').notNull(),
	// trimmed, lowercased, inner whitespace collapsed — carries the uniqueness
	normalisedName: text('normalised_name').notNull().unique(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

// ---- Subjects and tags ----

// What a document can belong to when it is not a person, flat or investment:
// the household, the car, the dog. A record created once and linked to — never
// a name retyped and hoped to match. Seeded with one row for the household.
export const subject = pgTable(
	'subject',
	{
		id: uuid('id').primaryKey(),
		name: text('name').notNull().unique(),
		emoji: text('emoji').notNull().default('🏠'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		// Archiving a subject demotes everything filed under it in one reversible
		// action — a sold car stops crowding the list without anything being
		// deleted. `activeFrom`/`activeTo` are the period the subject was real,
		// which is what lets an old document read as history rather than as an
		// expiry someone forgot.
		archivedAt: timestamp('archived_at', { withTimezone: true }),
		activeFrom: date('active_from'),
		activeTo: date('active_to')
	},
	// "Car" and "car" are the same thing; two records differing only in case
	// would be the phantom-column problem sneaking back in.
	(table) => [uniqueIndex('subject_name_ci_idx').on(sql`lower(${table.name})`)]
);

// ---- SQL drizzle-kit cannot model ----

/**
 * Shapes a CHECK can state and a column type cannot.
 */
export const documentsCheckSql = `
-- period_on means "the month this document covers", so a mid-month day is either
-- a different fact or a mistake.
ALTER TABLE document ADD CONSTRAINT document_period_first_of_month
	CHECK (period_on IS NULL OR extract(day from period_on) = 1);
--> statement-breakpoint
-- The other end of the same fact. period_end_on closes the LAST month a document
-- covers, so it is that month's last day — the mirror of the rule above, and
-- what lets a statement say "April and May" without saying which days.
ALTER TABLE document ADD CONSTRAINT document_period_end_last_of_month
	CHECK (period_end_on IS NULL OR period_end_on = (date_trunc('month', period_end_on) + interval '1 month - 1 day')::date);
--> statement-breakpoint
-- A period that ends before it starts is not a period, and would draw a box of
-- negative width. period_end_on without period_on is an end to nothing.
ALTER TABLE document ADD CONSTRAINT document_period_order_check
	CHECK (period_end_on IS NULL OR (period_on IS NOT NULL AND period_end_on >= period_on));
--> statement-breakpoint
-- Two upper-case letters or nothing. The field is a picker, so this is not
-- defending against a typist; it is what keeps the artwork lookup and the flag
-- from being handed 'Czechia' by a future importer and drawing nothing.
ALTER TABLE document_identity ADD CONSTRAINT document_identity_country_check
	CHECK (country IS NULL OR country ~ '^[A-Z]{2}$');
--> statement-breakpoint
-- A period that ends before it starts is not a period. NULLs are legal on both
-- sides: a subject that is simply current has neither.
ALTER TABLE subject ADD CONSTRAINT subject_active_period_check
	CHECK (active_from IS NULL OR active_to IS NULL OR active_from <= active_to);
`;

/**
 * Search indexes over expressions, which drizzle-kit models no more than it
 * models a trigger.
 *
 * Trigram matching is for identifiers: a variable symbol like 10078410 is not a
 * word to any text-search configuration, so full-text search alone never finds
 * it. Both indexes fold with the SAME expression the query uses — `contact_fold`
 * is IMMUTABLE and PARALLEL SAFE, which is what makes it indexable at all — and
 * it is schema-qualified in every reference, as unaccent already is, because
 * search_path is not something a migration should depend on.
 */
export const documentsIndexSql = `
CREATE INDEX dtc_fts_idx ON document_text_chunk
	USING gin (to_tsvector('simple', public.contact_fold(text)));
--> statement-breakpoint
CREATE INDEX dtc_trgm_idx ON document_text_chunk
	USING gin (public.contact_fold(text) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX document_name_trgm_idx ON document
	USING gin (public.contact_fold(name) gin_trgm_ops);
`;

/**
 * The seventeen types the app ships with, the ten shelves a fresh install
 * starts with, and what each shelf offers first in a type picker.
 *
 * Data rather than schema, and the one part of the baseline `db:generate` will
 * never re-emit: a regenerated file that dropped them would take a foreign key's
 * only satisfiable value with it, and the first symptom is a screen with a
 * control missing rather than an error.
 *
 * A household adds its own types beside the built-ins; these are the ones code
 * reads by name, so they are marked and kept. Households likewise rename,
 * re-order and re-emoji the shelves freely — eight of the ten cannot be removed,
 * for two different reasons that both end at the same flag. Four are keys the
 * application writes to: capture files into `inbox`, an accepted import files
 * into `statements`, payslips and tax attachments file into `finance`, bills
 * file into `property`. Deleting one of those breaks the next upload. Four are
 * the paper every household has whether or not it has said so: `identity`,
 * `family`, `health` and `household`. Nothing files into them by key, so
 * deleting one breaks nothing today — but a documents product whose shipped
 * answer to "where does a passport go" can be removed has no shipped answer.
 * `tenancy` and `vehicles` stay removable, and are the reason the flag is a
 * column rather than a list of every seeded key: not every household rents, and
 * not every household drives.
 */
export const documentsSeedSql = `
-- One place for a document to always belong: the household. The documents
-- screen offers it as a tick beside the people, and nothing else creates it.
INSERT INTO subject (id, name, emoji) VALUES (gen_random_uuid(), 'Household', '🏠');
--> statement-breakpoint
INSERT INTO document_type (key, label, builtin, sort_order, reminder_days) VALUES
	('contract', 'Contract', true, 0, NULL),
	('invoice', 'Invoice', true, 10, NULL),
	('receipt', 'Receipt', true, 20, NULL),
	('payslip', 'Payslip', true, 30, NULL),
	('bank_statement', 'Bank statement', true, 40, NULL),
	('broker_report', 'Broker report', true, 50, NULL),
	('insurance_policy', 'Insurance policy', true, 60, NULL),
	('claim', 'Claim', true, 70, NULL),
	-- Six months, because that is how long replacing one takes. A warning that
	-- arrives with sixty days left is a warning about a trip you can no longer
	-- make.
	('id_document', 'Identity document', true, 80, 180),
	('certificate', 'Certificate', true, 90, NULL),
	('medical_record', 'Medical record', true, 100, NULL),
	('tax_document', 'Tax document', true, 110, NULL),
	('technical_plan', 'Technical plan', true, 120, NULL),
	('correspondence', 'Correspondence', true, 130, NULL),
	('warranty', 'Warranty', true, 140, NULL),
	('manual', 'Manual', true, 150, NULL),
	('other', 'Other', true, 160, NULL)
ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint
INSERT INTO shelf (id, key, label, emoji, sort_order, system) VALUES
	(gen_random_uuid(), 'inbox',      'Inbox',      '📬',  0, true),
	(gen_random_uuid(), 'identity',   'Identity',   '🪪', 10, true),
	(gen_random_uuid(), 'family',     'Family',     '👶', 20, true),
	(gen_random_uuid(), 'health',     'Health',     '🩺', 30, true),
	(gen_random_uuid(), 'property',   'Property',   '🏠', 40, true),
	(gen_random_uuid(), 'tenancy',    'Tenancy',    '🔑', 50, false),
	(gen_random_uuid(), 'vehicles',   'Vehicles',   '🚗', 60, false),
	(gen_random_uuid(), 'finance',    'Finance',    '🏦', 70, true),
	(gen_random_uuid(), 'household',  'Household',  '🔧', 80, true),
	(gen_random_uuid(), 'statements', 'Statements', '🧾', 90, true)
ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint
INSERT INTO shelf_type (shelf_id, type, ordinal) VALUES
	((SELECT id FROM shelf WHERE key = 'identity'), 'id_document', 0),
	((SELECT id FROM shelf WHERE key = 'identity'), 'certificate', 1),
	((SELECT id FROM shelf WHERE key = 'family'), 'certificate', 0),
	((SELECT id FROM shelf WHERE key = 'family'), 'contract', 1),
	((SELECT id FROM shelf WHERE key = 'family'), 'correspondence', 2),
	((SELECT id FROM shelf WHERE key = 'health'), 'medical_record', 0),
	((SELECT id FROM shelf WHERE key = 'health'), 'certificate', 1),
	((SELECT id FROM shelf WHERE key = 'health'), 'insurance_policy', 2),
	((SELECT id FROM shelf WHERE key = 'health'), 'invoice', 3),
	((SELECT id FROM shelf WHERE key = 'property'), 'insurance_policy', 0),
	((SELECT id FROM shelf WHERE key = 'property'), 'technical_plan', 1),
	((SELECT id FROM shelf WHERE key = 'property'), 'contract', 2),
	((SELECT id FROM shelf WHERE key = 'property'), 'invoice', 3),
	((SELECT id FROM shelf WHERE key = 'tenancy'), 'contract', 0),
	((SELECT id FROM shelf WHERE key = 'tenancy'), 'invoice', 1),
	((SELECT id FROM shelf WHERE key = 'tenancy'), 'correspondence', 2),
	((SELECT id FROM shelf WHERE key = 'vehicles'), 'warranty', 0),
	((SELECT id FROM shelf WHERE key = 'vehicles'), 'insurance_policy', 1),
	((SELECT id FROM shelf WHERE key = 'vehicles'), 'invoice', 2),
	((SELECT id FROM shelf WHERE key = 'vehicles'), 'manual', 3),
	((SELECT id FROM shelf WHERE key = 'finance'), 'payslip', 0),
	((SELECT id FROM shelf WHERE key = 'finance'), 'tax_document', 1),
	((SELECT id FROM shelf WHERE key = 'finance'), 'invoice', 2),
	((SELECT id FROM shelf WHERE key = 'finance'), 'contract', 3),
	((SELECT id FROM shelf WHERE key = 'household'), 'warranty', 0),
	((SELECT id FROM shelf WHERE key = 'household'), 'manual', 1),
	((SELECT id FROM shelf WHERE key = 'household'), 'invoice', 2),
	((SELECT id FROM shelf WHERE key = 'household'), 'receipt', 3),
	((SELECT id FROM shelf WHERE key = 'household'), 'contract', 4),
	((SELECT id FROM shelf WHERE key = 'statements'), 'bank_statement', 0),
	((SELECT id FROM shelf WHERE key = 'statements'), 'broker_report', 1)
ON CONFLICT (shelf_id, type) DO NOTHING;
`;
