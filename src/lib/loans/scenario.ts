// SPDX-License-Identifier: AGPL-3.0-or-later
import type { DayCount } from '$lib/loans';
import type { FixationPeriod, LoanTerms } from '$lib/loans/amortise';
import type { YearAgg } from '$lib/loans/simulate';
import { formatMinor } from '$lib/money';

export interface ScenarioPayload {
	terms: {
		owedMinor: string;
		owedAsOfMonth: string;
		dayCount: string;
		accrualStyle: string;
		paymentDay: number;
	};
	periods: {
		startsOn: string;
		endsOn: string | null;
		annualRatePct: number;
		paymentMinor: string;
	}[];
}

/** Boundary suggested for a new fixation. Historical period ends must never
 * become the default for a currently open loan: that would turn an ordinary
 * save into a rewrite of already-booked history. */
export function defaultFixationStart(periods: ScenarioPayload['periods'], today: string): string {
	const current = periods
		.filter(
			(period) => period.startsOn <= today && (period.endsOn === null || period.endsOn > today)
		)
		.sort((a, b) => (a.startsOn < b.startsOn ? 1 : -1))[0];
	return current?.endsOn && current.endsOn > today ? current.endsOn : today;
}

export function decodeScenarioPayload(payload: ScenarioPayload): {
	terms: LoanTerms;
	periods: FixationPeriod[];
} {
	return {
		terms: {
			owedMinor: BigInt(payload.terms.owedMinor),
			owedAsOfMonth: payload.terms.owedAsOfMonth,
			dayCount: payload.terms.dayCount as DayCount,
			accrualStyle: payload.terms.accrualStyle as 'payment' | 'calendar',
			paymentDay: payload.terms.paymentDay
		},
		periods: payload.periods.map((period) => ({
			...period,
			paymentMinor: BigInt(period.paymentMinor)
		}))
	};
}

export function comparisonBars(years: YearAgg[], currency: string) {
	return years.map((year) => ({
		year: year.year,
		interest: Number(year.interestMinor),
		principal: Number(year.principalMinor),
		interestLabel: formatMinor(year.interestMinor, currency),
		principalLabel: formatMinor(year.principalMinor, currency)
	}));
}
