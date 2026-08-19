// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/**
 * Currencies and their exchange rates: what every `*_minor` column is denominated in.
 */

import { date, integer, numeric, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';

/**
 * Every currency a code may name, materialised from CLDR at boot by
 * `refreshCurrencies` — never seeded by hand.
 *
 * Present so the fourteen currency columns can carry a real foreign key.
 * `$lib/money` remains the source of truth about currencies; a hand-written ISO
 * 4217 list here would be a second answer free to drift from it, and the two
 * disagree about real currencies (ISO gives HUF two decimal places, CLDR gives
 * zero, and CLDR is how it is written).
 */
export const currency = pgTable('currency', {
	code: text('code').primaryKey(),
	/** Decimal places, from `minorDigits`: 0 for JPY, 2 for EUR, 3 for KWD. */
	exponent: integer('exponent').notNull(),
	name: text('name').notNull()
});

// One row per currency and day: how many base-currency minor units one unit of
// `code` was worth. Only screen-level totals ever use this.
export const currencyRate = pgTable(
	'currency_rate',
	{
		code: text('code')
			.notNull()
			.references(() => currency.code),
		day: date('day').notNull(),
		// rate as a decimal string, e.g. 24.905 CZK per 1 EUR
		rate: numeric('rate', { precision: 14, scale: 6 }).notNull()
	},
	(table) => [primaryKey({ columns: [table.code, table.day] })]
);
