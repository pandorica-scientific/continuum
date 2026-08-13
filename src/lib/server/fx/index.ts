import { and, desc, eq, lte } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { currencyRate } from '$lib/server/db/schema';

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
	const factor = fromCzk / toCzk;
	return BigInt(Math.round(Number(amountMinor) * factor));
}
