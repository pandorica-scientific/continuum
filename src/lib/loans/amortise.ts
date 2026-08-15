// Amortisation with fixation periods. Pure functions over minor units so the
// bookkeeping rule — interest is booked per fixation period, a re-fix never
// rewrites history — is enforceable by unit tests.
//
// The day-count convention is per loan, because banks differ. To find yours,
// compare one statement row's printed interest against each convention —
// they diverge by hundreds of CZK on a mortgage-sized balance in a 31-day
// month, and by over a thousand in February.
//
// The payment lives on the fixation period: when a fixation ends the bank
// re-quotes rate and payment together. Projections beyond the last period
// with a known payment reuse that payment and are estimates, not bookings —
// actual history belongs in loan_event rows.

import { DAY_COUNTS, type DayCount } from '$lib/loans';

export { DAY_COUNTS, type DayCount };
void DAY_COUNTS; // re-exported for server callers

export interface FixationPeriod {
	startDate: string; // ISO date
	endDate: string | null; // null = open-ended
	annualRatePct: number;
	/** monthly payment agreed for this period */
	paymentMinor: bigint;
}

export type AccrualStyle = 'payment' | 'calendar';

export interface LoanTerms {
	owedMinor: bigint;
	/** The month `owedMinor` is valid for, as YYYY-MM (before that month's payment). */
	owedAsOfMonth: string;
	/** how the bank accrues interest; defaults to 30/360 */
	dayCount?: DayCount;
	/**
	 * payment:  interest accrues payment-date to payment-date on one balance
	 * calendar: interest accrues daily over the calendar month on the actual
	 *           balance (which steps on the payment day), is charged on the
	 *           month's last day, and is collected with the NEXT instalment —
	 *           Česká spořitelna's structure, verified to the haléř
	 */
	accrualStyle?: AccrualStyle;
	/** day of month the payment falls on; defaults to the 1st */
	paymentDay?: number;
	/** calendar style: last month's charged interest, collected by the anchor
	 * month's instalment. Approximated from the balance when absent. */
	dueInterestMinor?: bigint;
}

