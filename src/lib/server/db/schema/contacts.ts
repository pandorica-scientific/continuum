// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * People and companies outside the household.
 */

import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// The household's address book: tenants, tradespeople, bank contacts.
export const contact = pgTable('contact', {
	id: uuid('id').primaryKey(),
	name: text('name').notNull(),
	// Stored upload name from saveUpload(), served through /files/[name]. Never a path or URL.
	photo: text('photo'),
	// organisation and jobTitle mirror the vCard ORG/TITLE split, so "everyone
	// at Česká spořitelna" stays askable and a later CardDAV export is a mapping.
	organisation: text('organisation'),
	jobTitle: text('job_title'),
	phone: text('phone'),
	email: text('email'),
	address: text('address'),
	notes: text('notes'),
	category: text('category'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

// ---- SQL drizzle-kit cannot model ----

/**
 * Folding diacritics, and the index that uses it.
 *
 * "rehor" must find "Řehoř", "lodz" must find "Łódź".
 *
 * The fold must be identical on both sides — a term folded in TypeScript vs.
 * text folded differently in SQL matches nothing, silently. `src/lib/contacts/search.ts`
 * owns the canonical definition; `tests/unit/contacts.test.ts` pins this SQL against it.
 *
 * A wrapper function is needed because unaccent(text) is STABLE, not IMMUTABLE
 * (it resolves the dictionary at run time), and PostgreSQL refuses a STABLE
 * expression in an index. The two-argument form unaccent(regdictionary, text)
 * is immutable, so wrapping that makes the expression indexable.
 *
 * translate() covers stroked letters unaccent cannot (Ł, Đ have no combining
 * accent to strip); the from/to pairs mirror STROKED in search.ts.
 *
 * Two non-obvious requirements: the ::regdictionary cast (a bare 'unaccent'
 * literal is `unknown` and PostgreSQL can't pick an overload), and both names
 * must be schema-qualified (search_path excludes `public` when building an
 * index expression, so an unqualified function resolves but the INDEX build fails).
 */
export const contactFoldSql = `
CREATE OR REPLACE FUNCTION contact_fold(value text) RETURNS text
	LANGUAGE sql
	IMMUTABLE
	STRICT
	PARALLEL SAFE
AS $$
	select lower(
		public.unaccent('public.unaccent'::regdictionary, translate(value, 'łđøħŧ', 'ldoht'))
	)
$$;
`;

/**
 * Name and organisation are the two fields people search by: a person, or
 * everyone at a company. Notes and address are deliberately excluded — folding
 * a free-text blob into the same index makes every contact match almost
 * anything, which reads as the search being broken.
 */
export const contactsSql = `
CREATE INDEX contact_search_idx ON contact USING gin (
	to_tsvector(
		'simple',
		contact_fold(coalesce(name, '') || ' ' || coalesce(organisation, ''))
	)
);
`;
