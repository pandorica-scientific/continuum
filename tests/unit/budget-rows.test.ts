// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';
import { budgetRows, comparedMonth } from '$lib/budget';

const groups = [
	{ key: 'housing', label: 'Housing', colorToken: '--series-housing' },
	{ key: 'living', label: 'Food & lifestyle', colorToken: '--series-living' }
];

const spend = (groupKey: string, month: string, amount: number) => ({
	groupKey,
	month,
	spent: amount
});

describe('budgetRows', () => {
	// The anchor month is the thing being judged; folding it into the average it
	// is judged against would pull the line towards whatever this month did and
	// make a bad month look ordinary.
	it('averages the months before the anchor and leaves the anchor out', () => {
		const [housing] = budgetRows(
			[
				spend('housing', '2026-05', 10_000),
				spend('housing', '2026-06', 20_000),
				// Six times the usual, and it must not lift its own average.
				spend('housing', '2026-07', 90_000)
			],
			[groups[0]],
			'2026-07'
		);
		expect(housing.thisMonth).toBe(90_000);
		expect(housing.average).toBe(15_000);
		expect(housing.overPct).toBe(500);
	});

	// A group's first month has nothing behind it. "Up from nothing" is not a
	// percentage, and a household would be told its first grocery shop was an
	// infinite overspend.
	it('has no percentage for a group with no history behind it', () => {
		const [housing] = budgetRows([spend('housing', '2026-07', 12_000)], [groups[0]], '2026-07');
		expect(housing.average).toBe(0);
		expect(housing.overPct).toBeNull();
	});

	// Bars are drawn against the largest figure on the panel, whichever row and
	// whichever of the two bars it belongs to — otherwise two rows on the same
	// scale look like two different scales.
	it('scales every bar against the largest figure on the panel', () => {
		const rows = budgetRows(
			[
				spend('housing', '2026-06', 40_000),
				spend('housing', '2026-07', 20_000),
				spend('living', '2026-06', 10_000),
				spend('living', '2026-07', 10_000)
			],
			groups,
			'2026-07'
		);
		expect(rows.map((r) => [r.thisWidth, r.averageWidth])).toEqual([
			[50, 100],
			[25, 25]
		]);
	});

	// A group nobody has ever spent in is not a row of zeroes on the panel; it
	// is simply not one of the household's stages.
	it('leaves out a group with no history and nothing this month', () => {
		const rows = budgetRows([spend('housing', '2026-07', 12_000)], groups, '2026-07');
		expect(rows.map((r) => r.key)).toEqual(['housing']);
	});
});

describe('comparedMonth', () => {
	// The anchor is normally the newest month the record holds, which for most of
	// every month IS the running month — three days of shopping beside twelve
	// full months of it would report every group as far under its average.
	it('steps back to the last complete month while the anchor is still running', () => {
		expect(comparedMonth('2026-08', '2026-08')).toBe('2026-07');
		// Already behind us, so it is complete and compared as it stands.
		expect(comparedMonth('2026-07', '2026-08')).toBe('2026-07');
	});
});
