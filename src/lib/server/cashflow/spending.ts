// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/**
 * What each expense group cost, month by month, over the whole record.
 *
 * `groupMonthlySpending` in `$lib/briefing` does the tally, and it excludes the
 * two group keys `income` and `savings` by NAME. That was right while the
 * groups were a code constant; they are rows a household owns now, so a
 * household that renames Income, or adds a second savings group, had its pay
 * counted as an expense — and the literal is inside a pure function two callers
 * share, which is not where the fix belongs.
 *
 * So the exclusion happens here, at the caller, by ROLE: only categories in an
 * expense-role group reach the map at all, and a category the map does not hold
 * is one the tally skips. The pure function keeps its own guard, which is now
 * saying the same thing twice about the seeded keys and nothing about the rest.
 */
import { db } from '$lib/server/db';
import { category, transaction } from '$lib/server/db/schema';
import { groupMonthlySpending } from '$lib/briefing';
import { expenseGroups, loadCategoryGroups } from '$lib/server/categorize/groups';
import { convertOrFace, loadRateTable, type RateTable } from '$lib/server/fx/table';
import { loadSplits } from '$lib/server/splits';
import { effectiveLines } from '$lib/transactions/lines';
import { notOwnTransfer } from '$lib/server/transactions/transfers';

/** One group's spending in one month, in minor units of the base currency. */
export interface GroupMonthSpend {
	groupKey: string;
	/** `YYYY-MM`. */
	month: string;
	spentMinor: bigint;
}

/**
 * @param options.rates A rate table the caller has already loaded. The Overview
 * loads one per request and hands it to every panel that needs it, and this
 * tally reading its own would be a second copy of the whole table for one load.
 */
export async function expenseSpendingByMonth(
	baseCurrency: string,
	options: { rates?: RateTable } = {}
): Promise<GroupMonthSpend[]> {
	const [txns, categories, groups, rates] = await Promise.all([
		db.select().from(transaction).where(notOwnTransfer()),
		db.select().from(category),
		loadCategoryGroups(),
		options.rates ?? loadRateTable()
	]);

	const expenseKeys = new Set(expenseGroups(groups).map((group) => group.key));
	const groupByCategory = new Map(
		categories.filter((c) => expenseKeys.has(c.groupKey)).map((c) => [c.id, c.groupKey] as const)
	);

	// Aggregated in JavaScript rather than in SQL because a transaction may be
	// split across categories, and `effectiveLines` is the only thing that knows
	// how the bank's fee comes off those lines.
	const splitsByTxn = await loadSplits(txns.map((t) => t.id));

	return groupMonthlySpending(
		txns.flatMap((t) => {
			// The value date where the bank printed one, so a payment that straddles
			// a month boundary lands in the month the money actually moved.
			const day = t.valueOn ?? t.bookedOn;
			return effectiveLines(t, splitsByTxn.get(t.id) ?? []).map((line) => ({
				day,
				currency: t.currency,
				amountMinor: line.amountMinor,
				categoryId: line.categoryId
			}));
		}),
		groupByCategory,
		baseCurrency,
		(amount, from, to, day) => convertOrFace(rates, amount, from, to, day)
	);
}
