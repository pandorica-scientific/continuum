// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
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
		type: text('type').$type<DocumentTypeKey>().notNull().default('other'),
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
	sortOrder: integer('sort_order').notNull().default(0)
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
		type: text('type').$type<DocumentTypeKey>().notNull(),
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
