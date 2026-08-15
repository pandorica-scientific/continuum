import { describe, expect, it } from 'vitest';
import {
	allocateAtIndex,
	propertyFinancials,
	ratioFromPercent,
	ratioFromValues,
	sharesForLoan,
	tryRatioFromPercent,
	type MinorConverter,
	type Ratio
} from '$lib/property/finance';

const eurToCzk: MinorConverter = (amount, from, to) => {
	if (from === to) return amount;
	if (from === 'EUR' && to === 'CZK') return amount * 25n;
	throw new Error(`unexpected conversion ${from} -> ${to}`);
};

const allocateAll = (amountMinor: bigint, shares: Ratio[]) =>
	shares.map((_, index) => allocateAtIndex(amountMinor, shares, index));

const HALVES: Ratio[] = [
	{ numerator: 1n, denominator: 2n },
	{ numerator: 1n, denominator: 2n }
];

describe('property loan allocation', () => {
	it('derives an exact proportional ratio from converted property values', () => {
		expect(ratioFromValues(300n, [300n, 700n])).toEqual({ numerator: 3n, denominator: 10n });
	});

	it('does not allocate one hundred percent to every property when all values are zero', () => {
		expect(ratioFromValues(0n, [0n, 0n])).toEqual({ numerator: 0n, denominator: 1n });
		expect(ratioFromValues(0n, [0n])).toEqual({ numerator: 1n, denominator: 1n });
	});

	it('parses a decimal percentage without floating-point money arithmetic', () => {
		expect(ratioFromPercent('12.5')).toEqual({ numerator: 1n, denominator: 8n });
	});
});

describe('percentage grammar', () => {
	it('accepts the forms the property page reads back', () => {
		expect(tryRatioFromPercent('100')).toEqual({ numerator: 1n, denominator: 1n });
		expect(tryRatioFromPercent('62.500')).toEqual({ numerator: 5n, denominator: 8n });
		expect(tryRatioFromPercent(' 37,5 ')).toEqual({ numerator: 3n, denominator: 8n });
	});

	it('rejects what numeric(6,3) would store as a different share', () => {
		// A fourth decimal is rounded by the column, so accepting it here would
		// let validation approve one ratio and the page read back another.
		expect(tryRatioFromPercent('12.3456')).toBeNull();
	});

	it('rejects numeric forms that Number would silently accept', () => {
		for (const raw of ['0x10', '1e1', 'Infinity', '', '-5', '0', '101']) {
			expect(tryRatioFromPercent(raw)).toBeNull();
		}
	});
});

describe('cumulative share allocation', () => {
	// Rounding each half on its own reports 51 twice for an odd amount, so the
	// two properties together claim one minor unit more debt than the loan has.
	it('splits an odd amount in half without inventing a minor unit', () => {
		expect(allocateAll(101n, HALVES)).toEqual([51n, 50n]);
	});

	it('keeps every allocation summing to the whole across awkward divisions', () => {
		const thirds: Ratio[] = Array.from({ length: 3 }, () => ({
			numerator: 1n,
			denominator: 3n
		}));
		expect(allocateAll(100n, thirds)).toEqual([33n, 34n, 33n]);

		for (const amount of [1n, 7n, 99n, 101n, 1_000_003n]) {
			for (const shares of [HALVES, thirds]) {
				const parts = allocateAll(amount, shares);
				expect(parts.reduce((sum, part) => sum + part, 0n)).toBe(amount);
			}
		}
	});

	it('never allocates more than the shares cover when they stop short of the whole', () => {
		const partial: Ratio[] = [
			{ numerator: 1n, denominator: 4n },
			{ numerator: 1n, denominator: 4n }
		];
		const parts = allocateAll(101n, partial);
		expect(parts.reduce((sum, part) => sum + part, 0n)).toBe(51n);
	});

	it('splits a negative balance without inventing a minor unit either', () => {
		expect(allocateAll(-101n, HALVES)).toEqual([-51n, -50n]);
	});
});

