// SPDX-License-Identifier: AGPL-3.0-or-later
import { fromMajor } from '$lib/money';
import { providerSymbol, registerPriceProvider, type Quote } from './adapter';

const CHART_URL = (symbol: string) =>
	`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;

interface ChartResult {
	meta?: { currency?: string; regularMarketPrice?: number; regularMarketTime?: number };
	timestamp?: number[];
	indicators?: { quote?: { close?: (number | null)[] }[] };
}

/** Exported for tests: the chart endpoint's JSON to one quote. */
export function parseYahooChart(body: string): Quote | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(body);
	} catch {
		return null;
	}
	const result = (parsed as { chart?: { result?: ChartResult[] | null } })?.chart?.result?.[0];
	if (!result?.meta) return null;
	const closes = result.indicators?.quote?.[0]?.close ?? [];
	const stamps = result.timestamp ?? [];
	let close: number | undefined;
	let at: number | undefined;
	for (let i = closes.length - 1; i >= 0; i--) {
		const candidate = closes[i];
		if (typeof candidate === 'number') {
			close = candidate;
			at = stamps[i];
			break;
		}
	}
	if (close === undefined) {
		close = result.meta.regularMarketPrice;
		at = result.meta.regularMarketTime;
	}
	const currency = result.meta.currency ?? '';
	if (typeof close !== 'number' || !Number.isFinite(close) || !currency || !at) return null;
	// The UTC day of the last bar. Every exchange the suffix map covers closes
	// before midnight UTC, so this is the trading day, not the one after.
	return {
		day: new Date(at * 1000).toISOString().slice(0, 10),
		closeMinor: fromMajor(close, currency),
		currency
	};
}

registerPriceProvider({
	id: 'yahoo',
	async fetchClose(ticker, fetchFn) {
		const symbol = providerSymbol(ticker, 'yahoo');
		if (symbol === null) return null;
		const res = await fetchFn(CHART_URL(symbol), {
			headers: { 'user-agent': 'Mozilla/5.0 (compatible; Continuum)' }
		});
		if (!res.ok) return null;
		return parseYahooChart(await res.text());
	}
});
