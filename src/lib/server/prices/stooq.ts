// SPDX-License-Identifier: AGPL-3.0-or-later
import { fromMajor } from '$lib/money';
import { providerSymbol, registerPriceProvider, type Quote } from './adapter';

const CSV_URL = (symbol: string) =>
	`https://stooq.com/q/l/?s=${encodeURIComponent(symbol)}&f=sd2t2ohlcv&h&e=csv`;

/**
 * The scale a stooq close is parsed at before its currency is known. Two
 * decimals is what every market this feed covers prints; `refreshPrices`
 * re-scales once it knows the owner's currency.
 */
export const STOOQ_SCALE_CURRENCY = 'USD';

/** Exported for tests. Stooq's CSV carries no currency; the caller fills it from the grant or holding. */
export function parseStooqCsv(body: string): Quote | null {
	const lines = body.trim().split(/\r?\n/);
	if (lines.length < 2) return null;
	const head = lines[0].split(',').map((h) => h.trim().toLowerCase());
	const row = lines[1].split(',');
	const dateAt = head.indexOf('date');
	const closeAt = head.indexOf('close');
	if (dateAt < 0 || closeAt < 0) return null;
	const day = row[dateAt]?.trim() ?? '';
	const close = Number(row[closeAt]);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(close)) return null;
	return { day, closeMinor: fromMajor(close, STOOQ_SCALE_CURRENCY), currency: '' };
}

registerPriceProvider({
	id: 'stooq',
	async fetchClose(ticker, fetchFn) {
		const symbol = providerSymbol(ticker, 'stooq');
		if (symbol === null) return null;
		const res = await fetchFn(CSV_URL(symbol));
		if (!res.ok) return null;
		return parseStooqCsv(await res.text());
	}
});
