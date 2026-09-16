// SPDX-License-Identifier: AGPL-3.0-or-later
import { db, type Queryable } from '$lib/server/db';
import { currencyRate } from '$lib/server/db/schema';
import { minorDigits } from '$lib/money';

/** All known rates, newest first per code: code → [{day, czkPerUnit}]. */
export type RateTable = Map<string, { day: string; rate: number }[]>;

interface CurrencyUse {
	currency: string;
	day: string;
}

export async function loadRateTable(handle: Queryable = db): Promise<RateTable> {
	const rows = await handle.select().from(currencyRate);
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

/**
 * How well a rate is known for one day: an actual fixing at or before it, the
 * oldest fixing on record carried backwards, or nothing at all.
 */
type RateBasis = 'exact' | 'carried' | 'none';

function rateAt(table: RateTable, code: string, day: string): { rate: number; basis: RateBasis } {
	if (code === 'CZK') return { rate: 1, basis: 'exact' };
	const list = table.get(code);
	if (!list || list.length === 0) return { rate: 0, basis: 'none' };
	const hit = list.find((r) => r.day <= day);
	if (hit) return { rate: hit.rate, basis: 'exact' };
	// A day before this installation's first fetch can never gain a rate of its
	// own. The oldest rate on record is stale but the right order of magnitude
	// (better than face value reading 10 000 EUR as 10 000 CZK), and keeps
	// cross-currency transfer pairing working. `basis` labels the approximation.
	return { rate: list[list.length - 1].rate, basis: 'carried' };
}

function weakerBasis(a: RateBasis, b: RateBasis): RateBasis {
	if (a === 'none' || b === 'none') return 'none';
	return a === 'carried' || b === 'carried' ? 'carried' : 'exact';
}

/** How well the pair of rates behind one conversion is known. */
export function conversionBasis(
	table: RateTable,
	from: string,
	to: string,
	day: string
): RateBasis {
	if (from === to) return 'exact';
	return weakerBasis(rateAt(table, from, day).basis, rateAt(table, to, day).basis);
}

/**
 * Preserve the numeric major-unit face value when no FX rate is available.
 * This is deliberately not a currency conversion; callers label the result as
 * unconverted. Scaling stays in bigint and rounds halves away from zero when
 * the target currency stores fewer fractional digits.
 */
function faceValueMinor(amountMinor: bigint, from: string, to: string): bigint {
	const shift = minorDigits(to) - minorDigits(from);
	if (shift === 0) return amountMinor;
	if (shift > 0) return amountMinor * 10n ** BigInt(shift);

	const divisor = 10n ** BigInt(-shift);
	const quotient = amountMinor / divisor;
	const remainder = amountMinor % divisor;
	if ((remainder < 0n ? -remainder : remainder) * 2n < divisor) return quotient;
	return quotient + (amountMinor < 0n ? -1n : 1n);
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
	const fromRate = rateAt(table, from, day);
	const toRate = rateAt(table, to, day);
	if (fromRate.basis === 'none' || toRate.basis === 'none') return null;
	const fromCzk = fromRate.rate;
	const toCzk = toRate.rate;
	// The result is in the target's minor units, and not every currency has two
	// of them: 1000 JPY is amountMinor 1000, the same value in CZK is 15000.
	const scale = 10 ** (minorDigits(to) - minorDigits(from));
	return BigInt(Math.round(Number(amountMinor) * (fromCzk / toCzk) * scale));
}

/**
 * Source currencies whose conversion is not backed by a real fixing on at
 * least one date where the app uses them — either carried back from a later
 * day or absent entirely, so the figure is approximate either way. Looking
 * only at today's fixing hides older totals that predate the first stored rate.
 */
export interface ApproximateRates {
	/** A rate exists, but this figure predates the first one on record. */
	carried: string[];
	/** No rate at all — the table has never been filled for this currency. */
	none: string[];
}

/**
 * Which currencies are being converted approximately, and WHY.
 *
 * The two reasons want different advice. `none` means the rate table has
 * nothing for that currency, usually a connectivity or refresh problem worth
 * acting on. `carried` means a rate exists but this figure predates the
 * earliest fixing on record — normal for any instance that imports history,
 * and not fixable by checking the internet.
 */
export function missingRateCodes(
	table: RateTable,
	uses: CurrencyUse[],
	baseCurrency: string
): ApproximateRates {
	const carried = new Set<string>();
	const none = new Set<string>();

	for (const use of uses) {
		if (!use.currency || use.currency === baseCurrency) continue;
		const basis = conversionBasis(table, use.currency, baseCurrency, use.day);
		if (basis === 'none') none.add(use.currency);
		else if (basis === 'carried') carried.add(use.currency);
	}

	// A currency with no rate at all is not also "carried": the stronger problem
	// wins, so it is reported once and with the advice that helps.
	for (const code of none) carried.delete(code);

	return { carried: [...carried].sort(), none: [...none].sort() };
}

/**
 * Convert, or fall back to the amount's face value when no rate is known.
 *
 * Face value is the least-bad arithmetic when a currency has no stored
 * fixing at all — dropping the amount would understate the total too — but
 * it must not be silent: `missingRateCurrencies` drives a banner naming every
 * currency shown this way. A day that merely predates the first fetch
 * converts at the carried rate instead, via `rateAt`.
 */
export function convertOrFace(
	table: RateTable,
	amountMinor: bigint,
	from: string,
	to: string,
	day: string
): bigint {
	return (
		convertMinorSync(table, amountMinor, from, to, day) ?? faceValueMinor(amountMinor, from, to)
	);
}
