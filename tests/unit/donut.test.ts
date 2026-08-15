import { describe, expect, it } from 'vitest';
import { positiveDonutSlices } from '$lib/charts/donut';

describe('positiveDonutSlices', () => {
	it('uses only rendered positive balances as its denominator', () => {
		const slices = positiveDonutSlices(
			[
				{ id: 'savings', amount: 1000n },
				{ id: 'overdraft', amount: -500n }
			],
			(item) => item.amount
		);

		expect(slices).toHaveLength(1);
		expect(slices[0]).toMatchObject({ item: { id: 'savings' }, pct: 100, from: 0, to: 100 });
	});

	it('makes the final positive slice end at one hundred percent', () => {
		const slices = positiveDonutSlices(
			[
				{ id: 'a', amount: 1n },
				{ id: 'b', amount: 1n },
				{ id: 'c', amount: 1n }
			],
			(item) => item.amount
		);

		expect(slices.at(-1)?.to).toBe(100);
	});
});
