/**
 * The linkable-record supertype and the three link tables that use it.
 */

import {
	index,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';
// Relative, not aliased: drizzle-kit loads these files outside Vite and
// does not resolve SvelteKit's $lib.
import type { EntityKind } from '../../../enums';
import { contact } from './contacts';
import { document, tag } from './documents';

// ---- The linkable-record supertype ----

/**
 * Every record that can be tagged, filed a document against, or linked to a
 * contact carries a row here.
 *
 * It exists so ONE link table can point at any kind of record and still keep a
 * real foreign key at both ends. Without it, each connector needed a table per
 * pair — `document_person`, `document_property`, `property_tag`, `loan_tag` —
 * and a new module cost three more before it held a column of its own.
 *
 * Registration is NOT done here, and must not be attempted in application code.
 * Migration 0049 puts a BEFORE INSERT trigger on each of the eleven tables, so
 * inserting a record registers it; the concrete tables also carry a generated
 * `entity_kind` column and a composite foreign key into `(id, kind)`, which is
 * what makes a mismatched kind unrepresentable rather than merely discouraged.
 *
 * Drizzle models tables, not triggers or generated columns: none of that can be
 * recreated from this declaration, `db:generate` cannot notice it going missing,
 * and `drizzle-kit push` would build a database without it. Apply migrations.
 */
export const entity = pgTable(
	'entity',
	{
		id: uuid('id').primaryKey(),
		kind: text('kind').$type<EntityKind>().notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		uniqueIndex('entity_id_kind_key').on(table.id, table.kind),
		index('entity_kind_idx').on(table.kind)
	]
);

// ---- Links ----

/**
 * A tag on any kind of record.
 *
 * One table where there were five — document_tag, property_tag, loan_tag,
 * transaction_tag, transaction_split_tag — because the far end is an `entity`
 * rather than one named table. A new module inherits tagging without a table of
 * its own, and both ends still keep a real foreign key and a working cascade.
 *
 * Its own table rather than a shared `entity_link` with a `relation` column: a
 * tag link will want a colour or a note of its own before long, and there is
 * nowhere to put one on a table shared with document filing.
 */
export const tagLink = pgTable(
	'tag_link',
	{
		tagId: uuid('tag_id')
			.notNull()
			.references(() => tag.id, { onDelete: 'cascade' }),
		targetId: uuid('target_id')
			.notNull()
			.references(() => entity.id, { onDelete: 'cascade' })
	},
	// The primary key leads with tag_id and so cannot serve a lookup that only
	// knows the target, which is what "everything tagged like this" needs.
	(t) => [
		primaryKey({ columns: [t.tagId, t.targetId] }),
		index('tag_link_target_idx').on(t.targetId)
	]
);

/** A document filed against any kind of record. Replaces four tables. */
export const documentLink = pgTable(
	'document_link',
	{
		documentId: uuid('document_id')
			.notNull()
			.references(() => document.id, { onDelete: 'cascade' }),
		targetId: uuid('target_id')
			.notNull()
			.references(() => entity.id, { onDelete: 'cascade' })
	},
	(t) => [
		primaryKey({ columns: [t.documentId, t.targetId] }),
		index('document_link_target_idx').on(t.targetId)
	]
);

/** A contact attached to any kind of record. Replaces four tables. */
export const contactLink = pgTable(
	'contact_link',
	{
		contactId: uuid('contact_id')
			.notNull()
			.references(() => contact.id, { onDelete: 'cascade' }),
		targetId: uuid('target_id')
			.notNull()
			.references(() => entity.id, { onDelete: 'cascade' })
	},
	(t) => [
		primaryKey({ columns: [t.contactId, t.targetId] }),
		index('contact_link_target_idx').on(t.targetId)
	]
);