describe('shares for one loan', () => {
	it('reads explicit percentages and divides the rest by value', () => {
		expect(
			sharesForLoan([
				{ propertyId: 'a', sharePct: '62.500', valueMinor: 0n },
				{ propertyId: 'b', sharePct: '37.500', valueMinor: 0n }
			])
		).toEqual([
			{ numerator: 5n, denominator: 8n },
			{ numerator: 3n, denominator: 8n }
		]);

		expect(
			sharesForLoan([
				{ propertyId: 'a', sharePct: null, valueMinor: 300n },
				{ propertyId: 'b', sharePct: null, valueMinor: 700n }
			])
		).toEqual([
			{ numerator: 3n, denominator: 10n },
			{ numerator: 7n, denominator: 10n }
		]);
	});

	// Legacy rows predate the rule that a loan is either all-explicit or
	// all-automatic. Dividing the automatic link by every linked value would
	// give it 50% beside an 80% sibling and allocate 130% of the mortgage.
	it('gives an automatic link only what the explicit shares leave', () => {
		const shares = sharesForLoan([
			{ propertyId: 'a', sharePct: '80', valueMinor: 5_000_000n },
			{ propertyId: 'b', sharePct: null, valueMinor: 5_000_000n }
		]);

		expect(shares).toEqual([
			{ numerator: 4n, denominator: 5n },
			{ numerator: 1n, denominator: 5n }
		]);
		expect(allocateAll(4_000_000n, shares).reduce((sum, part) => sum + part, 0n)).toBe(4_000_000n);
	});

	it('splits the remainder between several automatic links by value', () => {
		expect(
			sharesForLoan([
				{ propertyId: 'a', sharePct: '50', valueMinor: 0n },
				{ propertyId: 'b', sharePct: null, valueMinor: 300n },
				{ propertyId: 'c', sharePct: null, valueMinor: 700n }
			])
		).toEqual([
			{ numerator: 1n, denominator: 2n },
			{ numerator: 3n, denominator: 20n },
			{ numerator: 7n, denominator: 20n }
		]);
	});

	// ratioFromPercent throws, and this runs inside a page load.
	it('falls back to automatic instead of failing the page on an unreadable share', () => {
		expect(
			sharesForLoan([
				{ propertyId: 'a', sharePct: '900', valueMinor: 300n },
				{ propertyId: 'b', sharePct: null, valueMinor: 700n }
			])
		).toEqual([
			{ numerator: 3n, denominator: 10n },
			{ numerator: 7n, denominator: 10n }
		]);
	});
});

describe('property financials', () => {
	it('aggregates every linked loan after converting and allocating each one', () => {
		const result = propertyFinancials(
			{
				day: '2026-08-15',
				propertyValueMinor: 1_000_000n,
				propertyCurrency: 'CZK',
				loans: [
					{
						id: 'loan-eur',
						principalMinor: 20_000n,
						owedMinor: 10_000n,
						paymentMinor: 1_000n,
						currency: 'EUR',
						shares: HALVES,
						shareIndex: 0
					},
					{
						id: 'loan-czk',
						principalMinor: 150_000n,
						owedMinor: 100_000n,
						paymentMinor: 10_000n,
						currency: 'CZK',
						shares: [{ numerator: 1n, denominator: 1n }],
						shareIndex: 0
					}
				],
				rentMinor: 200_000n,
				billsMinor: 50_000n
			},
			eurToCzk
		);

		expect(result).toEqual({
			loans: [
				{
					id: 'loan-eur',
					principalPropertyMinor: 250_000n,
					owedPropertyMinor: 125_000n,
					paymentPropertyMinor: 12_500n
				},
				{
					id: 'loan-czk',
					principalPropertyMinor: 150_000n,
					owedPropertyMinor: 100_000n,
					paymentPropertyMinor: 10_000n
				}
			],
			owedPropertyMinor: 225_000n,
			paymentPropertyMinor: 22_500n,
			equityMinor: 775_000n,
			cashFlowMinor: 127_500n
		});
	});

	// One mortgage over two flats is the ordinary household case, so the two
	// property views must together report exactly the loan's own balance.
	it('reports a shared mortgage as the whole debt across both properties', () => {
		const owedForIndex = (shareIndex: number) =>
			propertyFinancials(
				{
					day: '2026-08-15',
					propertyValueMinor: 5_000_000n,
					propertyCurrency: 'CZK',
					loans: [
						{
							id: 'shared',
							principalMinor: 4_000_001n,
							owedMinor: 3_333_333n,
							paymentMinor: 25_001n,
							currency: 'CZK',
							shares: HALVES,
							shareIndex
						}
					],
					rentMinor: 0n,
					billsMinor: 0n
				},
				eurToCzk
			);

		const first = owedForIndex(0);
		const second = owedForIndex(1);
		expect(first.owedPropertyMinor + second.owedPropertyMinor).toBe(3_333_333n);
		expect(first.loans[0].principalPropertyMinor + second.loans[0].principalPropertyMinor).toBe(
			4_000_001n
		);
		expect(first.paymentPropertyMinor + second.paymentPropertyMinor).toBe(25_001n);
	});
});
