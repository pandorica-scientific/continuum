// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * One close a day for every ticker the household owns.
 *
 * Two owners of tickers: broker holdings (replaced by each report) and equity
 * grants (which outlive reports). Read fresh each run so a new grant is
 * priced without registering anywhere.
 *
 * Failures are per ticker — one bad symbol or a down feed must not stop the
 * others; screens show how old the price they display is.
 */
import { and, desc, eq, gte, inArray, isNull } from 'drizzle-orm';
import { db, type Queryable } from '$lib/server/db';
import { equityGrant, equityTranche, holding, securityPrice } from '$lib/server/db/schema';
import { isCurrencyCode, minorDigits } from '$lib/money';
import { priceProviders, type PriceProviderId, type Quote } from './adapter';
import { getPriceAliases, withAlias } from './settings';
import { STOOQ_SCALE_CURRENCY } from './stooq';
import './yahoo';
import './stooq';

export { isStale } from '$lib/prices';

export interface LatestPrice {
	day: string;
	closeMinor: bigint;
	currency: string;
}

/** Every ticker with something priced against it, with the currency its owner records it in. */
export async function pricedTickers(
	handle: Queryable = db
): Promise<{ ticker: string; currency: string }[]> {
	const [held, granted] = await Promise.all([
		handle.select({ ticker: holding.ticker, currency: holding.currency }).from(holding),
		handle
			.selectDistinct({ ticker: equityGrant.ticker, currency: equityGrant.currency })
			.from(equityGrant)
			.innerJoin(equityTranche, eq(equityTranche.grantId, equityGrant.id))
			.where(isNull(equityTranche.forfeitedOn))
	]);
	const seen = new Map<string, string>();
	for (const row of [...held, ...granted]) {
		const ticker = row.ticker.trim().toUpperCase();
		if (ticker && !seen.has(ticker)) seen.set(ticker, row.currency);
	}
	return [...seen].map(([ticker, currency]) => ({ ticker, currency }));
}

/**
 * A quote from a feed that did not say its currency is taken to be in the
 * owner's; re-scale when that currency has other minor digits than the scale
 * the feed was parsed at.
 */
function inOwnerCurrency(quote: Quote, ownerCurrency: string): Quote {
	if (quote.currency) return quote;
	const shift = minorDigits(ownerCurrency) - minorDigits(STOOQ_SCALE_CURRENCY);
	const closeMinor =
		shift >= 0 ? quote.closeMinor * 10n ** BigInt(shift) : quote.closeMinor / 10n ** BigInt(-shift);
	return { ...quote, currency: ownerCurrency, closeMinor };
}

/**
 * London quotes in pence: Yahoo says `GBp` and means one hundredth of a pound.
 * A format fact about that feed, not a rate.
 */
function inMajorCurrency(quote: Quote): Quote {
	if (quote.currency === 'GBp') {
		return { ...quote, currency: 'GBP', closeMinor: quote.closeMinor / 100n };
	}
	return quote;
}

export async function refreshPrices(
	fetchFn: typeof fetch = fetch,
	handle: Queryable = db
): Promise<{ fetched: number; skipped: string[] }> {
	const [tickers, aliases] = await Promise.all([pricedTickers(handle), getPriceAliases(handle)]);
	let fetched = 0;
	const skipped: string[] = [];
	for (const { ticker, currency } of tickers) {
		// The symbol asked FOR may differ from the ticker held: an alias swaps
		// only the base a feed does not recognise, keeping the market suffix
		// that already resolved correctly. Storage below still keys on the
		// original ticker — that is what `holding` and `equityGrant` carry.
		const asked = withAlias(ticker, aliases);
		let quote: Quote | null = null;
		let source: PriceProviderId | null = null;
		for (const provider of priceProviders()) {
			try {
				const got = await provider.fetchClose(asked, fetchFn);
				if (!got) continue;
				const usable = inMajorCurrency(inOwnerCurrency(got, currency));
				if (!isCurrencyCode(usable.currency)) {
					// Unconvertible currency is no close at all; try the next feed.
					console.warn(`prices: ${provider.id} quoted ${ticker} in ${usable.currency}`);
					continue;
				}
				quote = usable;
				source = provider.id;
				break;
			} catch (err) {
				console.warn(`prices: ${provider.id} failed for ${ticker}: ${(err as Error).message}`);
			}
		}
		if (!quote || !source) {
			skipped.push(ticker);
			continue;
		}
		// A hand-typed close for the same day stays: `on conflict do nothing`.
		await handle
			.insert(securityPrice)
			.values({
				ticker,
				day: quote.day,
				closeMinor: quote.closeMinor,
				currency: quote.currency,
				source
			})
			.onConflictDoNothing();
		fetched += 1;
	}
	if (skipped.length) console.warn(`prices: no close for ${skipped.join(', ')}`);
	return { fetched, skipped };
}

/** The newest close per ticker. */
export async function latestPrices(
	tickers: string[],
	handle: Queryable = db
): Promise<Map<string, LatestPrice>> {
	const out = new Map<string, LatestPrice>();
	if (tickers.length === 0) return out;
	const rows = await handle
		.select()
		.from(securityPrice)
		.where(inArray(securityPrice.ticker, tickers))
		.orderBy(securityPrice.ticker, desc(securityPrice.day));
	for (const row of rows) {
		if (!out.has(row.ticker)) {
			out.set(row.ticker, { day: row.day, closeMinor: row.closeMinor, currency: row.currency });
		}
	}
	return out;
}

/** Closes per ticker from `fromDay` on, oldest first, each in the currency it was quoted in. */
export async function priceHistory(
	tickers: string[],
	fromDay: string,
	handle: Queryable = db
): Promise<Map<string, LatestPrice[]>> {
	const out = new Map<string, LatestPrice[]>();
	if (tickers.length === 0) return out;
	const rows = await handle
		.select()
		.from(securityPrice)
		.where(and(inArray(securityPrice.ticker, tickers), gte(securityPrice.day, fromDay)))
		.orderBy(securityPrice.ticker, securityPrice.day);
	for (const row of rows) {
		const list = out.get(row.ticker) ?? [];
		list.push({ day: row.day, closeMinor: row.closeMinor, currency: row.currency });
		out.set(row.ticker, list);
	}
	return out;
}

/**
 * The close on each requested day or the nearest earlier one, for valuing a
 * batch of vests on non-trading days without a round trip per tranche. Keyed
 * by `${ticker}|${day}`.
 */
export async function closesOnOrBefore(
	requests: { ticker: string; day: string }[],
	handle: Queryable = db
): Promise<Map<string, LatestPrice>> {
	const out = new Map<string, LatestPrice>();
	if (requests.length === 0) return out;
	const tickers = [...new Set(requests.map((r) => r.ticker))];
	const rows = await handle
		.select()
		.from(securityPrice)
		.where(inArray(securityPrice.ticker, tickers))
		.orderBy(securityPrice.ticker, desc(securityPrice.day));
	const byTicker = new Map<string, LatestPrice[]>();
	for (const row of rows) {
		const list = byTicker.get(row.ticker) ?? [];
		list.push({ day: row.day, closeMinor: row.closeMinor, currency: row.currency });
		byTicker.set(row.ticker, list);
	}
	for (const { ticker, day } of requests) {
		const close = byTicker.get(ticker)?.find((p) => p.day <= day);
		if (close) out.set(`${ticker}|${day}`, close);
	}
	return out;
}
