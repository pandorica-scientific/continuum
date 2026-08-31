// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * When an account's statements are overdue.
 *
 * "Overdue" cannot be one number for every account. A current account read
 * every week and a mortgage account whose bank posts once a quarter are both
 * being kept up to date, and a fixed window calls one of them late every
 * quarter or lets the other go a month without anybody noticing. So the window
 * is read off what the household actually does: the gap between imports, as
 * this account has had them, with room for a late upload on either side.
 *
 * Pure and separate from the panel that draws it, because the arithmetic is the
 * part worth holding by test — there is no browser suite here, and a rule this
 * quiet is exactly the kind that drifts unnoticed.
 */
import { daysBetween } from '$lib/dates';

/**
 * The window an account with no readable rhythm gets.
 *
 * Six weeks: long enough that a monthly statement uploaded a fortnight late is
 * not called overdue, short enough that a missed month is.
 */
export const STALE_AFTER_DAYS = 45;

/**
 * How many imports it takes before the gaps between them are a cadence.
 *
 * Three, because two imports are one gap and one gap is an accident. A median
 * needs something to be in the middle of.
 */
export const MIN_IMPORTS_FOR_CADENCE = 3;

/**
 * How much later than the usual gap a statement may arrive before it is late.
 *
 * Half again: a household that imports monthly on no particular day routinely
 * runs a week or two over, and a threshold with no slack in it would report
 * that as a problem every month.
 */
export const CADENCE_SLACK = 1.5;

/** The middle value, or the mean of the two middle ones. */
function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * How many days an account may go without an import before it is behind.
 *
 * The MEDIAN gap, not the mean. One catch-up upload of a year's backlog is a
 * single enormous gap, and a mean would let it push the threshold out far
 * enough that the account never looked late again.
 *
 * DISTINCT days, and that is not tidying. Uploading six months of statements in
 * one sitting is six imports on one day, which is five gaps of zero — enough to
 * take the median to zero and put a threshold of nought days on an account that
 * has just been brought completely up to date. A day either has an import on it
 * or it does not; how many arrived that afternoon says nothing about the rhythm.
 */
export function staleAfter(uploadDays: readonly string[]): number {
	const ordered = [...new Set(uploadDays)].sort();
	if (ordered.length < MIN_IMPORTS_FOR_CADENCE) return STALE_AFTER_DAYS;
	const gaps = ordered.slice(1).map((day, i) => daysBetween(ordered[i], day));
	// Whole days, because that is the unit the figure beside it is counted in.
	return Math.round(median(gaps) * CADENCE_SLACK);
}

export interface StatementStatus {
	/** The newest import, or null where there has never been one. */
	lastOn: string | null;
	daysSince: number | null;
	/** The window this account's own cadence earns it. */
	threshold: number;
	stale: boolean;
}

/**
 * Where an account stands, given every day it has been imported on.
 *
 * An account nobody has ever imported is NOT stale. Nothing was promised, so
 * nothing is late — "never imported" is a different fact from "overdue", and
 * painting the two the same colour would tell a household to chase a statement
 * for an account they have only just added.
 */
export function statementStatus(uploadDays: readonly string[], today: string): StatementStatus {
	const threshold = staleAfter(uploadDays);
	const lastOn = uploadDays.length > 0 ? [...uploadDays].sort().at(-1)! : null;
	if (!lastOn) return { lastOn: null, daysSince: null, threshold, stale: false };
	const daysSince = daysBetween(lastOn, today);
	return { lastOn, daysSince, threshold, stale: daysSince > threshold };
}
