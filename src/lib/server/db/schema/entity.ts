// SPDX-License-Identifier: AGPL-3.0-or-later
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
import { ENTITY_KINDS, type EntityKind } from '../../../enums';
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
 * The baseline puts a BEFORE INSERT trigger on each of the twelve tables, so
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

// ---- SQL drizzle-kit cannot model ----

/**
 * The supertype's own constraint and the machinery that registers into it.
 *
 * Three decisions worth stating, because each one is load-bearing.
 *
 * 1. `UNIQUE (id, kind)` exists so a concrete table can reference the PAIR. Each
 *    table carries a generated `entity_kind` column fixed to its own kind, so a
 *    `tag` row can only ever point at an entity registered as a tag. Without it
 *    a link table would happily accept an id belonging to a different kind of
 *    record, and the resulting row would read as perfectly valid.
 *
 * 2. Registration is a BEFORE INSERT trigger, not something callers remember.
 *    That is what makes this safe across every kind at once: no insert path
 *    above the database changes, and an insert that "forgot" to register cannot
 *    exist. A helper would have been one more thing to omit, and the composite
 *    foreign key would then have turned the omission into a failed write at some
 *    unrelated call site.
 *
 * 3. Deletion works in both directions. Removing the entity cascades to the
 *    record; removing the record retires the entity through an AFTER DELETE
 *    trigger. Only the first is a foreign key, so without the second the
 *    supertype would fill with orphans that a later link could still attach to.
 *    The two do not recurse: by the time either trigger runs, the row it would
 *    delete is already gone.
 *
 * Written as a loop over `ENTITY_KINDS` rather than a copy per kind — twelve
 * copies of the same four statements is twelve chances for one to differ by
 * accident — and the list is read from `$lib/enums` rather than repeated, so
 * adding a kind is one edit in one language.
 */
export const entitySql = `
DO $outer$
DECLARE
\tt text;
\thas_created_at boolean;
BEGIN
\tFOREACH t IN ARRAY ARRAY[${ENTITY_KINDS.map((kind) => `'${kind}'`).join(', ')}]
\tLOOP
\t\tEXECUTE format(
\t\t\t'ALTER TABLE %I ADD COLUMN entity_kind text GENERATED ALWAYS AS (%L) STORED', t, t);

\t\tEXECUTE format(
\t\t\t'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (id, entity_kind)
\t\t\t\tREFERENCES entity (id, kind) ON DELETE CASCADE',
\t\t\tt, t || '_entity_fk');

\t\t-- A table that records its own creation time hands it to the entity, so
\t\t-- the two never disagree. The demo seed inserts rows dated years back;
\t\t-- stamping now() here would have given those records an entity younger
\t\t-- than the record itself, which is the divergence that makes a shared
\t\t-- audit column worth having in the first place.
\t\tSELECT EXISTS (
\t\t\tSELECT 1 FROM information_schema.columns
\t\t\tWHERE table_schema = 'public' AND table_name = t AND column_name = 'created_at'
\t\t) INTO has_created_at;

\t\tIF has_created_at THEN
\t\t\tEXECUTE format($f$
\t\t\t\tCREATE FUNCTION %I() RETURNS trigger LANGUAGE plpgsql AS $b$
\t\t\t\tBEGIN
\t\t\t\t\tINSERT INTO entity (id, kind, created_at)
\t\t\t\t\t\tVALUES (NEW.id, %L, COALESCE(NEW.created_at, now()))
\t\t\t\t\t\tON CONFLICT (id) DO NOTHING;
\t\t\t\t\tRETURN NEW;
\t\t\t\tEND $b$;
\t\t\t$f$, t || '_register_entity', t);
\t\tELSE
\t\t\tEXECUTE format($f$
\t\t\t\tCREATE FUNCTION %I() RETURNS trigger LANGUAGE plpgsql AS $b$
\t\t\t\tBEGIN
\t\t\t\t\tINSERT INTO entity (id, kind) VALUES (NEW.id, %L)
\t\t\t\t\t\tON CONFLICT (id) DO NOTHING;
\t\t\t\t\tRETURN NEW;
\t\t\t\tEND $b$;
\t\t\t$f$, t || '_register_entity', t);
\t\tEND IF;
\t\tEXECUTE format(
\t\t\t'CREATE TRIGGER %I BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION %I()',
\t\t\tt || '_register_entity_trg', t, t || '_register_entity');

\t\tEXECUTE format($f$
\t\t\tCREATE FUNCTION %I() RETURNS trigger LANGUAGE plpgsql AS $b$
\t\t\tBEGIN
\t\t\t\tDELETE FROM entity WHERE id = OLD.id;
\t\t\t\tRETURN OLD;
\t\t\tEND $b$;
\t\t$f$, t || '_retire_entity');
\t\tEXECUTE format(
\t\t\t'CREATE TRIGGER %I AFTER DELETE ON %I FOR EACH ROW EXECUTE FUNCTION %I()',
\t\t\tt || '_retire_entity_trg', t, t || '_retire_entity');
\tEND LOOP;
END $outer$;
`;
