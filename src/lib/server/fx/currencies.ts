import { sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { currencyRate } from '$lib/server/db/schema';
import { getBaseCurrency } from '$lib/server/settings';

// Currencies the household most likely wants on top, and the safety net for a
// fresh install that has not fetched rates yet (offline first boot).
const PREFERRED = ['CZK', 'EUR', 'USD', 'PLN'];

/**
 * Every currency the app can convert: whatever the rate source quotes, plus
 * the configured base. Derived, not hard-coded — a new currency in the CNB
 * fixing appears here automatically.
 */
export async function availableCurrencies(): Promise<string[]> {
	const [rows, base] = await Promise.all([
		db
			.selectDistinct({ code: currencyRate.code })
			.from(currencyRate)
			.orderBy(sql`code`),
		getBaseCurrency()
	]);
	const known = new Set([...PREFERRED, base, ...rows.map((r) => r.code)]);
	const rest = [...known].filter((c) => !PREFERRED.includes(c)).sort();
	return [...PREFERRED.filter((c) => known.has(c)), ...rest];
}
