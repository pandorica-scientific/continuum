// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * People and companies outside the household.
 */

import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// The household's address book: tenants, tradespeople, bank contacts. Replaces
// tenancy.tenantContact, which was one free-text string with no structure and
// nowhere to put a second number.
export const contact = pgTable('contact', {
	id: uuid('id').primaryKey(),
	name: text('name').notNull(),
	// A stored upload name from saveUpload(), served through /files/[name] —
	// the same convention property photos use. Never a path or a URL.
	photo: text('photo'),
	// organisation and jobTitle are kept apart rather than as one "work" string:
	// that is the vCard ORG/TITLE split, so a later CardDAV export is a mapping
	// rather than a migration, and "everyone at Česká spořitelna" stays askable.
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
 * "rehor" must find "Řehoř", "lodz" must find "Łódź". Without this an address
 * book for a Czech and Polish household only answers to input nobody can type
 * quickly.
 *
 * The fold has to be identical on both sides. A term folded in TypeScript and
 * compared against text folded differently in SQL matches nothing, and it fails
 * silently — as "no results", never as an error. `src/lib/contacts/search.ts`
 * owns the canonical definition; `tests/unit/contacts.test.ts` pins this SQL
 * against it.
 *
 * WHY A WRAPPER FUNCTION RATHER THAN unaccent() INLINE:
 * unaccent(text) is STABLE, not IMMUTABLE, because it resolves the default
 * dictionary at run time. PostgreSQL refuses a STABLE expression in an index,
 * so indexing unaccent(name) directly fails outright. The two-argument form
 * unaccent(regdictionary, text) IS immutable — naming the dictionary is what
 * makes it so — and wrapping that lets the expression be indexed.
 *
 * translate() covers the stroked letters unaccent cannot: Ł and Đ are single
 * code points with no combining accent to remove, so NFD-style stripping leaves
 * them alone. The from/to pairs mirror STROKED in search.ts.
 *
 * TWO NON-OBVIOUS REQUIREMENTS, BOTH LEARNED BY THE MIGRATION FAILING:
 *
 * 1. The ::regdictionary cast. A bare 'unaccent' literal arrives as type
 *    `unknown`, PostgreSQL cannot choose between the one- and two-argument
 *    overloads, and CREATE FUNCTION fails with
 *    "function unaccent(unknown, text) does not exist".
 *
 * 2. Both names are schema-qualified. PostgreSQL builds an index expression
 *    under a restricted search_path that excludes `public` (the hardening from
 *    CVE-2018-1058), so an unqualified reference resolves fine when the function
 *    is created and then fails when the INDEX is built, with "text search
 *    dictionary unaccent does not exist". The function looked correct in
 *    isolation; only the index build proved otherwise.
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
