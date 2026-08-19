// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/**
 * Filed paperwork, the subjects it is filed under, and the tags applied to it.
 */

import { sql } from 'drizzle-orm';
import {
	bigint,
	date,
	index,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';
// Relative, not aliased: drizzle-kit loads these files outside Vite and
// does not resolve SvelteKit's $lib.
import type { EnumValue } from '../../../enums';
import { currency } from './money';

// ---- Documents ----

export const document = pgTable(
	'document',
	{
		id: uuid('id').primaryKey(),
		name: text('name').notNull(),
		// payslips | tax | identity | family | property | tenancy | loans | insurance
		shelf: text('shelf').$type<EnumValue<'document.shelf'>>().notNull(),
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
		// money documents (payslips, bills) can carry the amount they are about
		// and the month they cover — the salary tracker derives from these
		amountMinor: bigint('amount_minor', { mode: 'bigint' }),
		currency: text('currency').references(() => currency.code),
		periodOn: date('period_on')
	},
	(table) => [
		index('document_currency_idx').on(table.currency),
		index('document_shelf_idx').on(table.shelf)
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
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	// "Car" and "car" are the same thing; two records differing only in case
	// would be the phantom-column problem sneaking back in.
	(table) => [uniqueIndex('subject_name_ci_idx').on(sql`lower(${table.name})`)]
);
