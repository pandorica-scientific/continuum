// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * A month against what the months before it usually cost.
 *
 * Not a budget: nobody set one. The comparison a household actually makes is
 * against its own record — "is this month's food shopping normal?" — and the
 * answer is the mean of the months before it, per category group.
 *
 * Pure and client-safe, so the arithmetic that decides what "usually" means can
 * be held by a unit test rather than by a database and a screen.
 */
import { deltaPct } from '$lib/charts/delta';
import { addMonths } from '$lib/cashflow/period';

/**
 * How many months back the average reaches, at most.
 *
 * A year, so a household that spends on heating in winter and on holidays in
 * summer is compared against a line that has seen both. Longer would drag in
 * prices from before the last two rounds of inflation.
 */
const BUDGET_HISTORY_MONTHS = 12;

/** The smallest a bar may be drawn and still say "something, but not much". */
const MIN_BAR_WIDTH_PCT = 2;

/**
 * Which month the panel may actually compare, given the one the board is on.
 *
 * A part month is not comparable with full ones. The anchor is normally the
 * newest month the record holds, and for most of every month that IS the
 * running month — so the panel would put three days of shopping beside twelve
 * full months of it and report every group as far under its average, which is
 * the one direction a comparison can be wrong in without looking wrong.
 *
 * So: the anchor where the anchor is already behind us, and otherwise the month
 * before it. `currentMonth` is passed in rather than read here — the caller
 * computes it in UTC, like the rest of the pipeline.
 */
export function comparedMonth(anchor: string | null, currentMonth: string): string | null {
	if (!anchor) return null;
	return anchor < currentMonth ? anchor : addMonths(anchor, -1);
}

/** One group's spending in one month, in base-currency major units. */
export interface GroupSpend {
	groupKey: string;
	/** `YYYY-MM`. */
	month: string;
	spent: number;
}

/**
 * The little of a category group this needs.
 *
 * Structural rather than the server's `GroupRow`: this file is client-safe and
 * may not reach into `$lib/server`, and the three fields it reads are the three
 * a group has had since the table replaced the constant.
 */
export interface BudgetGroup {
	key: string;
	label: string;
	colorToken: string;
}

export interface BudgetRow {
	key: string;
	label: string;
	colorVar: string;
	thisMonth: number;
	average: number;
	thisWidth: number;
	averageWidth: number;
	/** How far over the average this month is, as a whole percent, or null. */
	overPct: number | null;
}

/**
 * Every group worth a row, this month against its own average.
 *
 * The anchor month is deliberately NOT in the average it is compared against: a
 * month folded into its own baseline pulls the line towards whatever it did,
 * and an extraordinary month would report itself as ordinary.
 *
 * Groups are taken in the order they are given — the waterfall's — so the panel
 * reads down in the same order as the cash-flow chart it links to.
 */
export function budgetRows(
	rows: readonly GroupSpend[],
	groups: readonly BudgetGroup[],
	anchor: string | null
): BudgetRow[] {
	if (!anchor) return [];
	// Nothing was spent in the month being judged — no statement for it yet, or
	// none of it categorised. Drawing every group at zero against its average
	// would report a household that has stopped spending entirely.
	if (!rows.some((row) => row.month === anchor)) return [];

	const measured = groups
		.map((group) => {
			const mine = rows.filter((row) => row.groupKey === group.key);
			const thisMonth = mine
				.filter((row) => row.month === anchor)
				.reduce((sum, row) => sum + row.spent, 0);
			// The months BEFORE the anchor, newest first. Only months this group
			// actually spent in are here at all, so a gap costs the average nothing
			// rather than counting as a zero month that never happened.
			const history = mine
				.filter((row) => row.month < anchor)
				.sort((a, b) => (a.month < b.month ? 1 : -1))
				.slice(0, BUDGET_HISTORY_MONTHS);
			const average =
				history.length > 0 ? history.reduce((sum, row) => sum + row.spent, 0) / history.length : 0;
			return { group, thisMonth, average, hasHistory: history.length > 0 };
		})
		// A group with no record and nothing this month is not one of this
		// household's stages, and a row of zeroes says nothing but takes a line.
		.filter((row) => row.thisMonth > 0 || row.hasHistory);

	// One scale for the whole panel, across both bars of every row: two rows
	// each drawn against their own largest figure look like one scale and are
	// not, which is the most misleading thing a bar chart can do.
	const largest = measured.reduce((max, row) => Math.max(max, row.thisMonth, row.average), 0);
	// Zero draws nothing. The floor exists so a small figure is still visible as
	// a figure; applying it to nothing at all would put a sliver of colour under
	// a group that spent none, which reads as "a little" rather than as "none".
	const width = (value: number) =>
		value <= 0 || largest <= 0
			? 0
			: Math.max(MIN_BAR_WIDTH_PCT, Math.round((value / largest) * 100));

	return measured.map((row) => ({
		key: row.group.key,
		label: row.group.label,
		colorVar: row.group.colorToken,
		thisMonth: row.thisMonth,
		average: row.average,
		thisWidth: width(row.thisMonth),
		averageWidth: width(row.average),
		// Null where there is no baseline: "up from nothing" is not a percentage.
		overPct: deltaPct(row.thisMonth, row.average)
	}));
}
