// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * How many cards the strip shows before it offers the rest behind a button.
 *
 * Here rather than beside the sources because both readers need it and one of
 * them is a component: the panel does the slicing, and a component may not
 * import from `$lib/server`. Two spellings of "four" would be a caption that
 * describes five cards while four are on screen.
 */
export const BRIEFING_STRIP_SIZE = 4;

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
