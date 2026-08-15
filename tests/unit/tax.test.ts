import { describe, expect, it } from 'vitest';
import { effectiveRatePct, payslipYearTotal, payslipYearTotalConverted, taxSeries } from '$lib/tax';
import { saveStatement } from '$lib/server/tax';

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

describe('payslipYearTotalConverted', () => {
	it('converts each payslip at its own month before summing', () => {
		const seen: string[] = [];
		const result = payslipYearTotalConverted(
			[
				{ personId: 'p1', periodMonth: '2025-01', amountMinor: 100n, currency: 'EUR' },
				{ personId: 'p1', periodMonth: '2025-02', amountMinor: 200n, currency: 'CZK' }
			],
			'p1',
			2025,
			'CZK',
			(amount, from, to, day) => {
				seen.push(`${from}|${to}|${day}`);
				return from === to ? amount : amount * 25n;
			}
		);

		expect(result).toEqual({ totalMinor: 2700n, months: 2 });
		expect(seen).toEqual(['EUR|CZK|2025-01-01', 'CZK|CZK|2025-02-01']);
	});
});

describe('taxSeries', () => {
	it('keeps a person’s two countries as two separate series', () => {
		const series = taxSeries([stmt(), stmt({ country: 'PL', currency: 'PLN' })]);
		expect(series).toHaveLength(2);
		expect(series.map((s) => s.key).sort()).toEqual(['p1|CZ|CZK', 'p1|PL|PLN']);
	});

	it('does not merge a country’s statements across a currency change', () => {
		const series = taxSeries([
			stmt({ year: 2024, currency: 'CZK' }),
			stmt({ year: 2025, currency: 'EUR' })
		]);

		expect(series.map((s) => s.key).sort()).toEqual(['p1|CZ|CZK', 'p1|CZ|EUR']);
		expect(series.map((s) => s.currency).sort()).toEqual(['CZK', 'EUR']);
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

	it('exposes chart values in the statement currency major-unit scale', () => {
		const [jpy] = taxSeries([
			stmt({ currency: 'JPY', grossIncomeMinor: 1500n, taxPaidMinor: 300n })
		]);
		const [kwd] = taxSeries([
			stmt({ currency: 'KWD', grossIncomeMinor: 1500n, taxPaidMinor: 300n })
		]);

		expect(jpy.points[0]).toMatchObject({ grossMajor: 1500, taxMajor: 300 });
		expect(kwd.points[0]).toMatchObject({ grossMajor: 1.5, taxMajor: 0.3 });
	});
});

describe('tax statement currency validation', () => {
	it('rejects a display symbol instead of storing it as a currency code', async () => {
		expect(
			await saveStatement({
				personId: 'person-a',
				year: 2025,
				country: 'CZ',
				currency: 'Kč',
				grossIncomeMinor: 100n,
				taxPaidMinor: 10n,
				documentId: null,
				note: null,
				lines: []
			})
		).toEqual({ ok: false, status: 400, message: 'Use a three-letter currency code.' });
	});
});
