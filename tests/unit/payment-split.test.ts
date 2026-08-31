// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { FixationPeriod } from '$lib/loans/amortise';
import { splitLoanPayment, type LoanPaymentEvent, type SplitLoan } from '$lib/loans/payment-split';

// The mortgage the amortisation tests use: 4 120 000 CZK owed as of August
// 2026, fixed at 4.29% with a 35 000 instalment — a month of interest on that
// balance is 14 729 Kč.
const PERIODS: FixationPeriod[] = [
	{ startsOn: '2024-03-01', endsOn: '2029-03-01', annualRatePct: 4.29, paymentMinor: 3500000n }
];

const LOAN: SplitLoan = {
	owedMinor: 412000000n,
	owedOn: '2026-08-01',
	periods: PERIODS,
	today: '2026-08-20'
};

/** An instalment on the loan above, with only what each case varies spelled out. */
function payment(over: Partial<LoanPaymentEvent> = {}): LoanPaymentEvent {
	return {
		happenedOn: '2026-08-15',
		kind: 'payment',
		amountMinor: 3500000n,
		interestMinor: null,
		...over
	};
}

describe('splitLoanPayment', () => {
	// What the bank printed is not something a projection gets to correct.
	it('takes the interest the statement stated over anything it could derive', () => {
		expect(splitLoanPayment(payment({ interestMinor: 1400000n }), LOAN)).toEqual({
			interestMinor: 1400000n,
			principalMinor: 2100000n,
			basis: 'stated'
		});
	});

	// An extra repayment rides on top of the instalment that already carried the
	// month's interest, so all of it comes off the debt.
	it('books an unsplit extra repayment as principal in full', () => {
		expect(
			splitLoanPayment(payment({ kind: 'extra_payment', amountMinor: 10000000n }), LOAN)
		).toEqual({ interestMinor: 0n, principalMinor: 10000000n, basis: 'extra' });
	});

	it('reads the schedule for a month the projection reaches', () => {
		expect(splitLoanPayment(payment(), LOAN)).toEqual({
			interestMinor: 1472900n,
			principalMinor: 2027100n,
			basis: 'amortised'
		});
	});

	// Under Česká spořitelna's structure a month's interest is charged on its
	// last day and collected with the NEXT instalment, so the row's own
	// interestMinor belongs to next month's payment. This instalment carried
	// 15 219.97 — what it did not repay — not the 15 146.90 the row books.
	it('reads a calendar-style month as the instalment minus what it repaid', () => {
		expect(
			splitLoanPayment(payment(), { ...LOAN, accrualStyle: 'calendar', dayCount: 'act/360' })
		).toEqual({ interestMinor: 1521997n, principalMinor: 1978003n, basis: 'amortised' });
	});

	// No projection reaches a month before the balance was observed, so the
	// newest statement on or before it is what the interest is charged on.
	it('charges an older month on the balance last stated for it', () => {
		const split = splitLoanPayment(payment({ happenedOn: '2026-05-15' }), {
			...LOAN,
			balances: [{ happenedOn: '2026-04-30', amountMinor: 420000000n }]
		});

		expect(split).toEqual({
			interestMinor: 1501500n,
			principalMinor: 1998500n,
			basis: 'balance-event'
		});
	});

	// With no statement the current balance stands in, and the answer says so:
	// the debt was larger back then, so this understates what the month cost.
	it('falls back to the current balance, and names that basis', () => {
		expect(splitLoanPayment(payment({ happenedOn: '2026-05-15' }), LOAN)).toEqual({
			interestMinor: 1472900n,
			principalMinor: 2027100n,
			basis: 'current-balance'
		});
	});

	// A statement that disagrees with the payment it was taken from is still not
	// grounds for reporting a negative amount of debt repaid.
	it('never charges more interest than the payment carried', () => {
		expect(splitLoanPayment(payment({ interestMinor: 4000000n }), LOAN)).toEqual({
			interestMinor: 3500000n,
			principalMinor: 0n,
			basis: 'stated'
		});
	});

	// Before the first fixation the loan had no rate, and a made-up rate would
	// be a made-up cost on the household's chart.
	it('leaves a month with no rate on record unsplit', () => {
		expect(splitLoanPayment(payment({ happenedOn: '2024-01-15' }), LOAN)).toBeNull();
	});
});
