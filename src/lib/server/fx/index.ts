import { isCurrencyCode } from '$lib/money';
import { sql } from 'drizzle-orm';
import { db, type Queryable } from '$lib/server/db';
import {
	brokerOperation,
	brokerPosition,
	currencyRate,
	document as storedDocument,
	netWorthComponent,
	portfolioSnapshot,
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

interface CnbRate {
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
	// `currency_rate.code` carries a foreign key into `currency`, so a code the
	// runtime does not recognise would abort the whole refresh rather than cost
	// one rate. Skipped here instead, which is also the older bug's fix: an
	// unchecked code from the feed became selectable through
	// `availableCurrencies`, which is how a column heading once offered itself
	// as a currency.
	const known = rates.filter((r) => isCurrencyCode(r.code));
	for (const r of known) {
		await db
			.insert(currencyRate)
			.values({ code: r.code, day: r.day, rate: String(r.rate) })
			.onConflictDoNothing();
	}
	if (known.length !== rates.length) {
		const dropped = rates.filter((r) => !isCurrencyCode(r.code)).map((r) => r.code);
		console.warn(`FX: ignored ${dropped.length} unrecognised code(s): ${dropped.join(', ')}`);
	}
	return known.length;
}

/**
 * Convert an amount in minor units between currencies at the day's rate.
 * Returns null when no rate is known yet (e.g. before the first fetch).
 */
async function convertMinor(
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
): Promise<import('./table').ApproximateRates> {
	// Everything that carries an amount in a currency of its own. Property and the
	// portfolio snapshot were missing, which are the two largest figures on the
	// net-worth screen — so a flat valued in EUR with no EUR rate was counted at
	// face value, roughly 25x understated, while the banner raised to say exactly
	// that stayed silent.
	// The valued things come from `net_worth_component` rather than being listed
	// one table at a time, so an asset type added to that view is covered here
	// without a second edit — which is the only way the banner stays honest.
	// Rates carry forward after their first fixing, so the earliest use of each
	// currency is sufficient to prove whether any historical fallback occurred.
	// Keep that aggregation in Postgres instead of returning the whole ledger on
	// every app-layout load.
	const rows = (await handle.execute(sql`
		select currency, min(day)::text as day from (
			select currency, coalesce(valued_on, current_date) as day from ${netWorthComponent}
			union all select currency, coalesce(value_on, booked_on) as day from ${transaction}
			union all select currency, day from ${portfolioSnapshot}
			union all select ${storedDocument.currency},
				-- The month the document covers when it names one, else the day it was
				-- filed. This used to test a 'YYYY-MM' string against a regex and cast
				-- it, which silently skipped any value written another way; period_on
				-- is a real date since 0052 and needs neither.
				coalesce(${storedDocument.periodOn}, ${storedDocument.addedOn})
			from ${storedDocument}
			where ${storedDocument.currency} is not null
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
