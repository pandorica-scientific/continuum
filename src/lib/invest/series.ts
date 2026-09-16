// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * One series colour per holding, stable for a given order.
 *
 * Both the pie and the holdings table ask this, with the holdings in the
 * order the screen lists them (largest first), so a row's swatch always
 * matches its wedge.
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
