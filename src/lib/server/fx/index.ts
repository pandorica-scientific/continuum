import { sql } from 'drizzle-orm';
import { db, type Queryable } from '$lib/server/db';
import {
	account,
	brokerOperation,
	brokerPosition,
	currencyRate,
	document as storedDocument,
	holding,
	loan,
	portfolioSnapshot,
	property,
	settings,
	taxStatement,
	transaction
} from '$lib/server/db/schema';
import { convertMinorSync, faceValueMinor, loadRateTable, missingRateCodes } from './table';

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
	return convertMinorSync(await loadRateTable(), amountMinor, from, to, day);
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
	return (await convertMinor(amountMinor, from, to, day)) ?? faceValueMinor(amountMinor, from, to);
}

/**
 * Currencies this household actually holds money in that have no exchange rate,
 * so their amounts appear at face value in every converted total. The app
 * layout names them in a banner: a missing rate has to be visible, because
 * every total that silently absorbs one is wrong by the size of the rate.
 */
export async function missingRateCurrencies(
	baseCurrency: string,
	handle: Queryable = db
): Promise<string[]> {
	// Every table computeNetWorth converts from. Property and the portfolio
	// snapshot were missing, which are the two largest figures on the net-worth
	// screen — so a flat valued in EUR with no EUR rate was counted at face
	// value, roughly 25x understated, while the banner raised to say exactly
	// that stayed silent.
	// Rates carry forward after their first fixing, so the earliest use of each
	// currency is sufficient to prove whether any historical fallback occurred.
	// Keep that aggregation in Postgres instead of returning the whole ledger on
	// every app-layout load.
	const rows = (await handle.execute(sql`
		select currency, min(day)::text as day from (
			select currency, coalesce(balance_as_of, current_date) as day from ${account}
			union all select currency, coalesce(value_date, booked_at) as day from ${transaction}
			union all select currency, coalesce(owed_as_of, current_date) as day from ${loan}
			union all select currency, as_of::date as day from ${holding}
			union all select currency, coalesce(valued_at, current_date) as day from ${property}
			union all select currency, day from ${portfolioSnapshot}
			union all select ${storedDocument.amountCurrency},
				case
					when ${storedDocument.periodMonth} ~ '^\\d{4}-\\d{2}$'
						then (${storedDocument.periodMonth} || '-01')::date
					else ${storedDocument.addedOn}
				end
			from ${storedDocument}
			where ${storedDocument.amountCurrency} is not null
				and ${storedDocument.amountMinor} is not null
			union all select currency, happened_at::date from ${brokerOperation}
			union all select currency, opened_at::date from ${brokerPosition}
			union all select currency, make_date(year, 1, 1) from ${taxStatement}
			union all select value->>'pricePerKwhCurrency', current_date
			from ${settings}
			where key = 'home' and coalesce(value->>'pricePerKwhCurrency', '') <> ''
		) used
		where currency is not null
		group by currency
	`)) as unknown as { currency: string; day: string }[];

	const rates = await loadRateTable(handle);
	return missingRateCodes(rates, rows, baseCurrency);
}
