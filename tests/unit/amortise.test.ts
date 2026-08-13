import { describe, expect, it } from 'vitest';
import {
	amortise,
	debtFreeYear,
	interestForYear,
	rateForMonth,
	type FixationPeriod,
	type LoanTerms
} from '$lib/server/loans/amortise';

// A Karlín-like mortgage: 4 120 000 CZK owed, 35 000/month, 4.29% fixed to
// March 2029, then a re-fix at 5.5%.
const LOAN: LoanTerms = {
	owedMinor: 412000000n,
	owedAsOfMonth: '2026-08',
	paymentMinor: 3500000n
};

const PERIODS: FixationPeriod[] = [
	{ startDate: '2024-03-01', endDate: '2029-03-01', annualRatePct: 4.29 },
	{ startDate: '2029-03-01', endDate: null, annualRatePct: 5.5 }
];

describe('rateForMonth', () => {
	it('picks the period containing the month', () => {
		expect(rateForMonth(PERIODS, '2026-08')).toBe(4.29);
		expect(rateForMonth(PERIODS, '2029-02')).toBe(4.29);
		expect(rateForMonth(PERIODS, '2029-03')).toBe(5.5);
	});
	it('falls back to the nearest earlier period in gaps', () => {
		const gappy: FixationPeriod[] = [
			{ startDate: '2020-01-01', endDate: '2022-01-01', annualRatePct: 2 },
			{ startDate: '2023-01-01', endDate: null, annualRatePct: 3 }
		];
		expect(rateForMonth(gappy, '2022-06')).toBe(2);
	});
});

describe('amortise', () => {
	it('first month books interest at the fixed rate', () => {
		const [first] = amortise(LOAN, PERIODS, '2026-08');
		// 4 120 000 × 4.29%/12 = 14 729 Kč
		expect(first.interestMinor).toBe(1472900n);
		expect(first.principalMinor).toBe(3500000n - 1472900n);
		expect(first.owedAfterMinor).toBe(412000000n - first.principalMinor);
	});

	it('a re-fix changes the split from the fix month without touching history', () => {
		const rows = amortise(LOAN, PERIODS, '2029-04');
		const feb = rows.find((r) => r.month === '2029-02')!;
		const mar = rows.find((r) => r.month === '2029-03')!;
		expect(feb.annualRatePct).toBe(4.29);
		expect(mar.annualRatePct).toBe(5.5);
		// Same balances, higher rate → more interest booked in March.
		expect(Number(mar.interestMinor)).toBeGreaterThan(Number(feb.interestMinor) * 1.2);
		// Recomputing a longer horizon must not change already-booked months.
		const again = amortise(LOAN, PERIODS, '2035-12');
		expect(again.find((r) => r.month === '2029-02')).toEqual(feb);
	});

	it('the final payment never overshoots the balance', () => {
		const small: LoanTerms = {
			owedMinor: 500000n,
			owedAsOfMonth: '2026-01',
			paymentMinor: 200000n
		};
		const rows = amortise(
			small,
			[{ startDate: '2020-01-01', endDate: null, annualRatePct: 6 }],
			'2027-12'
		);
		const last = rows[rows.length - 1];
		expect(last.owedAfterMinor).toBe(0n);
		const totalPrincipal = rows.reduce((s, r) => s + r.principalMinor, 0n);
		expect(totalPrincipal).toBe(500000n);
	});
});

describe('interestForYear', () => {
	it('books a full calendar year of interest', () => {
		const interest2027 = interestForYear(LOAN, PERIODS, 2027);
		// Roughly 4.29% on ~4M declining balance ≈ 165–172k Kč.
		expect(Number(interest2027) / 100).toBeGreaterThan(160000);
		expect(Number(interest2027) / 100).toBeLessThan(175000);
	});
});

describe('debtFreeYear', () => {
	it('finds the payoff year', () => {
		const year = debtFreeYear(LOAN, PERIODS);
		expect(year).not.toBeNull();
		expect(year!).toBeGreaterThan(2035);
		expect(year!).toBeLessThan(2050);
	});
	it('returns null when the payment cannot cover interest', () => {
		const bad: LoanTerms = {
			owedMinor: 412000000n,
			owedAsOfMonth: '2026-08',
			paymentMinor: 100000n
		};
		expect(debtFreeYear(bad, PERIODS)).toBeNull();
	});
});
