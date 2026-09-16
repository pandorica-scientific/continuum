// SPDX-License-Identifier: AGPL-3.0-or-later
import { sql } from 'drizzle-orm';
import { db, type Queryable } from '$lib/server/db';
import { currencyRate } from '$lib/server/db/schema';
import { getBaseCurrency } from '$lib/server/settings';
import { RATE_PIVOT, SOURCE_QUOTES, currencyUses } from './index';

/**
 * The order a currency picker lists what the app can convert.
 *
 * The household's base first, then the currencies it already holds money in,
 * then everything the rate source quotes, alphabetically. Derived from the
 * household and the source rather than a fixed list, so the app never
 * presumes what a household's currencies should be.
 */
export function orderCurrencies(
	base: string,
	inUse: readonly string[],
	quoted: readonly string[]
): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	const add = (code: string) => {
		if (code && !seen.has(code)) {
			seen.add(code);
			out.push(code);
		}
	};
	add(base);
	for (const code of [...inUse].sort()) add(code);
	for (const code of [...quoted].sort()) add(code);
	return out;
}

/**
 * Every currency the app can convert today: whatever the LATEST fixing
 * quotes, the pivot the rates are stored against, and the configured base.
 * Not every code the table has ever held — a currency the bank has since
 * withdrawn is one nobody should be offered for a new account, though
 * existing amounts still convert at the rates of their own day. Before the
 * first fetch lands, the source's known quote list stands in.
 */
export async function availableCurrencies(handle: Queryable = db): Promise<string[]> {
	const [rows, base, uses] = await Promise.all([
		handle
			.select({ code: currencyRate.code })
			.from(currencyRate)
			.where(sql`${currencyRate.day} = (select max(day) from ${currencyRate})`)
			.orderBy(sql`code`),
		getBaseCurrency(handle),
		currencyUses(handle)
	]);
	const quoted = rows.length > 0 ? rows.map((r) => r.code) : [...SOURCE_QUOTES];
	return orderCurrencies(
		base,
		uses.map((u) => u.currency),
		[RATE_PIVOT, ...quoted]
	);
}
