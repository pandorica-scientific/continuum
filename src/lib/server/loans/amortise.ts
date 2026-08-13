// Amortisation with fixation periods. Pure functions over minor units so the
// bookkeeping rule — interest is booked per fixation period, a re-fix never
// rewrites history — is enforceable by unit tests.

export interface FixationPeriod {
	startDate: string; // ISO date
	endDate: string | null; // null = open-ended
	annualRatePct: number;
}

export interface LoanTerms {
	owedMinor: bigint;
	/** The month `owedMinor` is valid for, as YYYY-MM. */
	owedAsOfMonth: string;
	paymentMinor: bigint;
}

export interface MonthRow {
	month: string; // YYYY-MM
	interestMinor: bigint;
	principalMinor: bigint;
	owedAfterMinor: bigint;
	annualRatePct: number;
}

function nextMonth(month: string): string {
	const [y, m] = month.split('-').map(Number);
	const date = new Date(Date.UTC(y, m - 1 + 1, 1));
	return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The rate in force for a given month: the period containing its first day. */
export function rateForMonth(periods: FixationPeriod[], month: string): number | null {
	const day = `${month}-01`;
	const sorted = [...periods].sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
	let current: FixationPeriod | null = null;
	for (const period of sorted) {
		if (period.startDate <= day && (period.endDate === null || day < period.endDate)) {
			current = period;
		}
	}
	if (current) return current.annualRatePct;
	// Before the first period or in a gap: use the closest earlier period, else
	// the first — a loan always has *some* rate.
	const before = sorted.filter((p) => p.startDate <= day);
	if (before.length > 0) return before[before.length - 1].annualRatePct;
	return sorted[0]?.annualRatePct ?? null;
}

/**
 * Walk the schedule month by month from the known balance until `toMonth`
 * (inclusive) or payoff. Interest each month uses the fixation period in
 * force for that month.
 */
export function amortise(loan: LoanTerms, periods: FixationPeriod[], toMonth: string): MonthRow[] {
	const rows: MonthRow[] = [];
	let owed = loan.owedMinor;
	let month = loan.owedAsOfMonth;
	// Hard bound of 100 years protects against a payment below the interest.
	for (let i = 0; i < 1200 && month <= toMonth && owed > 0n; i++) {
		const rate = rateForMonth(periods, month);
		if (rate === null) break;
		const interest = BigInt(Math.round(Number(owed) * (rate / 100 / 12)));
		const principal = loan.paymentMinor - interest >= owed ? owed : loan.paymentMinor - interest;
		owed -= principal > 0n ? principal : 0n;
		rows.push({
			month,
			interestMinor: interest,
			principalMinor: principal > 0n ? principal : 0n,
			owedAfterMinor: owed,
			annualRatePct: rate
		});
		month = nextMonth(month);
	}
	return rows;
}

/** Total interest booked in a calendar year, split by deductibility caller-side. */
export function interestForYear(loan: LoanTerms, periods: FixationPeriod[], year: number): bigint {
	const rows = amortise(loan, periods, `${year}-12`);
	return rows
		.filter((r) => r.month.startsWith(String(year)))
		.reduce((sum, r) => sum + r.interestMinor, 0n);
}

/** The year the balance reaches zero at current payments, or null if never. */
export function debtFreeYear(loan: LoanTerms, periods: FixationPeriod[]): number | null {
	let owed = loan.owedMinor;
	let month = loan.owedAsOfMonth;
	for (let i = 0; i < 1200 && owed > 0n; i++) {
		const rate = rateForMonth(periods, month);
		if (rate === null) return null;
		const interest = BigInt(Math.round(Number(owed) * (rate / 100 / 12)));
		const principal = loan.paymentMinor - interest;
		if (principal <= 0n) return null; // payment does not even cover interest
		owed -= principal >= owed ? owed : principal;
		if (owed <= 0n) return Number(month.slice(0, 4));
		month = nextMonth(month);
	}
	return null;
}
