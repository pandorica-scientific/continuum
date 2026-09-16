// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The change from one window to the next, as a whole rounded percent.
 * Null where there is nothing to divide by (previous <= 0).
 */
export function deltaPct(current: number, previous: number): number | null {
	if (previous <= 0) return null;
	// current/previous - 1 loses precision near 1 (e.g. a 1.5% rise off 1000
	// comes back as 1.4999999999999902), so subtract first, then divide.
	const change = ((current - previous) / previous) * 100;
	// Round by magnitude, not Math.round, so a fall and a rise of the same size
	// don't get reported as different whole percents (Math.round ties to +∞).
	return Math.sign(change) * Math.round(Math.abs(change));
}

/**
 * The colour token for a change, given which direction is the good one.
 * No change, or nothing to compare against, stays on the quiet foreground
 * rather than green — green at exactly 0% would read as a win that isn't one.
 */
export function deltaTone(pct: number | null, goodWhenUp: boolean): '--green' | '--red' | '--fg3' {
	if (pct === null || pct === 0) return '--fg3';
	return pct > 0 === goodWhenUp ? '--green' : '--red';
}
