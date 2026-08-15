import { and, desc, eq, lte, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	account,
	currencyRate,
	holding,
	loan,
	portfolioSnapshot,
	property,
	transaction
} from '$lib/server/db/schema';
import { minorDigits } from '$lib/money';

// The Czech National Bank publishes a daily fixing of ~30 currencies against
// CZK — free, no API key. All rates are stored as CZK per one unit; rates
// between two non-CZK currencies are derived through CZK.
const CNB_DAILY_URL =
	'https://www.cnb.cz/en/financial-markets/foreign-exchange-market/central-bank-exchange-rate-fixing/central-bank-exchange-rate-fixing/daily.txt';

export interface CnbRate {
	code: string;
	/** CZK per one unit of `code`. */
	rate: number;
	day: string; // ISO date
}

/** Parse the CNB daily fixing text format. Exported for tests. */
export function parseCnbDaily(text: string): CnbRate[] {
	const lines = text.trim().split('\n');
	// Header line: "12 Aug 2026 #155" (en) or "12.08.2026 #155" (cs)
	const headerMatch = lines[0]?.match(/(\d{1,2})[ .](\w{3}|\d{2})[ .](\d{4})/);
	let day = new Date().toISOString().slice(0, 10);
	if (headerMatch) {
		const [, d, m, y] = headerMatch;
		const monthNames = [
			'Jan',
			'Feb',
			'Mar',
			'Apr',
			'May',
			'Jun',
			'Jul',
			'Aug',
			'Sep',
			'Oct',
			'Nov',
			'Dec'
		];
		const month = /^\d+$/.test(m) ? Number(m) : monthNames.indexOf(m) + 1;
		day = `${y}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
	}
	const rates: CnbRate[] = [];
	for (const line of lines.slice(2)) {
		// Country|Currency|Amount|Code|Rate
		const parts = line.split('|');
		if (parts.length < 5) continue;
		const amount = Number(parts[2].replace(',', '.'));
		const rate = Number(parts[4].replace(',', '.'));
		const code = parts[3].trim().toUpperCase();
		if (!code || !Number.isFinite(amount) || !Number.isFinite(rate) || amount <= 0) continue;
		rates.push({ code, rate: rate / amount, day });
	}
	return rates;
}

/** Fetch today's fixing and upsert it. Safe to call often; upserts are cheap. */
export async function refreshRates(fetchFn: typeof fetch = fetch): Promise<number> {
	const res = await fetchFn(CNB_DAILY_URL);
	if (!res.ok) throw new Error(`CNB fixing fetch failed: ${res.status}`);
	const rates = parseCnbDaily(await res.text());
	for (const r of rates) {
		await db
			.insert(currencyRate)
			.values({ code: r.code, day: r.day, rate: String(r.rate) })
			.onConflictDoNothing();
	}
	return rates.length;
}

/** CZK per one unit of `code` on the newest day at or before `day`. */
async function czkPerUnit(code: string, day: string): Promise<number | null> {
	if (code === 'CZK') return 1;
	const rows = await db
		.select()
		.from(currencyRate)
		.where(and(eq(currencyRate.code, code), lte(currencyRate.day, day)))
		.orderBy(desc(currencyRate.day))
		.limit(1);
	return rows[0] ? Number(rows[0].rate) : null;
}

/**
 * Convert an amount in minor units between currencies at the day's rate.
 * Returns null when no rate is known yet (e.g. before the first fetch).
 */
export async function convertMinor(
	amountMinor: bigint,
	from: string,
	to: string,
	day: string = new Date().toISOString().slice(0, 10)
): Promise<bigint | null> {
	if (from === to) return amountMinor;
	const [fromCzk, toCzk] = await Promise.all([czkPerUnit(from, day), czkPerUnit(to, day)]);
	if (fromCzk === null || toCzk === null) return null;
	// The result is in the target's minor units, and not every currency has two
	// of them: 1000 JPY is amountMinor 1000, the same value in CZK is 15000.
	const scale = 10 ** (minorDigits(to) - minorDigits(from));
	return BigInt(Math.round(Number(amountMinor) * (fromCzk / toCzk) * scale));
}

/**
 * Convert, or fall back to the amount's face value when no rate is known.
 * The async twin of `convertOrFace` in ./table — see its comment for why a
 * null rate must never be coalesced into an identity conversion.
 */
export async function convertOrFace(
	amountMinor: bigint,
	from: string,
	to: string,
	day?: string
): Promise<bigint> {
	return (await convertMinor(amountMinor, from, to, day)) ?? amountMinor;
}

/**
 * Currencies this household actually holds money in that have no exchange rate,
 * so their amounts appear at face value in every converted total. The app
 * layout names them in a banner: a missing rate has to be visible, because
 * every total that silently absorbs one is wrong by the size of the rate.
 */
export async function missingRateCurrencies(baseCurrency: string): Promise<string[]> {
	// Every table computeNetWorth converts from. Property and the portfolio
	// snapshot were missing, which are the two largest figures on the net-worth
	// screen — so a flat valued in EUR with no EUR rate was counted at face
	// value, roughly 25x understated, while the banner raised to say exactly
	// that stayed silent.
	const rows = (await db.execute(sql`
		select distinct currency as code from (
			select currency from ${account}
			union all select currency from ${transaction}
			union all select currency from ${loan}
			union all select currency from ${holding}
			union all select currency from ${property}
			union all select currency from ${portfolioSnapshot}
		) used
	`)) as unknown as { code: string }[];

	const today = new Date().toISOString().slice(0, 10);
	const codes = [...new Set(rows.map((r) => r.code))].filter((c) => c && c !== baseCurrency);

	// Every conversion goes through CZK, so a base currency with no rate of its
	// own makes all of them fail, not just the exotic ones.
	if ((await czkPerUnit(baseCurrency, today)) === null) return codes.sort();

	// One round trip per currency, not one after another: this runs on every
	// page under (app), hover preloads included.
	const rates = await Promise.all(codes.map((code) => czkPerUnit(code, today)));
	return codes.filter((_, i) => rates[i] === null).sort();
}
