import { describe, expect, it } from 'vitest';
import { paymentForRate, rateForPayment } from '$lib/loans/derive';
import { project } from '$lib/loans/simulate';
import type { FixationPeriod, LoanTerms } from '$lib/loans/amortise';

// A twenty-year mortgage, mid-life, on one fixation.
const terms: LoanTerms = {
	owedMinor: 3_476_250_00n,
	owedAsOfMonth: '2026-08',
	dayCount: '30/360',
	accrualStyle: 'payment',
	paymentDay: 15
};
const periods: FixationPeriod[] = [
	{ startsOn: '2019-03-01', endsOn: null, annualRatePct: 4.44, paymentMinor: 21_500_00n }
];

const payoff = () => project(terms, periods).summary.debtFreeMonth!;

describe('deriving the other half of a re-fixation offer', () => {
	// The point is that neither field has to be typed blind: name a rate and the
	// payment that holds the current term follows, and the other way round.
	it('finds a payment that keeps the loan on its present term', () => {
		const target = payoff();
		const derived = paymentForRate(terms, periods, '2027-03-01', 5.5, target);

		expect(derived).not.toBeNull();
		const next: FixationPeriod[] = [
			{
				startsOn: '2019-03-01',
				endsOn: '2027-03-01',
				annualRatePct: 4.44,
				paymentMinor: 21_500_00n
			},
			{ startsOn: '2027-03-01', endsOn: null, annualRatePct: 5.5, paymentMinor: derived! }
		];
		expect(project(terms, next).summary.debtFreeMonth).toBe(target);
	});

	// A rate rise cannot be absorbed without paying more.
	it('asks for more each month when the rate goes up', () => {
		const target = payoff();
		const cheaper = paymentForRate(terms, periods, '2027-03-01', 3, target)!;
		const dearer = paymentForRate(terms, periods, '2027-03-01', 6, target)!;

		expect(dearer).toBeGreaterThan(cheaper);
	});

	it('finds the rate a given payment implies', () => {
		const target = payoff();
		const payment = paymentForRate(terms, periods, '2027-03-01', 5.5, target)!;
		const derived = rateForPayment(terms, periods, '2027-03-01', payment, target);

		expect(derived).not.toBeNull();
		// Round trip: the rate that produces this payment is the one we started
		// from, to the precision the field offers.
		expect(derived!).toBeCloseTo(5.5, 1);
	});

	// A payment below the interest never clears the debt, and no rate makes it.
	it('gives up rather than inventing a rate for an impossible payment', () => {
		expect(rateForPayment(terms, periods, '2027-03-01', 100_00n, payoff())).toBeNull();
	});

	it('gives up rather than inventing a payment with no term to hit', () => {
		expect(paymentForRate(terms, periods, '2027-03-01', 5.5, null)).toBeNull();
	});
});
