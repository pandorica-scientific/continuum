import { db } from '$lib/server/db';
import { currencyRate } from '$lib/server/db/schema';
import { minorDigits } from '$lib/money';

/** All known rates, newest first per code: code → [{day, czkPerUnit}]. */
export type RateTable = Map<string, { day: string; rate: number }[]>;

export async function loadRateTable(): Promise<RateTable> {
	const rows = await db.select().from(currencyRate);
	const table: RateTable = new Map();
	for (const row of rows) {
		if (!table.has(row.code)) table.set(row.code, []);
		table.get(row.code)!.push({ day: row.day, rate: Number(row.rate) });
	}
	for (const list of table.values()) {
		list.sort((a, b) => (a.day < b.day ? 1 : -1));
	}
	return table;
}

function czkPerUnit(table: RateTable, code: string, day: string): number | null {
	if (code === 'CZK') return 1;
	const list = table.get(code);
	if (!list) return null;
	const hit = list.find((r) => r.day <= day) ?? list[list.length - 1];
	return hit ? hit.rate : null;
}

/** Synchronous conversion over a preloaded table, for tight loops. */
export function convertMinorSync(
	table: RateTable,
	amountMinor: bigint,
	from: string,
	to: string,
	day: string
): bigint | null {
	if (from === to) return amountMinor;
	const fromCzk = czkPerUnit(table, from, day);
	const toCzk = czkPerUnit(table, to, day);
	if (fromCzk === null || toCzk === null) return null;
	// The result is in the target's minor units, and not every currency has two
	// of them: 1000 JPY is amountMinor 1000, the same value in CZK is 15000.
	const scale = 10 ** (minorDigits(to) - minorDigits(from));
	return BigInt(Math.round(Number(amountMinor) * (fromCzk / toCzk) * scale));
}

/**
 * Convert, or fall back to the amount's face value when no rate is known.
 *
 * `convertMinorSync` returns null for "no rate is known", and the `?? amount`
 * this replaces read that as "1:1" — so on an installation whose rate table is
 * still empty (the first CNB fetch is fire-and-forget and its failures are
 * swallowed by design) a 10 000 EUR movement counted as 100 CZK, understating
 * income and spending roughly 25-fold with nothing to show for it.
 *
 * Face value is still the least-bad arithmetic — dropping the amount would
 * understate the total too — but it must not be silent. `missingRateCurrencies`
 * drives a banner in the app layout that names every currency being shown this
 * way, so an unconverted figure is labelled rather than quietly wrong.
 */
export function convertOrFace(
	table: RateTable,
	amountMinor: bigint,
	from: string,
	to: string,
	day: string
): bigint {
	return convertMinorSync(table, amountMinor, from, to, day) ?? amountMinor;
}
