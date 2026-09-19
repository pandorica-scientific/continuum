// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Annual tax statements and the lines that make them up.
 */

import {
	bigint,
	boolean,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';
import { person } from './auth';
import { currency } from './money';

// What a yearly tax statement said, per person per country. Nothing here is
// computed: no brackets, no allowances, no residency. The two canonical figures
// exist in every country, so the charts always have something to draw; anything
// a particular country itemises separately is a labelled line.
export const taxStatement = pgTable(
	'tax_statement',
	{
		id: uuid('id').primaryKey(),
		personId: uuid('person_id')
			.notNull()
			.references(() => person.id, { onDelete: 'cascade' }),
		year: integer('year').notNull(),
		// free text on purpose — a validated country list would need maintaining
		country: text('country').notNull(),
		// the statement's own currency, so a series never mixes currencies
		currency: text('currency')
			.notNull()
			.references(() => currency.code),
		grossIncomeMinor: bigint('gross_income_minor', { mode: 'bigint' }).notNull(),
		taxPaidMinor: bigint('tax_paid_minor', { mode: 'bigint' }).notNull(),
		// No document column here, deliberately. A statement's papers hang off its
		// `entity` row through `document_link` — the statement itself, the
		// employer's income confirmation, the broker's report — and a "primary"
		// attachment beside those links was two sources of truth for one fact.
		note: text('note'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('tax_statement_currency_idx').on(table.currency),
		uniqueIndex('tax_statement_unique_idx').on(table.personId, table.year, table.country)
	]
);

export const taxStatementLine = pgTable(
	'tax_statement_line',
	{
		id: uuid('id').primaryKey(),
		statementId: uuid('statement_id')
			.notNull()
			.references(() => taxStatement.id, { onDelete: 'cascade' }),
		label: text('label').notNull(),
		amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
		sort: integer('sort').notNull().default(0)
	},
	(table) => [index('tax_statement_line_statement_idx').on(table.statementId)]
);

/**
 * A hand correction to which tax filings are expected.
 *
 * The tax year cards are DRAWN — from when people were employed, and from the
 * countries the household has already filed in — so this table holds only what
 * the derivation gets wrong. The same relationship `shelf_type` has with the
 * shelf profiles: a seed the household may overrule, never a second copy of the
 * answer.
 *
 * Four meanings, one table:
 *
 *     person_id NULL, expected true   this year and country exist anyway
 *     person_id NULL, expected false  hide this card; we do not file here
 *     person_id set,  expected true   this person is on that return without
 *                                     having earned anything that year
 *     person_id set,  expected false  this person is not on that return
 *
 * A row is not a filing and holds no figures. What a return SAID lives on
 * `tax_statement`, which is keyed the same way and is untouched by this — and
 * which could not serve here, since its two figures are NOT NULL and a year
 * nobody has filed yet has no figures to give.
 */
export const taxFilingOverride = pgTable(
	'tax_filing_override',
	{
		id: uuid('id').primaryKey(),
		year: integer('year').notNull(),
		/** ISO 3166-1 alpha-2, upper case; the shape is a CHECK in the appendix. */
		country: text('country').notNull(),
		/** Null for the card itself rather than for one person on it. */
		personId: uuid('person_id').references(() => person.id, { onDelete: 'cascade' }),
		expected: boolean('expected').notNull()
	},
	// Every foreign key carries its own covering index — `schema-invariants`
	// holds us to it. The unique index is in the appendix: drizzle-kit cannot
	// write NULLS NOT DISTINCT, and without it the card-level row is not unique.
	(table) => [index('tax_filing_override_person_idx').on(table.personId)]
);

/** Shapes a CHECK and a null-sensitive unique index can state, and Drizzle cannot. */
export const taxCheckSql = `
-- Two upper-case letters, matching document.country and document_identity.country:
-- one folding rule has to serve all three, or a card and its paper stop matching.
ALTER TABLE tax_filing_override ADD CONSTRAINT tax_filing_override_country_check
	CHECK (country ~ '^[A-Z]{2}$');
--> statement-breakpoint
-- NULLS NOT DISTINCT, because person_id IS NULL is the card ITSELF and there is
-- exactly one of those per year and country. Postgres treats nulls as distinct by
-- default, which would let one card be both added and dismissed at once, and would
-- make the upsert that writes these rows insert a second one instead of flipping
-- the first.
CREATE UNIQUE INDEX tax_filing_override_unique_idx
	ON tax_filing_override (year, country, person_id) NULLS NOT DISTINCT;
`;
