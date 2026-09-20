// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Annual tax statements and the lines that make them up.
 */

import {
	bigint,
	boolean,
	date,
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
// Relative, not aliased: drizzle-kit loads these files outside Vite and
// does not resolve SvelteKit's $lib.
import type { EnumValue } from '../../../enums';

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
		// Which return this is: the one owed because they LIVED here, or the one
		// this country wanted because income arose in it. It is what lets a filed
		// statement prove residence, so it is deliberately NOT defaulted — an
		// unclassified statement proves nothing, and that is the honest state for
		// every row filed before this column existed.
		role: text('role').$type<EnumValue<'tax_statement.role'>>(),
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
 * Where a person says they were tax-resident, when nothing filed says it.
 *
 * Residence is what makes a return owed at all: income decides the amount and
 * whether a second country wants one of its own, but a year with no work, no
 * investments and no rent still owes one where the person lived, filed as a nil
 * return. Deriving obligations from income alone makes exactly that year
 * invisible, which is why this exists.
 *
 * A HAND CORRECTION, like `tax_filing_override` beside it, and it holds only
 * what the derivation cannot reach. `residenceForYear` in `$lib/tax-residence`
 * resolves a year through four tiers — a row here, then a statement marked
 * `role = 'residence'`, then the countries worked in, then citizenship — and
 * the first three are all read from tables that already exist. Nothing derived
 * is stored, so nothing here can go stale against the paper.
 *
 * TWO ROWS ARE A MOVE. `from_on` and `to_on` are null for a whole year and set
 * for the halves of a year somebody moved in — and both halves owe a return,
 * because the move date splits the year rather than choosing a winner between
 * two countries. That is the one thing a derivation cannot work out and a
 * person can state in one gesture.
 *
 * Deliberately per YEAR rather than a continuous residence timeline: residence
 * is proved a year at a time, and a period spanning five years would prove all
 * five from one piece of evidence. Nothing carries forward — see the module
 * note in `$lib/tax-residence`, where the absence of a previous-year parameter
 * is the enforcement.
 */
export const taxResidence = pgTable(
	'tax_residence',
	{
		id: uuid('id').primaryKey(),
		personId: uuid('person_id')
			.notNull()
			.references(() => person.id, { onDelete: 'cascade' }),
		year: integer('year').notNull(),
		/** ISO 3166-1 alpha-2, upper case; the shape is a CHECK in the appendix. */
		country: text('country').notNull(),
		/** Inclusive. Null means "from the start of the year". */
		fromOn: date('from_on'),
		/** Inclusive. Null means "to the end of the year". */
		toOn: date('to_on'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	// One row per person, year and country — a second country in the same year is
	// the move, a second row for the SAME country is a duplicate. The composite
	// leads with person_id, which is what covers the foreign key; `tax_statement`
	// beside it is indexed the same way for the same reason.
	(table) => [uniqueIndex('tax_residence_unique_idx').on(table.personId, table.year, table.country)]
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
-- The same two letters, for the same reason: a declared residence and the
-- paper that would prove it have to fold to one spelling or they never meet.
ALTER TABLE tax_residence ADD CONSTRAINT tax_residence_country_check
	CHECK (country ~ '^[A-Z]{2}$');
--> statement-breakpoint
-- A period that ends before it starts is not a half-year, it is a typo, and
-- it would silently contribute no residence to the year it claims to cover.
ALTER TABLE tax_residence ADD CONSTRAINT tax_residence_period_check
	CHECK (from_on IS NULL OR to_on IS NULL OR from_on <= to_on);
--> statement-breakpoint
-- NULLS NOT DISTINCT, because person_id IS NULL is the card ITSELF and there is
-- exactly one of those per year and country. Postgres treats nulls as distinct by
-- default, which would let one card be both added and dismissed at once, and would
-- make the upsert that writes these rows insert a second one instead of flipping
-- the first.
CREATE UNIQUE INDEX tax_filing_override_unique_idx
	ON tax_filing_override (year, country, person_id) NULLS NOT DISTINCT;
`;
