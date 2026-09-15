// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * How many cards the strip shows before it offers the rest behind a button.
 *
 * Here rather than beside the sources because both readers need it and one of
 * them is a component: the panel does the slicing, and a component may not
 * import from `$lib/server`. Two spellings of "four" would be a caption that
 * describes five cards while four are on screen.
 */
export const BRIEFING_STRIP_SIZE = 4;

/**
 * Which cards the strip draws, and whether it draws the "more" tile.
 *
 * The tile takes a card's place on the first row rather than sitting under
 * it as a button: `size` is the number of cells in the row, so when there is
 * more than a row's worth the last cell is the way through to the rest.
 * Exactly a row's worth shows every card and no tile — a tile promising one
 * more card would be one click for nothing.
 */
export function stripItems<T>(
	items: readonly T[],
	size: number,
	expanded: boolean
): { shown: T[]; hidden: number } {
	if (expanded || items.length <= size) return { shown: [...items], hidden: 0 };
	const shown = items.slice(0, size - 1);
	return { shown, hidden: items.length - shown.length };
}

/**
 * A grey card is a note — a fixation two years out, a valuation getting old —
 * and the row is for decisions. Notes wait behind the "more" tile whatever
 * their rank, so the first thing read is always something to do; the tile
 * still counts them, and opening it lists them after the decisions.
 */
export function stripBriefing<T extends { hue: string }>(
	items: readonly T[],
	size: number,
	expanded: boolean
): { shown: T[]; hidden: number } {
	const decisions = items.filter((i) => i.hue !== 'grey');
	const notes = items.filter((i) => i.hue === 'grey');
	if (expanded) return { shown: [...decisions, ...notes], hidden: 0 };
	if (notes.length === 0) return stripItems(decisions, size, expanded);
	// Notes are hidden, so the tile is always drawn and takes the last cell.
	const shown = decisions.slice(0, size - 1);
	return { shown, hidden: items.length - shown.length };
}

interface EffectiveSpendingLine {
	day: string;
	currency: string;
	amountMinor: bigint;
	categoryId: string | null;
}

export function groupMonthlySpending(
	lines: EffectiveSpendingLine[],
	groupByCategory: Map<string, string>,
	baseCurrency: string,
	convert: (amount: bigint, from: string, to: string, day: string) => bigint
): { groupKey: string; month: string; spentMinor: bigint }[] {
	const tally = new Map<string, bigint>();
	for (const line of lines) {
		if (line.amountMinor >= 0n || !line.categoryId) continue;
		const groupKey = groupByCategory.get(line.categoryId);
		if (!groupKey || groupKey === 'income' || groupKey === 'savings') continue;
		const month = line.day.slice(0, 7);
		const key = `${groupKey}\0${month}`;
		const spent = -convert(line.amountMinor, line.currency, baseCurrency, line.day);
		tally.set(key, (tally.get(key) ?? 0n) + spent);
	}
	return [...tally].map(([key, spentMinor]) => {
		const [groupKey, month] = key.split('\0');
		return { groupKey, month, spentMinor };
	});
}
