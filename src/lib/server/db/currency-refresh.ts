// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { sql } from 'drizzle-orm';
import { minorDigits } from '$lib/money';
import { currency } from './schema';
import type { Queryable } from './index';

/**
 * Materialise CLDR's currency list into the `currency` table.
 *
 * The table exists so currency columns can carry a real foreign key. It is NOT
 * a source of truth about currencies: `$lib/money` is, and it reads the
 * runtime's own CLDR data. Seeding ISO 4217 by hand would create a second
 * answer free to drift from the first, and the two genuinely disagree — ISO
 * gives HUF two decimal places where CLDR gives zero, and CLDR is how the
 * currency is actually written. `minorDigits` already made that choice; this
 * follows it rather than voting again.
 *
 * UPSERT ONLY, never DELETE. A code that disappears from a future runtime's
 * data must not take every row referencing it down with it — a transaction
 * denominated in a currency ICU stopped listing is still a transaction that
 * happened.
 */
export async function refreshCurrencies(handle: Queryable): Promise<number> {
	const codes =
		typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('currency') : [];
	// An older runtime without `supportedValuesOf` leaves the table alone rather
	// than emptying it. `isCurrencyCode` degrades the same way, for the same
	// reason: no data is not the same as no currencies.
	if (codes.length === 0) return 0;

	const names = new Intl.DisplayNames(['en'], { type: 'currency' });
	const rows = codes.map((code) => ({
		code,
		exponent: minorDigits(code),
		name: names.of(code) ?? code
	}));

	// One statement. A per-row round trip over 160 currencies on every boot is
	// time a Raspberry Pi does not have to spare.
	await handle
		.insert(currency)
		.values(rows)
		.onConflictDoUpdate({
			target: currency.code,
			set: { exponent: sql`excluded.exponent`, name: sql`excluded.name` }
		});

	return rows.length;
}
