import { describe, expect, it } from 'vitest';
import type { FixationPeriod, LoanTerms } from '$lib/loans/amortise';
import {
	aggregateByYear,
	anchorMonthFor,
	applyFixation,
	applyRepayment,
	project,
	summarize
} from '$lib/loans/simulate';

const terms: LoanTerms = {
	owedMinor: 100_000_00n,
	owedAsOfMonth: '2026-01',
	dayCount: '30/360',
	accrualStyle: 'payment',
	paymentDay: 15
};
const periods: FixationPeriod[] = [
	{ startsOn: '2026-01-01', endsOn: null, annualRatePct: 6, paymentMinor: 20_000_00n }
];

describe('applyRepayment', () => {
	it('re-anchors at the repayment month when the instalment is still to come', () => {
		// paymentDay is 15, so a repayment on the 10th precedes it.
		const t = applyRepayment(terms, { date: '2026-06-10', amountMinor: 30_000_00n });
		expect(t.owedMinor).toBe(70_000_00n);
		expect(t.owedAsOfMonth).toBe('2026-06');
	});

	it('starts next month when this month has already been collected', () => {
		// The projection books an instalment for its own anchor month, so
		// anchoring on June after the 15th replays a payment the balance already
		// reflects — the debt-free month and total interest both come out wrong.
		const t = applyRepayment(terms, { date: '2026-06-20', amountMinor: 30_000_00n });
		expect(t.owedMinor).toBe(70_000_00n);
		expect(t.owedAsOfMonth).toBe('2026-07');
	});

	it('rolls the year over at December', () => {
		expect(applyRepayment(terms, { date: '2026-12-20', amountMinor: 1_00n }).owedAsOfMonth).toBe(
			'2027-01'
		);
	});

	it('derives the same anchor the loans screen derives from a stored date', () => {
		// Both paths go through anchorMonthFor, so the preview and the chart
		// drawn after saving cannot disagree — they used to, because only the
		// preview applied the payment-day skip.
		for (const date of ['2026-06-10', '2026-06-15', '2026-06-20', '2026-12-31']) {
			expect(applyRepayment(terms, { date, amountMinor: 1_00n }).owedAsOfMonth).toBe(
				anchorMonthFor(date, terms.paymentDay)
			);
		}
	});

	it('anchorMonthFor treats a missing payment day as the first', () => {
		expect(anchorMonthFor('2026-06-01', null)).toBe('2026-06');
		expect(anchorMonthFor('2026-06-02', null)).toBe('2026-07');
		expect(anchorMonthFor('2026-06-02', undefined)).toBe('2026-07');
	});

	it('does not skip a month when the repayment lands on the payment day', () => {
		expect(applyRepayment(terms, { date: '2026-06-15', amountMinor: 1_00n }).owedAsOfMonth).toBe(
			'2026-06'
		);
	});

	it("prefers the bank's stated balance and never goes negative", () => {
		expect(
			applyRepayment(terms, {
				date: '2026-06-10',
				amountMinor: 30_000_00n,
				balanceAfterMinor: 68_500_00n
			}).owedMinor
		).toBe(68_500_00n);
		expect(applyRepayment(terms, { date: '2026-06-10', amountMinor: 999_999_00n }).owedMinor).toBe(
			0n
		);
	});
});

describe('applyFixation', () => {
	it('closes the running period at the new start and appends the new one', () => {
		const next = applyFixation(periods, {
			startsOn: '2027-01-01',
			endsOn: '2032-01-01',
			annualRatePct: 4,
			paymentMinor: 25_000_00n
		});
		expect(next).toHaveLength(2);
		expect(next[0].endsOn).toBe('2027-01-01');
		expect(next[1].annualRatePct).toBe(4);
	});

	it('leaves periods that already ended untouched', () => {
		const closed: FixationPeriod[] = [
			{ startsOn: '2020-01-01', endsOn: '2025-01-01', annualRatePct: 2, paymentMinor: 1n }
		];
		const next = applyFixation(closed, {
			startsOn: '2026-01-01',
			endsOn: null,
			annualRatePct: 5,
			paymentMinor: 2n
		});
		expect(next[0].endsOn).toBe('2025-01-01');
	});

	// The 2029 row is a follow-on the bank has already agreed. Dropping it made
	// the preview hide the fact that saving would destroy it.
	it('keeps a later agreed period and closes the new one where it begins', () => {
		const scheduled: FixationPeriod[] = [
			{ startsOn: '2026-01-01', endsOn: '2029-01-01', annualRatePct: 2, paymentMinor: 1n },
			{ startsOn: '2029-01-01', endsOn: null, annualRatePct: 8, paymentMinor: 3n }
		];

		const next = applyFixation(scheduled, {
			startsOn: '2027-01-01',
			endsOn: null,
			annualRatePct: 4,
			paymentMinor: 2n
		});

		expect(next).toEqual([
			{ startsOn: '2026-01-01', endsOn: '2027-01-01', annualRatePct: 2, paymentMinor: 1n },
			{ startsOn: '2027-01-01', endsOn: '2029-01-01', annualRatePct: 4, paymentMinor: 2n },
			{ startsOn: '2029-01-01', endsOn: null, annualRatePct: 8, paymentMinor: 3n }
		]);
	});
});

describe('project and summarize', () => {
	it('a repayment brings the debt-free month forward and cuts total interest', () => {
		const before = project(terms, periods);
		const after = project(
			applyRepayment(terms, { date: '2026-02-01', amountMinor: 50_000_00n }),
			periods
		);
		expect(before.summary.debtFreeMonth).not.toBeNull();
		expect(after.summary.debtFreeMonth! < before.summary.debtFreeMonth!).toBe(true);
		expect(after.summary.totalInterestMinor < before.summary.totalInterestMinor).toBe(true);
	});

	it('yearly aggregation preserves the monthly totals', () => {
		const { rows, years } = project(terms, periods);
		const monthly = summarize(rows).totalInterestMinor;
		const yearly = years.reduce((s, y) => s + y.interestMinor, 0n);
		expect(yearly).toBe(monthly);
		expect(aggregateByYear([]).length).toBe(0);
	});

	it('a paid-off loan projects to an empty schedule', () => {
		const { rows, summary } = project({ ...terms, owedMinor: 0n }, periods);
		expect(rows).toHaveLength(0);
		expect(summary.debtFreeMonth).toBeNull();
	});
});
