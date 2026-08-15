import { describe, expect, it } from 'vitest';
import { groupMonthlySpending } from '$lib/briefing';

describe('groupMonthlySpending', () => {
	it('converts every effective line at its own date before summing', () => {
		const seen: string[] = [];
		const rows = groupMonthlySpending(
			[
				{
					day: '2026-01-05',
					currency: 'EUR',
					amountMinor: -100n,
					categoryId: 'food'
				},
				{
					day: '2026-01-07',
					currency: 'CZK',
					amountMinor: -200n,
					categoryId: 'food'
				}
			],
			new Map([['food', 'living']]),
			'CZK',
			(amount, from, to, day) => {
				seen.push(`${from}|${to}|${day}`);
				return from === to ? amount : amount * 25n;
			}
		);

		expect(rows).toEqual([{ groupKey: 'living', month: '2026-01', spentMinor: 2700n }]);
		expect(seen).toEqual(['EUR|CZK|2026-01-05', 'CZK|CZK|2026-01-07']);
	});

	it('excludes income, savings, positive values, and uncategorised lines', () => {
		const rows = groupMonthlySpending(
			[
				{ day: '2026-01-01', currency: 'CZK', amountMinor: 100n, categoryId: 'food' },
				{ day: '2026-01-01', currency: 'CZK', amountMinor: -100n, categoryId: 'salary' },
				{ day: '2026-01-01', currency: 'CZK', amountMinor: -100n, categoryId: 'saved' },
				{ day: '2026-01-01', currency: 'CZK', amountMinor: -100n, categoryId: null }
			],
			new Map([
				['food', 'living'],
				['salary', 'income'],
				['saved', 'savings']
			]),
			'CZK',
			(amount) => amount
		);

		expect(rows).toEqual([]);
	});
});
