// SPDX-License-Identifier: AGPL-3.0-or-later
interface DonutSlice<T> {
	item: T;
	pct: number;
	from: number;
	to: number;
}

/** Build a complete donut from the same positive values that it renders. */
export function positiveDonutSlices<T>(
	items: T[],
	amountMinor: (item: T) => bigint
): DonutSlice<T>[] {
	const positive = items.filter((item) => amountMinor(item) > 0n);
	const total = positive.reduce((sum, item) => sum + amountMinor(item), 0n);
	if (total <= 0n) return [];

	let cursor = 0;
	return positive.map((item, index) => {
		const from = cursor;
		const pct =
			index === positive.length - 1
				? 100 - cursor
				: Number((amountMinor(item) * 10000n) / total) / 100;
		cursor += pct;
		return { item, pct, from, to: cursor };
	});
}
