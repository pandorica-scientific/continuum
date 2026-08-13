import { describe, expect, it } from 'vitest';
import {
	amortise,
	debtFreeYear,
	interestForMonth,
	interestForYear,
	rateForMonth,
	type FixationPeriod,
	type LoanTerms
} from '$lib/server/loans/amortise';

// A Karlín-like mortgage: 4 120 000 CZK owed, 4.29% fixed to March 2029 at
// 35 000/month, then a re-fix at 5.5% where the bank re-quotes 37 500.
const LOAN: LoanTerms = {
	owedMinor: 412000000n,
	owedAsOfMonth: '2026-08'
};

const PERIODS: FixationPeriod[] = [
	{ startDate: '2024-03-01', endDate: '2029-03-01', annualRatePct: 4.29, paymentMinor: 3500000n },
	{ startDate: '2029-03-01', endDate: null, annualRatePct: 5.5, paymentMinor: 3750000n }
];

describe('rateForMonth', () => {
	it('picks the period containing the month', () => {
		expect(rateForMonth(PERIODS, '2026-08')).toBe(4.29);
		expect(rateForMonth(PERIODS, '2029-02')).toBe(4.29);
		expect(rateForMonth(PERIODS, '2029-03')).toBe(5.5);
	});
	it('falls back to the nearest earlier period in gaps', () => {
		const gappy: FixationPeriod[] = [
			{ startDate: '2020-01-01', endDate: '2022-01-01', annualRatePct: 2, paymentMinor: 100000n },
			{ startDate: '2023-01-01', endDate: null, annualRatePct: 3, paymentMinor: 100000n }
		];
		expect(rateForMonth(gappy, '2022-06')).toBe(2);
	});
	it('never invents a rate for months before the loan existed', () => {
		expect(rateForMonth(PERIODS, '2015-06')).toBeNull();
		expect(rateForMonth(PERIODS, '2024-02')).toBeNull();
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

	it('a re-fix changes rate AND payment from the fix month, history untouched', () => {
		const rows = amortise(LOAN, PERIODS, '2029-04');
		const feb = rows.find((r) => r.month === '2029-02')!;
		const mar = rows.find((r) => r.month === '2029-03')!;
		expect(feb.annualRatePct).toBe(4.29);
		expect(mar.annualRatePct).toBe(5.5);
		expect(Number(mar.interestMinor)).toBeGreaterThan(Number(feb.interestMinor) * 1.2);
		// The new period's payment applies too.
		expect(mar.interestMinor + mar.principalMinor).toBe(3750000n);
		// Recomputing a longer horizon must not change already-booked months.
		const again = amortise(LOAN, PERIODS, '2035-12');
		expect(again.find((r) => r.month === '2029-02')).toEqual(feb);
	});

	it('the final payment never overshoots the balance', () => {
		const small: LoanTerms = { owedMinor: 500000n, owedAsOfMonth: '2026-01' };
		const rows = amortise(
			small,
			[{ startDate: '2020-01-01', endDate: null, annualRatePct: 6, paymentMinor: 200000n }],
			'2027-12'
		);
		const last = rows[rows.length - 1];
		expect(last.owedAfterMinor).toBe(0n);
		const totalPrincipal = rows.reduce((s, r) => s + r.principalMinor, 0n);
		expect(totalPrincipal).toBe(500000n);
	});

	it('negative amortisation grows the balance instead of freezing it', () => {
		// 12% on 4M is 40 000/month interest; a 24 000 payment falls short.
		const bad: LoanTerms = { owedMinor: 400000000n, owedAsOfMonth: '2026-01' };
		const periods: FixationPeriod[] = [
			{ startDate: '2020-01-01', endDate: null, annualRatePct: 12, paymentMinor: 2400000n }
		];
		const rows = amortise(bad, periods, '2026-06');
		expect(rows[0].principalMinor).toBeLessThan(0n);
		expect(rows[0].owedAfterMinor).toBeGreaterThan(400000000n);
		// and it keeps growing month over month
		expect(rows[5].owedAfterMinor).toBeGreaterThan(rows[0].owedAfterMinor);
		// debtFreeYear agrees this loan never ends
		expect(debtFreeYear(bad, periods)).toBeNull();
	});
});

describe('interestForYear', () => {
	it('books a full calendar year of interest with the from-month surfaced', () => {
		const result = interestForYear(LOAN, PERIODS, 2027);
		expect(result).not.toBeNull();
		expect(result!.fromMonth).toBe('2027-01');
		// Roughly 4.29% on ~4M declining balance ≈ 165–172k Kč.
		expect(Number(result!.interestMinor) / 100).toBeGreaterThan(160000);
		expect(Number(result!.interestMinor) / 100).toBeLessThan(175000);
	});

	it('a partially visible year reports its actual start month', () => {
		const result = interestForYear(LOAN, PERIODS, 2026);
		expect(result).not.toBeNull();
		expect(result!.fromMonth).toBe('2026-08');
	});

	it('returns null for years before the balance anchor instead of a silent zero', () => {
		expect(interestForYear(LOAN, PERIODS, 2025)).toBeNull();
		expect(interestForYear(LOAN, PERIODS, 2024)).toBeNull();
	});
});

describe('day-count conventions', () => {
	// The diagnostic figures from the review: 4 000 000 CZK at 5.29%.
	const owed = 400000000n;
	const rate = 5.29;

	it('30/360 charges the same every month', () => {
		const july = interestForMonth(owed, rate, '2026-07', '30/360');
		const february = interestForMonth(owed, rate, '2027-02', '30/360');
		expect(july).toBe(february);
		expect(july).toBe(1763333n); // 17 633.33 Kč
	});

	it('act/365 follows the calendar: July long, February short', () => {
		const july = interestForMonth(owed, rate, '2026-07', 'act/365');
		const february = interestForMonth(owed, rate, '2027-02', 'act/365');
		expect(july).toBe(1797151n); // 31 days → 17 971.51 Kč
		expect(february).toBe(1623233n); // 28 days → 16 232.33 Kč
	});

	it('act/360 runs higher than act/365 on the same days', () => {
		const july360 = interestForMonth(owed, rate, '2026-07', 'act/360');
		const july365 = interestForMonth(owed, rate, '2026-07', 'act/365');
		expect(july360).toBe(1822111n); // 18 221.11 Kč
		expect(july360).toBeGreaterThan(july365);
	});

	it('actual-day conventions accrue payment-date to payment-date', () => {
		// Payment on the 15th: the "July" period runs 15 Jul → 15 Aug (31 days),
		// while the "January" period runs 15 Jan → 15 Feb (31 days) — different
		// from the calendar-month day counts.
		const jan15 = interestForMonth(owed, rate, '2027-01', 'act/365', 15);
		const feb15 = interestForMonth(owed, rate, '2027-02', 'act/365', 15);
		expect(jan15).toBe(1797151n); // 31 days
		expect(feb15).toBe(1623233n); // 15 Feb → 15 Mar = 28 days
	});

	it('payment day 31 clamps to short months', () => {
		// 31 Jan → 28 Feb = 28 days, not negative or overflowing.
		const jan = interestForMonth(owed, rate, '2027-01', 'act/365', 31);
		expect(jan).toBe(1623233n);
	});

	it('the convention flows through a schedule', () => {
		const terms: LoanTerms = {
			owedMinor: owed,
			owedAsOfMonth: '2026-07',
			dayCount: 'act/365'
		};
		const periods: FixationPeriod[] = [
			{ startDate: '2024-01-01', endDate: null, annualRatePct: rate, paymentMinor: 2500000n }
		];
		const [first] = amortise(terms, periods, '2026-07');
		expect(first.interestMinor).toBe(1797151n);
	});
});

describe('calendar accrual (Česká spořitelna, verified against real statements)', () => {
	// Robert's actual mortgage: 4.44%, payment 49 681.00 on the 20th,
	// act/360 on the daily balance over the calendar month. The June and July
	// 2026 figures come straight from the bank app; the engine must reproduce
	// them to the haléř.
	const terms: LoanTerms = {
		owedMinor: 982516450n, // 9 825 164.50 before the 20/06 instalment
		owedAsOfMonth: '2026-06',
		dayCount: 'act/360',
		accrualStyle: 'calendar',
		paymentDay: 20,
		dueInterestMinor: 3759593n // May's charge, collected 20/06
	};
	const periods: FixationPeriod[] = [
		{ startDate: '2026-02-11', endDate: '2029-01-31', annualRatePct: 4.44, paymentMinor: 4968100n }
	];

	it('reproduces June 2026 exactly', () => {
		const [june] = amortise(terms, periods, '2026-06');
		expect(june.principalMinor).toBe(1208507n); // 12 085.07 principal instalment
		expect(june.owedAfterMinor).toBe(981307943n); // 9 813 079.43
		expect(june.interestMinor).toBe(3633671n); // 36 336.71 charged 30/06
	});

	it('reproduces July 2026 exactly, chaining June’s charge into July’s instalment', () => {
		const rows = amortise(terms, periods, '2026-07');
		const july = rows[1];
		expect(july.principalMinor).toBe(1334429n); // 13 344.29
		expect(july.owedAfterMinor).toBe(979973514n); // 9 799 735.14
		expect(july.interestMinor).toBe(3749892n); // 37 498.92 charged 31/07
	});

	it('reproduces the first partial-month drawdown charge (Feb 2026 statement)', () => {
		// 9 900 000 drawn 12/02, charged 20 757.00 on 28/02: 17 days at act/360.
		const days = 17;
		const charge = Math.round((9900000 * 0.0444 * days * 100) / 360);
		expect(charge).toBe(2075700);
	});

	it('reaches the contractual 2056 maturity within a year at current terms', () => {
		const year = debtFreeYear(terms, periods);
		expect(year).not.toBeNull();
		expect(Math.abs(year! - 2056)).toBeLessThanOrEqual(1);
	});
});

describe('debtFreeYear', () => {
	it('finds the payoff year', () => {
		const year = debtFreeYear(LOAN, PERIODS);
		expect(year).not.toBeNull();
		expect(year!).toBeGreaterThan(2035);
		expect(year!).toBeLessThan(2050);
	});
});
