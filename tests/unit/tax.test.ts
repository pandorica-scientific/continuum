import { describe, expect, it } from 'vitest';
import { effectiveRatePct, payslipYearTotal, taxSeries } from '$lib/tax';

const stmt = (over: Partial<Parameters<typeof taxSeries>[0][number]> = {}) => ({
	personId: 'p1',
	personName: 'Jana',
	year: 2025,
	country: 'CZ',
	currency: 'CZK',
	grossIncomeMinor: 100000000n,
	taxPaidMinor: 15000000n,
	...over
});

describe('effectiveRatePct', () => {
	it('is tax over gross as a percentage', () => {
		expect(effectiveRatePct(100000000n, 15000000n)).toBeCloseTo(15, 5);
	});

	it('is null when gross is zero, rather than dividing by it', () => {
		expect(effectiveRatePct(0n, 15000000n)).toBeNull();
	});

	it('is zero when no tax was paid', () => {
		expect(effectiveRatePct(100000000n, 0n)).toBe(0);
	});

	it('keeps two decimal places without passing the ratio through a float', () => {
		// 1/3 as a rate: 33.33, not 33.333333…
		expect(effectiveRatePct(300000000n, 100000000n)).toBe(33.33);
	});
});

describe('payslipYearTotal', () => {
	const slips = [
		{ personId: 'p1', periodMonth: '2025-01', amountMinor: 5000000n },
		{ personId: 'p1', periodMonth: '2025-02', amountMinor: 5000000n },
		{ personId: 'p2', periodMonth: '2025-03', amountMinor: 9900000n },
		{ personId: 'p1', periodMonth: '2024-11', amountMinor: 4000000n },
		{ personId: 'p1', periodMonth: '2025-04', amountMinor: null }
	];

	it('sums one person one year, skipping slips without an amount', () => {
		expect(payslipYearTotal(slips, 'p1', 2025)).toEqual({ totalMinor: 10000000n, months: 2 });
	});

	it('does not borrow another person or another year', () => {
		expect(payslipYearTotal(slips, 'p2', 2025).totalMinor).toBe(9900000n);
		expect(payslipYearTotal(slips, 'p1', 2024).totalMinor).toBe(4000000n);
	});

	it('is zero when nothing matches', () => {
		expect(payslipYearTotal(slips, 'nobody', 2025)).toEqual({ totalMinor: 0n, months: 0 });
	});
});

describe('taxSeries', () => {
	it('keeps a person’s two countries as two separate series', () => {
		const series = taxSeries([stmt(), stmt({ country: 'PL', currency: 'PLN' })]);
		expect(series).toHaveLength(2);
		expect(series.map((s) => s.key).sort()).toEqual(['p1|CZ', 'p1|PL']);
	});

	it('makes four series from two people in two countries', () => {
		const series = taxSeries([
			stmt(),
			stmt({ country: 'PL', currency: 'PLN' }),
			stmt({ personId: 'p2', personName: 'Jan' }),
			stmt({ personId: 'p2', personName: 'Jan', country: 'PL', currency: 'PLN' })
		]);
		expect(series).toHaveLength(4);
	});

	it('orders a series’ points by year and carries the derived rate', () => {
		const series = taxSeries([stmt({ year: 2025 }), stmt({ year: 2023 })]);
		expect(series[0].points.map((p) => p.year)).toEqual([2023, 2025]);
		expect(series[0].points[0].ratePct).toBeCloseTo(15, 5);
	});

	it('labels a series as person and country', () => {
		expect(taxSeries([stmt()])[0].label).toBe('Jana · CZ');
	});
});
