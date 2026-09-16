// SPDX-License-Identifier: AGPL-3.0-or-later
import { isCurrencyCode } from '$lib/money';
import { sql } from 'drizzle-orm';
import { db, type Queryable } from '$lib/server/db';
import {
	brokerOperation,
	brokerPosition,
	currencyRate,
	netWorthComponent,
	portfolioSnapshot,
	salaryEntry,
	settings,
	taxStatement,
	transaction
} from '$lib/server/db/schema';
import { loadRateTable, missingRateCodes } from './table';

// The Czech National Bank publishes a daily fixing of ~30 currencies against
// CZK — free, no API key. All rates are stored as CZK per one unit; rates
// between two non-CZK currencies are derived through CZK. The koruna is a
// pivot, not a home: a household whose base is the euro never sees it.
export const RATE_PIVOT = 'CZK';
/**
 * What the fixing quotes, as of the source's own list. A format fact about
 * the feed, used only before the first fetch has landed so an offline first
 * boot can still offer a real choice of base currency; after that the rate
 * table is the authority and a currency the bank adds appears on its own.
 */
export const SOURCE_QUOTES: readonly string[] = [
	'AUD',
	'BRL',
	'CAD',
	'CNY',
	'DKK',
	'EUR',
	'GBP',
	'HKD',
	'HUF',
	'IDR',
	'ILS',
	'INR',
	'ISK',
	'JPY',
	'KRW',
	'MXN',
	'MYR',
	'NOK',
	'NZD',
	'PHP',
	'PLN',
	'RON',
	'SEK',
	'SGD',
	'THB',
	'TRY',
	'USD',
	'ZAR'
];
const CNB_DAILY_URL =
	'https://www.cnb.cz/en/financial-markets/foreign-exchange-market/central-bank-exchange-rate-fixing/central-bank-exchange-rate-fixing/daily.txt';
// The same fixing, one file per calendar year, back to 1991. Also free and
// keyless; it is what lets a household's history convert at the rate of its
// own day rather than at the oldest one the app happened to fetch.
const CNB_YEAR_URL = (year: number) =>
	`https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/rok.txt?rok=${year}`;

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

/**
 * Parse one year of fixings. Exported for tests.
 *
 * `Datum|1 AUD|100 HUF|…` then `02.01.2024|15,278|6,460|…`: the amount each
 * column is quoted per lives in the header, the day in the first cell.
 */
export function parseCnbYear(text: string): CnbRate[] {
	const lines = text.trim().split(/\r?\n/);
	const head = lines[0]?.split('|') ?? [];
	const columns = head.slice(1).map((cell) => {
		const m = cell.trim().match(/^(\d+)\s+([A-Z]{3})$/);
		return m ? { amount: Number(m[1]), code: m[2] } : null;
	});
	const rates: CnbRate[] = [];
	for (const line of lines.slice(1)) {
		const cells = line.split('|');
		const dm = cells[0]?.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
		if (!dm) continue;
		const day = `${dm[3]}-${dm[2]}-${dm[1]}`;
		columns.forEach((column, i) => {
			if (!column) return;
			const rate = Number((cells[i + 1] ?? '').trim().replace(',', '.'));
			if (!Number.isFinite(rate) || rate <= 0) return;
			rates.push({ code: column.code, rate: rate / column.amount, day });
		});
	}
	return rates;
}

/**
 * Which years still need their fixings fetched: every year from the earliest
 * amount on record to today whose stored fixings fall short of the trading
 * days it has had. A year with two stray rows — a daily fetch, a seed — is
 * not a year on record. Pure, for tests.
 */
export function yearsToBackfill(
	earliestUseYear: number | null,
	fixingsPerYear: ReadonlyMap<number, number>,
	today: string
): number[] {
	if (earliestUseYear === null) return [];
	const thisYear = Number(today.slice(0, 4));
	const dayOfYear = Math.floor((Date.parse(today) - Date.UTC(thisYear, 0, 1)) / 86_400_000);
	const out: number[] = [];
	for (let year = Math.max(earliestUseYear, CNB_FIRST_YEAR); year <= thisYear; year++) {
		const days = year === thisYear ? dayOfYear : 365;
		// Five trading days in seven, less holidays: a full year fixes ~250.
		// Anything under half of that is a year with holes, not a year.
		const expected = Math.floor((days * TRADING_DAYS_SHARE) / 2);
		if ((fixingsPerYear.get(year) ?? 0) < expected) out.push(year);
	}
	return out;
}

