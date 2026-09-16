// SPDX-License-Identifier: AGPL-3.0-or-later
// Filling in the other half of a re-fixation offer: a bank quotes a rate and
// a payment together, and this solves for whichever one the person hasn't
// entered yet.
//
// Both directions are solved against `amortise` rather than the textbook
// annuity formula, since the loan's own day-count convention, accrual style
// and payment day make a closed-form answer disagree by rounding.

import type { FixationPeriod, LoanTerms } from './amortise';
import { applyFixation, project } from './simulate';

/** Bisection is exact enough at 40 steps over any range these fields allow. */
const STEPS = 40;

function payoffMonth(
	terms: LoanTerms,
	periods: FixationPeriod[],
	startsOn: string,
	annualRatePct: number,
	paymentMinor: bigint
): string | null {
	const next = applyFixation(periods, {
		startsOn,
		endsOn: null,
		annualRatePct,
		paymentMinor
	});
	return project(terms, next).summary.debtFreeMonth;
}

/**
 * The monthly payment that clears the loan by `targetMonth` at this rate.
 *
 * Bisected on the payment: a larger payment never finishes later, so the
 * schedule is monotonic and the search cannot get lost. Returns null when the
 * term is unknown, or when even a payment the size of the debt cannot hit it.
 */
export function paymentForRate(
	terms: LoanTerms,
	periods: FixationPeriod[],
	startsOn: string,
	annualRatePct: number,
	targetMonth: string | null
): bigint | null {
	if (!targetMonth || terms.owedMinor <= 0n) return null;

	let low = 1n;
	// The whole debt in one instalment always clears it, so the answer is inside.
	const high0 = terms.owedMinor;
	// A schedule that never clears is *later* than any target — must not be
	// treated as sorting before every date.
	const fastest = payoffMonth(terms, periods, startsOn, annualRatePct, high0);
	if (fastest === null || fastest > targetMonth) return null;
	let high = high0;

	for (let step = 0; step < STEPS && low < high; step++) {
		const mid = (low + high) / 2n;
		if (mid <= low) break;
		const reached = payoffMonth(terms, periods, startsOn, annualRatePct, mid);
		// Too small a payment never clears at all, which reads as "later".
		if (reached === null || reached > targetMonth) low = mid;
		else high = mid;
	}

	return high;
}

/**
 * The annual rate that this payment implies, holding the same term.
 *
 * The inverse of the above, bisected on the rate: a higher rate never finishes
 * earlier. Returns null when no rate in the field's range fits — most often a
 * payment that does not even cover the interest, which never clears the debt at
 * any rate at all.
 */
export function rateForPayment(
	terms: LoanTerms,
	periods: FixationPeriod[],
	startsOn: string,
	paymentMinor: bigint,
	targetMonth: string | null
): number | null {
	if (!targetMonth || paymentMinor <= 0n || terms.owedMinor <= 0n) return null;

	// A zero rate is the fastest any payment can clear; if that is still too
	// slow — or never clears at all — the payment is too small and no rate will
	// rescue it.
	const fastest = payoffMonth(terms, periods, startsOn, 0, paymentMinor);
	if (fastest === null || fastest > targetMonth) return null;

	let low = 0;
	let high = 100;
	for (let step = 0; step < STEPS; step++) {
		const mid = (low + high) / 2;
		const reached = payoffMonth(terms, periods, startsOn, mid, paymentMinor);
		if (reached === null || reached > targetMonth) high = mid;
		else low = mid;
	}

	return Math.round(low * 100) / 100;
}
