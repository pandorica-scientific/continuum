// SPDX-License-Identifier: AGPL-3.0-or-later
// What a figure did against the window before it.
//
// Pure and shared, beside `tone.ts`, because the arithmetic and the colour are
// two halves of the same decision: a percentage on its own says which way a
// number moved, and only the caller knows whether that direction is good news.
// Spending 12% more and earning 12% more are the same arrow and the opposite
// piece of news, and a component that decided the colour for itself would have
// to be told the same thing anyway — once per figure, in a file that also draws.

/**
 * The change from one window to the next, as a whole percent.
 *
 * Rounded rather than carried to a decimal: these sit in a strip of a dozen
 * figures where a tenth of a percent is noise, and the windows themselves are
 * display-grade sums that have already been rounded once.
 *
 * Null where there is nothing to divide by. "Up from nothing" is not a
 * percentage, and a negative base is not a baseline — a window that ended in a
 * shortfall cannot say what a fraction of it would be.
 */
export function deltaPct(current: number, previous: number): number | null {
	if (previous <= 0) return null;
	// The difference first, then the division. `current / previous - 1` takes the
	// same answer through a subtraction of two numbers either side of 1, and a
	// 1.5% rise off 1000 comes back as 1.4999999999999902 — which rounds to the
	// wrong whole percent.
	const change = ((current - previous) / previous) * 100;
	// Rounded about zero rather than upward. `Math.round` breaks a tie towards
	// +∞, so a 1.5% fall came back as 1 where the same 1.5% rise came back as 2 —
	// the same movement reported as two different numbers depending on which way
	// it went, in a strip where the two sit one above the other.
	return Math.sign(change) * Math.round(Math.abs(change));
}

/**
 * The colour token for a change, given which direction is the good one.
 *
 * `goodWhenUp` is what tells earning more from spending more. Everything that
 * has no news in it — no change at all, or nothing to compare against — stays
 * on the quiet foreground rather than picking a state colour, because green at
 * exactly 0% would report a rounding artefact as a win.
 */
export function deltaTone(pct: number | null, goodWhenUp: boolean): '--green' | '--red' | '--fg3' {
	if (pct === null || pct === 0) return '--fg3';
	return pct > 0 === goodWhenUp ? '--green' : '--red';
}