/** Trading days as a share of calendar days, before holidays. */
const TRADING_DAYS_SHARE = 5 / 7;

/** The first year the CNB publishes a fixing for. A format fact about the source. */
const CNB_FIRST_YEAR = 1991;

async function storeRates(rates: CnbRate[], handle: Queryable): Promise<number> {
	const known = rates.filter((r) => isCurrencyCode(r.code));
	if (known.length === 0) return 0;
	// One statement per year file rather than one per fixing: a year is ~7 500
	// rows, and this runs once per year of history.
	for (let at = 0; at < known.length; at += 1000) {
		await handle
			.insert(currencyRate)
			.values(
				known.slice(at, at + 1000).map((r) => ({ code: r.code, day: r.day, rate: String(r.rate) }))
			)
			.onConflictDoNothing();
	}
	return known.length;
}

/**
 * Fetch the fixings for every year the household has amounts in and no rate
 * for. A fresh install with three years of statements converts each of them
 * at its own day's rate from the first boot rather than the install date.
 */
export async function backfillRates(
	fetchFn: typeof fetch = fetch,
	handle: Queryable = db
): Promise<number[]> {
	const today = new Date().toISOString().slice(0, 10);
	const [earliest, stored] = await Promise.all([
		earliestCurrencyUse(handle),
		handle.execute(
			sql`select extract(year from day)::int as year, count(distinct day)::int as days from ${currencyRate} group by 1`
		)
	]);
	const fixingsPerYear = new Map(
		(stored as unknown as { year: number; days: number }[]).map((r) => [
			Number(r.year),
			Number(r.days)
		])
	);
	const earliestYear = earliest ? Number(earliest.slice(0, 4)) : null;
	const done: number[] = [];
	for (const year of yearsToBackfill(earliestYear, fixingsPerYear, today)) {
		const res = await fetchFn(CNB_YEAR_URL(year));
		if (!res.ok) {
			console.warn(`FX: year ${year} fetch failed: ${res.status}`);
			continue;
		}
		await storeRates(parseCnbYear(await res.text()), handle);
		done.push(year);
	}
	return done;
}

/** Fetch today's fixing and upsert it. Safe to call often; upserts are cheap. */
export async function refreshRates(fetchFn: typeof fetch = fetch): Promise<number> {
	const res = await fetchFn(CNB_DAILY_URL);
	if (!res.ok) throw new Error(`CNB fixing fetch failed: ${res.status}`);
	const rates = parseCnbDaily(await res.text());
	// `currency_rate.code` carries a foreign key into `currency`, so a code the
	// runtime does not recognise would abort the whole refresh rather than cost
	// one rate. Skipped here instead.
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

/** The earliest day any amount in any currency is dated, or null on an empty ledger. */
export async function earliestCurrencyUse(handle: Queryable = db): Promise<string | null> {
	const rows = await currencyUses(handle);
	return rows.reduce<string | null>((min, r) => (min === null || r.day < min ? r.day : min), null);
}

export async function missingRateCurrencies(
	baseCurrency: string,
	handle: Queryable = db
): Promise<import('./table').ApproximateRates> {
	const rows = await currencyUses(handle);
	const rates = await loadRateTable(handle);
	return missingRateCodes(rates, rows, baseCurrency);
}

/** Every currency the household has an amount in, with the earliest day it is used. */
export async function currencyUses(
	handle: Queryable
): Promise<{ currency: string; day: string }[]> {
	// Valued things come from `net_worth_component` rather than being listed one
	// table at a time, so an asset type added to that view is covered here
	// without a second edit. Rates carry forward after their first fixing, so
	// the earliest use of each currency is sufficient to prove whether any
	// historical fallback occurred. Kept in Postgres rather than returning the
	// whole ledger on every app-layout load.
	const rows = (await handle.execute(sql`
		select currency, min(day)::text as day from (
			select currency, coalesce(valued_on, current_date) as day from ${netWorthComponent}
			union all select currency, coalesce(value_on, booked_on) as day from ${transaction}
			union all select currency, day from ${portfolioSnapshot}
			-- Salary comes off the ENTRY, not the payslip document: the figure and its
			-- currency belong to the month. period_month has no CHECK constraint, so
			-- guard the cast against a malformed value instead of failing the whole scan.
			union all select ${salaryEntry.currency},
				(${salaryEntry.periodMonth} || '-01')::date
			from ${salaryEntry}
			where ${salaryEntry.periodMonth} ~ '^\\d{4}-\\d{2}$'
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
	return rows;
}
