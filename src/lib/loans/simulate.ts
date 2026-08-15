// What-if helpers over the amortisation engine, shared by the server (the
// saved chart) and the browser (live previews while a repayment or new
// fixation is being typed — the chart becomes a tool for comparing offers).

import {
	amortise,
	nextMonth,
	type FixationPeriod,
	type LoanTerms,
	type MonthRow
} from './amortise';

// Far enough that any real loan reaches payoff or its last known rate first.
export const FAR_MONTH = '2126-01';

export interface YearAgg {
	year: string;
	interestMinor: bigint;
	principalMinor: bigint;
}

export function aggregateByYear(rows: MonthRow[]): YearAgg[] {
	const byYear = new Map<string, { interest: bigint; principal: bigint }>();
	for (const row of rows) {
		const y = row.month.slice(0, 4);
		const agg = byYear.get(y) ?? { interest: 0n, principal: 0n };
		agg.interest += row.interestMinor;
		agg.principal += row.principalMinor;
		byYear.set(y, agg);
	}
	return [...byYear.entries()].map(([year, agg]) => ({
		year,
		interestMinor: agg.interest,
		principalMinor: agg.principal
	}));
}

/**
 * The month a projection should start from, given the date a balance was
 * observed and the day the instalment is collected.
 *
 * The projection books an instalment for its own anchor month, so anchoring on
 * a month whose instalment the bank has already taken replays it: the balance
 * drops twice, and the debt-free month, the total interest and every year
 * aggregate inherit the error. Past the payment day, the projection starts next
 * month instead.
 *
 * This lives in one place because two callers need the same answer — the
 * what-if preview in `applyRepayment`, and the loans screen deriving an anchor
 * from the stored `owedAsOf`. When only the preview applied it, saving a
 * repayment produced a different chart from the one the decision was made on.
 */
export function anchorMonthFor(observedOn: string, paymentDay: number | null | undefined): string {
	const month = observedOn.slice(0, 7);
	const day = Number(observedOn.slice(8, 10));
	return Number.isFinite(day) && day > (paymentDay ?? 1) ? nextMonth(month) : month;
}

/** New terms after an extra repayment: the amount (or the bank's stated
 *  post-repayment balance) re-anchors the projection at that date. */
export function applyRepayment(
	terms: LoanTerms,
	input: { date: string; amountMinor: bigint; balanceAfterMinor?: bigint | null }
): LoanTerms {
	let owed = input.balanceAfterMinor ?? terms.owedMinor - input.amountMinor;
	if (owed < 0n) owed = 0n;
	return {
		...terms,
		owedMinor: owed,
		owedAsOfMonth: anchorMonthFor(input.date, terms.paymentDay)
	};
}

/** Periods after a re-fix from `startDate`: anything reaching past that date
 *  is closed there, the new period takes over. History never rewrites. */
export function applyFixation(
	periods: FixationPeriod[],
	input: { startDate: string; endDate: string | null; annualRatePct: number; paymentMinor: bigint }
): FixationPeriod[] {
	return [
		...periods.map((p) =>
			p.startDate < input.startDate && (p.endDate === null || p.endDate > input.startDate)
				? { ...p, endDate: input.startDate }
				: p
		),
		{
			startDate: input.startDate,
			endDate: input.endDate,
			annualRatePct: input.annualRatePct,
			paymentMinor: input.paymentMinor
		}
	];
}

export interface ScheduleSummary {
	/** month the balance reaches zero, or null if rates run out first */
	debtFreeMonth: string | null;
	totalInterestMinor: bigint;
}

export function summarize(rows: MonthRow[]): ScheduleSummary {
	let total = 0n;
	for (const row of rows) total += row.interestMinor;
	const last = rows.at(-1);
	return {
		debtFreeMonth: last && last.owedAfterMinor <= 0n ? last.month : null,
		totalInterestMinor: total
	};
}

export function project(terms: LoanTerms, periods: FixationPeriod[]) {
	const rows = terms.owedMinor > 0n ? amortise(terms, periods, FAR_MONTH) : [];
	return { rows, years: aggregateByYear(rows), summary: summarize(rows) };
}
