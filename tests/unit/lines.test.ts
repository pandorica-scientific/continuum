import { describe, expect, it } from 'vitest';
import { effectiveLines, matchingLineTotal } from '$lib/transactions/lines';

const txn = (
	amountMinor: bigint,
	categoryId: string | null = null,
	feeMinor: bigint | null = null
) => ({
	amountMinor,
	feeMinor,
	categoryId
});

describe('effectiveLines', () => {
	it('gives an unsplit transaction one line carrying its own category', () => {
		expect(effectiveLines(txn(-4550n, 'groceries'), [])).toEqual([
			{ categoryId: 'groceries', amountMinor: -4550n, splitId: null }
		]);
	});

	it('returns the split rows when a transaction is split', () => {
		const splits = [
			{ id: 's1', amountMinor: -3000n, categoryId: 'groceries', sort: 0 },
			{ id: 's2', amountMinor: -1550n, categoryId: 'household', sort: 1 }
		];
		expect(effectiveLines(txn(-4550n), splits)).toEqual([
			{ categoryId: 'groceries', amountMinor: -3000n, splitId: 's1' },
			{ categoryId: 'household', amountMinor: -1550n, splitId: 's2' }
		]);
	});

	it('orders split lines by sort, not by the order they arrived', () => {
		const splits = [
			{ id: 's2', amountMinor: -1550n, categoryId: 'household', sort: 1 },
			{ id: 's1', amountMinor: -3000n, categoryId: 'groceries', sort: 0 }
		];
		expect(effectiveLines(txn(-4550n), splits).map((l) => l.splitId)).toEqual(['s1', 's2']);
	});

	it('nets the bank fee out of an unsplit line', () => {
		expect(effectiveLines(txn(-4550n, 'groceries', 50n), [])).toEqual([
			{ categoryId: 'groceries', amountMinor: -4600n, splitId: null }
		]);
	});

	it('takes the whole fee off the first split line so lines still sum to net', () => {
		const splits = [
			{ id: 's1', amountMinor: -3000n, categoryId: 'groceries', sort: 0 },
			{ id: 's2', amountMinor: -1550n, categoryId: 'household', sort: 1 }
		];
		const lines = effectiveLines(txn(-4550n, null, 50n), splits);
		expect(lines[0].amountMinor).toBe(-3050n);
		expect(lines.reduce((s, l) => s + l.amountMinor, 0n)).toBe(-4600n);
	});

	it('keeps an uncategorised unsplit transaction as one uncategorised line', () => {
		expect(effectiveLines(txn(29760n), [])).toEqual([
			{ categoryId: null, amountMinor: 29760n, splitId: null }
		]);
	});
});

describe('matchingLineTotal', () => {
	const splits = [
		{ id: 's1', amountMinor: -3000n, categoryId: 'groceries', sort: 0 },
		{ id: 's2', amountMinor: -1550n, categoryId: 'household', sort: 1 }
	];

	it('counts only the matching share of a split transaction', () => {
		expect(matchingLineTotal(txn(-4550n), splits, 'groceries')).toBe(-3000n);
	});

	it('counts the whole transaction when no category filter is applied', () => {
		expect(matchingLineTotal(txn(-4550n), splits, null)).toBe(-4550n);
	});

	it('counts nothing when no line matches', () => {
		expect(matchingLineTotal(txn(-4550n), splits, 'salary')).toBe(0n);
	});

	it('counts the whole of an unsplit transaction that matches', () => {
		expect(matchingLineTotal(txn(-4550n, 'groceries'), [], 'groceries')).toBe(-4550n);
	});
});
