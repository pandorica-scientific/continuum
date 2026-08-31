// SPDX-License-Identifier: AGPL-3.0-or-later
// Where every mark in the cash-flow history chart goes.
//
// Pulled out of the component for the same reason as the tax and salary chart
// geometry beside it: the rules below — one ceiling for every bar, the hairline
// floor, where a year label sits over the months it covers — regress silently
// in markup and are obvious in a test.

import { historyTicks } from '$lib/charts/ticks';

/** The viewBox the chart draws into. */
export const VIEW_W = 1000;
export const VIEW_H = 260;

/** The bars live between these. */
export const TOP = 18;
export const BOTTOM = 208;

/** The plot's horizontal extent. Everything left of X_LEFT is axis gutter. */
export const X_LEFT = 56;
export const X_RIGHT = 992;

/** Where the month labels sit, beneath the baseline. */
export const AXIS_Y = 230;

/**
 * The centre of the band the rotated axis title names, as a percentage of the
 * viewBox height — derived from the band rather than eyeballed, as on the tax
 * and salary charts.
 */
export const AXIS_TITLE_PCT = (((TOP + BOTTOM) / 2) * 100) / VIEW_H;

/** The fractions of the ceiling that carry a gridline and a label. */
export const GRID_FRACTIONS = [0, 0.25, 0.5, 0.75, 1] as const;

/** One month, as the cash-flow loader reports it: major units, both positive. */
export interface MonthBar {
	/** `YYYY-MM`. */
	month: string;
	earned: number;
	spent: number;
}

export interface Bar {
	kind: 'in' | 'out';
	x: number;
	y: number;
	width: number;
	height: number;
}

/** The x centre of a month's slot. */
export function slotFor(index: number, count: number): number {
	const slot = (X_RIGHT - X_LEFT) / count;
	return X_LEFT + slot * index + slot / 2;
}

/**
 * How wide one of a month's two bars is.
 *
 * The pair takes most of the slot and each bar half of what is left, capped so
 * a household three months into importing gets two bars rather than two slabs
 * the width of the card.
 */
export function barWidth(count: number): number {
	const slot = (X_RIGHT - X_LEFT) / Math.max(count, 1);
	return Math.max(1, Math.min(26, (slot * 0.72) / 2));
}

/** The tallest single figure in the record, so every bar shares one scale. */
export function ceilingFor(months: MonthBar[]): number {
	return months.reduce((most, m) => Math.max(most, m.earned, m.spent), 0);
}

/**
 * A hairline, so a month that earned two orders below the rest is present
 * rather than rounded out of existence. Nothing is drawn for a true zero: a
 * month with no income at all is not a month with a little.
 */
const HAIRLINE = 0.8;

/** One month's pair of bars, earned on the left of the slot and spent on its right. */
export function barsFor(month: MonthBar, index: number, count: number, ceiling: number): Bar[] {
	const width = barWidth(count);
	const centre = slotFor(index, count);
	const scale = (value: number) =>
		value <= 0 || ceiling <= 0 ? 0 : Math.max(HAIRLINE, (value / ceiling) * (BOTTOM - TOP));

	// A single unit between them: touching, the pair reads as one stacked bar.
	return [
		{ kind: 'in' as const, x: centre - width - 0.5, value: month.earned },
		{ kind: 'out' as const, x: centre + 0.5, value: month.spent }
	].map(({ kind, x, value }) => {
		const height = scale(value);
		return { kind, x, width, height, y: BOTTOM - height };
	});
}

/**
 * What a month kept, as a percentage of what it earned.
 *
 * Null when nothing came in: a month that earned nothing and spent something
 * has no ratio, and reporting −∞ or −100% would both be inventions.
 */
export function keptPct(month: MonthBar): number | null {
	if (month.earned <= 0) return null;
	return ((month.earned - month.spent) / month.earned) * 100;
}

/**
 * Axis labels with an x apiece.
 *
 * Which labels there are is `historyTicks`' rule and stays there. What is added
 * here is where each one goes: a month label sits under its own bar, and a year
 * label sits over the middle of the run of months belonging to it — rather than
 * being spread evenly across the axis, which put a year label under a month
 * from a different year as soon as a record started mid-year.
 */
export function axisTicks(months: string[]): { key: string; x: number; label: string }[] {
	const ticks = historyTicks(months);
	if (ticks.unit === 'month')
		return ticks.labels.map((label, i) => ({
			key: months[i],
			x: slotFor(i, months.length),
			label
		}));

	return ticks.labels.map((label) => {
		let first = -1;
		let last = -1;
		months.forEach((month, i) => {
			if (!month.startsWith(label)) return;
			if (first === -1) first = i;
			last = i;
		});
		return {
			key: label,
			x: (slotFor(first, months.length) + slotFor(last, months.length)) / 2,
			label
		};
	});
}
