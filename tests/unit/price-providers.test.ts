// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { providerSymbol } from '$lib/server/prices/adapter';
import { parseYahooChart } from '$lib/server/prices/yahoo';
import { parseStooqCsv } from '$lib/server/prices/stooq';
import { withAlias } from '$lib/server/prices/settings';

const YAHOO = JSON.stringify({
	chart: {
		result: [
			{
				meta: {
					currency: 'USD',
					symbol: 'ACME',
					regularMarketPrice: 142.3,
					regularMarketTime: 1_789_243_200
				},
				timestamp: [1_789_156_800, 1_789_243_200],
				indicators: { quote: [{ close: [140.0, 142.3] }] }
			}
		],
		error: null
	}
});

const STOOQ = `Symbol,Date,Time,Open,High,Low,Close,Volume
ACME.US,2026-09-12,22:00:11,140.1,143.0,139.8,142.3,1234567`;

describe('providerSymbol', () => {
	it('maps the broker suffix to each provider, and refuses what a provider cannot price', () => {
		expect(providerSymbol('MSFT.US', 'yahoo')).toBe('MSFT');
		expect(providerSymbol('VWCE.DE', 'yahoo')).toBe('VWCE.DE');
		expect(providerSymbol('CSPX.UK', 'yahoo')).toBe('CSPX.L');
		expect(providerSymbol('CEZ.CZ', 'yahoo')).toBe('CEZ.PR');
		expect(providerSymbol('MSFT.US', 'stooq')).toBe('msft.us');
		expect(providerSymbol('CEZ.CZ', 'stooq')).toBeNull();
		expect(providerSymbol('NOSUFFIX', 'yahoo')).toBeNull();
	});
});

describe('withAlias', () => {
	it("swaps only the base, keeping the ticker's own market suffix", () => {
		expect(withAlias('TSLA.DE', { 'TSLA.DE': 'TL0' })).toBe('TL0.DE');
		expect(providerSymbol(withAlias('TSLA.DE', { 'TSLA.DE': 'TL0' }), 'yahoo')).toBe('TL0.DE');
		expect(providerSymbol(withAlias('TSLA.DE', { 'TSLA.DE': 'TL0' }), 'stooq')).toBe('tl0.de');
	});

	it('leaves a ticker with no alias exactly as it is', () => {
		expect(withAlias('RKLB.US', { 'TSLA.DE': 'TL0' })).toBe('RKLB.US');
		expect(withAlias('RKLB.US', {})).toBe('RKLB.US');
	});
});

describe('parseYahooChart', () => {
	it('reads the last close, its day and the currency', () => {
		const q = parseYahooChart(YAHOO);
		expect(q).toEqual({ day: '2026-09-12', closeMinor: 14230n, currency: 'USD' });
	});
	it('falls back to the meta price when every close is null', () => {
		const body = JSON.stringify({
			chart: {
				result: [
					{
						meta: { currency: 'EUR', regularMarketPrice: 10.5, regularMarketTime: 1_789_243_200 },
						timestamp: [1_789_243_200],
						indicators: { quote: [{ close: [null] }] }
					}
				]
			}
		});
		expect(parseYahooChart(body)).toEqual({
			day: '2026-09-12',
			closeMinor: 1050n,
			currency: 'EUR'
		});
	});
	it('returns null on an error body or a missing result', () => {
		expect(
			parseYahooChart(JSON.stringify({ chart: { result: null, error: { code: 'Not Found' } } }))
		).toBeNull();
		expect(parseYahooChart('not json')).toBeNull();
	});
});

describe('parseStooqCsv', () => {
	it('reads the close and day; the currency is not in the feed', () => {
		expect(parseStooqCsv(STOOQ)).toEqual({ day: '2026-09-12', closeMinor: 14230n, currency: '' });
	});
	it('returns null for the N/D row stooq sends for an unknown symbol', () => {
		expect(
			parseStooqCsv(
				'Symbol,Date,Time,Open,High,Low,Close,Volume\nXXXX.US,N/D,N/D,N/D,N/D,N/D,N/D,N/D'
			)
		).toBeNull();
	});
});

describe('refreshPrices provider fallback', () => {
	it('moves on to the next feed when the first answers in a currency the app cannot convert', async () => {
		const { refreshPrices } = await import('$lib/server/prices');
		// A GBp quote is re-scaled to GBP rather than dropped.
		const body = JSON.stringify({
			chart: {
				result: [
					{
						meta: { currency: 'GBp', regularMarketPrice: 61234, regularMarketTime: 1_789_243_200 },
						timestamp: [1_789_243_200],
						indicators: { quote: [{ close: [61234] }] }
					}
				]
			}
		});
		const inserted: unknown[] = [];
		const handle = {
			select: () => ({
				from: () => ({
					// pricedTickers: holdings then grants
					where: () => Promise.resolve([]),
					innerJoin: () => ({ where: () => Promise.resolve([]) }),
					then: (r: (v: unknown[]) => void) => r([{ ticker: 'CSPX.UK', currency: 'GBP' }])
				})
			}),
			selectDistinct: () => ({
				from: () => ({ innerJoin: () => ({ where: () => Promise.resolve([]) }) })
			}),
			insert: () => ({
				values: (v: unknown) => {
					inserted.push(v);
					return { onConflictDoNothing: () => Promise.resolve() };
				}
			})
		};
		const fetchFn = (async () => new Response(body)) as unknown as typeof fetch;
		const result = await refreshPrices(fetchFn, handle as never);
		expect(result).toEqual({ fetched: 1, skipped: [] });
		expect(inserted[0]).toMatchObject({
			ticker: 'CSPX.UK',
			currency: 'GBP',
			closeMinor: 6123400n / 100n
		});
	});
});