function daysInMonth(month: string): number {
	const [y, m] = month.split('-').map(Number);
	return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Calendar-month charge on the daily balance: `before` until the payment day
 * (exclusive), `after` for the rest of the month.
 */
function calendarCharge(
	before: bigint,
	after: bigint,
	month: string,
	annualRatePct: number,
	dayCount: DayCount,
	paymentDay: number
): bigint {
	const rate = annualRatePct / 100;
	if (dayCount === '30/360') {
		return BigInt(Math.round(Number(before) * (rate / 12)));
	}
	const total = daysInMonth(month);
	const d1 = Math.min(Math.max(paymentDay - 1, 0), total);
	const d2 = total - d1;
	const basis = dayCount === 'act/365' ? 365 : 360;
	const weighted = d1 * Number(before) + d2 * Number(after);
	return BigInt(Math.round((weighted * rate) / basis));
}

/** Days between this month's payment and the next (clamped to month length). */
function daysInPaymentPeriod(month: string, paymentDay: number): number {
	const [y, m] = month.split('-').map(Number);
	const clamp = (year: number, monthIndex: number) => {
		const last = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
		return Math.min(paymentDay, last);
	};
	const start = Date.UTC(y, m - 1, clamp(y, m - 1));
	const end = Date.UTC(y, m, clamp(y, m));
	return Math.round((end - start) / 86400000);
}

/** One period's interest on a balance under the loan's convention. */
export function interestForMonth(
	owedMinor: bigint,
	annualRatePct: number,
	month: string,
	dayCount: DayCount = '30/360',
	paymentDay = 1
): bigint {
	const rate = annualRatePct / 100;
	let fraction: number;
	if (dayCount === '30/360') {
		fraction = 1 / 12;
	} else {
		const days = daysInPaymentPeriod(month, paymentDay);
		fraction = days / (dayCount === 'act/365' ? 365 : 360);
	}
	return BigInt(Math.round(Number(owedMinor) * rate * fraction));
}

export interface MonthRow {
	month: string; // YYYY-MM
	interestMinor: bigint;
	/** negative when the payment does not cover interest (balance grows) */
	principalMinor: bigint;
	owedAfterMinor: bigint;
	annualRatePct: number;
}

export function nextMonth(month: string): string {
	const [y, m] = month.split('-').map(Number);
	const date = new Date(Date.UTC(y, m - 1 + 1, 1));
	return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * The fixation period in force for a given month: the one containing its
 * first day, else the closest earlier period (a re-fix gap keeps the old
 * terms until the new ones start). Months before the first period have no
 * terms — the loan did not exist; callers get null, never an invented rate.
 */
export function periodForMonth(periods: FixationPeriod[], month: string): FixationPeriod | null {
	const day = `${month}-01`;
	const sorted = [...periods].sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
	if (sorted.length === 0 || day < sorted[0].startDate) return null;
	let current: FixationPeriod | null = null;
	for (const period of sorted) {
		if (period.startDate <= day && (period.endDate === null || day < period.endDate)) {
			current = period;
		}
	}
	if (current) return current;
	const before = sorted.filter((p) => p.startDate <= day);
	return before[before.length - 1] ?? null;
}

/** Back-compat helper: the annual rate for a month, or null before the loan. */
export function rateForMonth(periods: FixationPeriod[], month: string): number | null {
	return periodForMonth(periods, month)?.annualRatePct ?? null;
}

/**
 * Walk the schedule month by month from the known balance until `toMonth`
 * (inclusive) or payoff. Each month uses the rate AND payment of the fixation
 * period in force. When the payment does not cover the interest, the balance
 * grows — negative amortisation is reported, never silently clamped.
 */
export function amortise(loan: LoanTerms, periods: FixationPeriod[], toMonth: string): MonthRow[] {
	if (loan.accrualStyle === 'calendar') return amortiseCalendar(loan, periods, toMonth);
	const rows: MonthRow[] = [];
	let owed = loan.owedMinor;
	let month = loan.owedAsOfMonth;
	// Hard bound of 100 years protects against runaway negative amortisation.
	for (let i = 0; i < 1200 && month <= toMonth && owed > 0n; i++) {
		const period = periodForMonth(periods, month);
		if (!period) break;
		const interest = interestForMonth(
			owed,
			period.annualRatePct,
			month,
			loan.dayCount,
			loan.paymentDay
		);
		let principal = period.paymentMinor - interest;
		if (principal > owed) principal = owed; // final payment never overshoots
		owed -= principal;
		rows.push({
			month,
			interestMinor: interest,
			principalMinor: principal,
			owedAfterMinor: owed,
			annualRatePct: period.annualRatePct
		});
		month = nextMonth(month);
	}
	return rows;
}

/**
 * Calendar-style walk: this month's instalment collects LAST month's charged
 * interest, the remainder is principal; then the month's own charge accrues
 * on the daily balance and rolls into next month's instalment. Each row books
 * the interest charged in that month, matching the bank statement and the
 * tax-year attribution.
 */
function amortiseCalendar(loan: LoanTerms, periods: FixationPeriod[], toMonth: string): MonthRow[] {
	const rows: MonthRow[] = [];
	let owed = loan.owedMinor;
	let month = loan.owedAsOfMonth;
	const paymentDay = loan.paymentDay ?? 1;
	const firstPeriod = periodForMonth(periods, month);
	if (!firstPeriod) return rows;
	// Seed: last month's charge; approximate on the anchor balance when the
	// caller does not know it (a few CZK off in the first projected month).
	let due =
		loan.dueInterestMinor ??
		calendarCharge(
			owed,
			owed,
			month,
			firstPeriod.annualRatePct,
			loan.dayCount ?? '30/360',
			paymentDay
		);

	for (let i = 0; i < 1200 && month <= toMonth && owed > 0n; i++) {
		const period = periodForMonth(periods, month);
		if (!period) break;
		let principal = period.paymentMinor - due;
		if (principal > owed) principal = owed;
		const after = owed - principal;
		const charge = calendarCharge(
			owed,
			after,
			month,
			period.annualRatePct,
			loan.dayCount ?? '30/360',
			paymentDay
		);
		rows.push({
			month,
			interestMinor: charge,
			principalMinor: principal,
			owedAfterMinor: after,
			annualRatePct: period.annualRatePct
		});
		owed = after;
		due = charge;
		month = nextMonth(month);
	}
	return rows;
}

/**
 * Interest visible for a calendar year, projected forward from the known
 * balance. Honest about its blind spot: months of the year before
 * `owedAsOfMonth` cannot be computed without booked history (loan_event), so
 * the result carries `fromMonth` and the caller must say so. A fully-past
 * year returns null rather than a silent zero.
 */
export function interestForYear(
	loan: LoanTerms,
	periods: FixationPeriod[],
	year: number
): { interestMinor: bigint; fromMonth: string } | null {
	const anchorYear = Number(loan.owedAsOfMonth.slice(0, 4));
	if (year < anchorYear) return null; // history requires booked events
	const rows = amortise(loan, periods, `${year}-12`);
	const inYear = rows.filter((r) => r.month.startsWith(String(year)));
	if (inYear.length === 0) return null;
	return {
		interestMinor: inYear.reduce((sum, r) => sum + r.interestMinor, 0n),
		fromMonth: inYear[0].month
	};
}

/** The year the balance reaches zero at current terms, or null if never. */
export function debtFreeYear(loan: LoanTerms, periods: FixationPeriod[]): number | null {
	// Walk a century with the style-aware schedule; a growing balance (payment
	// below interest) shows up as the horizon never being reached.
	const anchorYear = Number(loan.owedAsOfMonth.slice(0, 4));
	const rows = amortise(loan, periods, `${anchorYear + 100}-12`);
	const last = rows[rows.length - 1];
	if (!last || last.owedAfterMinor > 0n) return null;
	return Number(last.month.slice(0, 4));
}
