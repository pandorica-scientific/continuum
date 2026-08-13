// The "value against money in" chart series. Benchmarks compound every real
// contribution from its own date — the honest comparison the design demands.

export interface Contribution {
	at: string; // ISO date
	amountMinor: bigint;
}

export interface SnapshotPoint {
	day: string;
	valueMinor: bigint;
}

export interface SeriesPoint {
	month: string; // YYYY-MM
	moneyIn: number; // major units
	bench5: number;
	bench10: number;
	actual: number | null; // only where a snapshot exists
}

function monthsBetween(from: string, to: string): string[] {
	const out: string[] = [];
	let [y, m] = from.split('-').map(Number);
	const [endY, endM] = to.split('-').map(Number);
	while (y < endY || (y === endY && m <= endM)) {
		out.push(`${y}-${String(m).padStart(2, '0')}`);
		m++;
		if (m > 12) {
			m = 1;
			y++;
		}
	}
	return out;
}

export function buildSeries(
	contributions: Contribution[],
	snapshots: SnapshotPoint[]
): SeriesPoint[] {
	if (contributions.length === 0) return [];
	const firstMonth = contributions[0].at.slice(0, 7);
	const lastSnapshot = snapshots[snapshots.length - 1]?.day.slice(0, 7);
	const nowMonth = new Date().toISOString().slice(0, 7);
	const endMonth = lastSnapshot && lastSnapshot > nowMonth ? lastSnapshot : nowMonth;
	const months = monthsBetween(firstMonth, endMonth);

	const monthlyRate = (annualPct: number) => Math.pow(1 + annualPct / 100, 1 / 12);

	const snapshotByMonth = new Map<string, bigint>();
	for (const s of snapshots) snapshotByMonth.set(s.day.slice(0, 7), s.valueMinor);

	let moneyIn = 0;
	let bench5 = 0;
	let bench10 = 0;
	let ci = 0;
	const out: SeriesPoint[] = [];
	for (const month of months) {
		// grow the benchmark pots one month
		bench5 *= monthlyRate(5);
		bench10 *= monthlyRate(10);
		// add this month's contributions to all three
		while (ci < contributions.length && contributions[ci].at.slice(0, 7) === month) {
			const amount = Number(contributions[ci].amountMinor) / 100;
			moneyIn += amount;
			bench5 += amount;
			bench10 += amount;
			ci++;
		}
		out.push({
			month,
			moneyIn,
			bench5,
			bench10,
			actual: snapshotByMonth.has(month) ? Number(snapshotByMonth.get(month)) / 100 : null
		});
	}
	return out;
}

/** Crude nominal annualised return from total money-in over the whole span. */
export function annualisedReturn(
	contributions: Contribution[],
	currentValueMinor: bigint
): number | null {
	if (contributions.length === 0) return null;
	const moneyIn = contributions.reduce((s, c) => s + Number(c.amountMinor) / 100, 0);
	if (moneyIn <= 0) return null;
	const years = (Date.now() - new Date(contributions[0].at).getTime()) / (365.25 * 86400000);
	if (years < 0.5) return null;
	const ratio = Number(currentValueMinor) / 100 / moneyIn;
	if (ratio <= 0) return null;
	return (Math.pow(ratio, 1 / years) - 1) * 100;
}
