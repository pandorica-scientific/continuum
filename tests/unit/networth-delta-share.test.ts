// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { deltaShareOfBiggest, monthlyDeltas } from '$lib/networth/history';

describe('month-on-month deltas', () => {
	it('produces one fewer delta than there are months', () => {
		const out = monthlyDeltas([{ valueMinor: 100n }, { valueMinor: 150n }, { valueMinor: 130n }]);
		expect(out).toEqual([50n, -20n]);
	});

	it('gives the first month no delta rather than its own value', () => {
		// Otherwise the first month on record is the biggest one forever.
		expect(monthlyDeltas([{ valueMinor: 900n }])).toEqual([]);
	});
});

describe('how big this month is against the biggest', () => {
	it('is the share of the largest move, either direction', () => {
		expect(deltaShareOfBiggest(50n, [100n, -200n, 50n])).toBeCloseTo(0.25);
		expect(deltaShareOfBiggest(-100n, [100n, -200n])).toBeCloseTo(0.5);
	});

	it('fills completely when this month IS the biggest', () => {
		expect(deltaShareOfBiggest(-200n, [100n, -200n])).toBe(1);
	});

	it('measures the first month against net worth when nothing is on record', () => {
		// A household in its first month has a delta and no history; the tide
		// still has to draw something, and net worth is the only scale there is.
		expect(deltaShareOfBiggest(50_000_00n, [], 1_000_000_00n)).toBeCloseTo(0.05);
		expect(deltaShareOfBiggest(-2_000_000_00n, [], 1_000_000_00n)).toBe(1);
		// History wins over net worth once there is any.
		expect(deltaShareOfBiggest(50n, [100n], 1_000_000n)).toBeCloseTo(0.5);
	});

	it('says nothing when there is nothing to compare against', () => {
		expect(deltaShareOfBiggest(50n, [])).toBeNull();
		expect(deltaShareOfBiggest(50n, [0n])).toBeNull();
		expect(deltaShareOfBiggest(null, [100n])).toBeNull();
	});

	it('clamps rather than overflowing when this month beats the record', () => {
		expect(deltaShareOfBiggest(500n, [100n])).toBe(1);
	});
});
