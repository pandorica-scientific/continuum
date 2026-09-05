// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * One series colour per holding, stable for a given order.
 *
 * The pie and the holdings table used to colour independently — the pie by
 * its own slice order, the table not at all — so a row's swatch could not be
 * matched to a wedge. Both now ask this, with the holdings in the order the
 * screen lists them (largest first), and get the same answer.
 */
const SERIES = [
	'--teal',
	'--blue',
	'--purple',
	'--orange',
	'--yellow',
	'--green',
	'--red'
] as const;

export function seriesFor(tickers: readonly string[]): (ticker: string) => string {
	const map = new Map<string, string>();
	for (const ticker of tickers) {
		if (!map.has(ticker)) map.set(ticker, SERIES[map.size % SERIES.length]);
	}
	return (ticker) => map.get(ticker) ?? '--fg3';
}
