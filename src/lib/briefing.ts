export interface EffectiveSpendingLine {
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
