// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/**
 * Annual tax statements and the lines that make them up.
 */

import {
	bigint,
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
