// The "value against money in" chart series. Benchmarks compound every real
// contribution from its own date — the honest comparison the design demands.

import { toMajor } from '$lib/money';

export interface Contribution {
	at: string; // ISO date
	amountMinor: bigint;
}

interface SnapshotPoint {
	day: string;
	valueMinor: bigint;
}

export interface SeriesPoint {
	month: string; // YYYY-MM
	moneyIn: number; // major units
	bench5: number;
	bench10: number;
	/** reconstructed account value: cash + book value of open positions —
	 * exact market value where a snapshot exists, at cost + realised between */
	actual: number | null;
	/** true where `actual` is a hard market value from a report */
	isSnapshot: boolean;
}

interface CashOp {
	at: string; // ISO datetime
	amountMinor: bigint;
	type?: string;
	positionId?: string | null;
}

interface PositionSpan {
	openedAt: string; // ISO datetime
	closedAt: string | null;
	purchaseValueMinor: bigint | null;
	id: string;
}

/**
 * Account value at cost, month by month: the running cash balance (every
 * broker cash operation) plus the purchase value of positions still open.
 * Realised gains, dividends and fees are all in the cash balance, so the
 * curve moves with every real event — only unrealised market movement waits
 * for a report snapshot.
 */
export function costValueSeries(
	ops: CashOp[],
	positions: PositionSpan[],
	purchaseByPosition: Map<string, bigint>,
	months: string[],
	currency = 'EUR'
): number[] {
	const sortedOps = [...ops].sort((a, b) => (a.at < b.at ? -1 : 1));
	let opIndex = 0;
	let cash = 0n;
	return months.map((month) => {
		const endOfMonth = `${month}-31T23:59:59Z`;
		while (opIndex < sortedOps.length && sortedOps[opIndex].at <= endOfMonth) {
			cash += sortedOps[opIndex].amountMinor;
			opIndex++;
		}
		let book = 0n;
		for (const position of positions) {
			if (position.openedAt > endOfMonth) continue;
			if (position.closedAt !== null && position.closedAt <= endOfMonth) continue;
			const purchase = position.purchaseValueMinor ?? purchaseByPosition.get(position.id) ?? 0n;
			book += purchase;
		}
		return toMajor(cash + book, currency);
	});
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
	snapshots: SnapshotPoint[],
	ops: CashOp[] = [],
	positions: PositionSpan[] = [],
	currency = 'EUR'
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

	// Open lots have no purchase value in the report — their Stock purchase
	// cash operations carry it (negative amounts, flipped to positive cost).
	const purchaseByPosition = new Map<string, bigint>();
	for (const op of ops) {
		if (op.type === 'Stock purchase' && op.positionId) {
			purchaseByPosition.set(
				op.positionId,
				(purchaseByPosition.get(op.positionId) ?? 0n) - op.amountMinor
			);
		}
	}
	const cost =
		ops.length > 0 ? costValueSeries(ops, positions, purchaseByPosition, months, currency) : null;

	let moneyIn = 0;
	let bench5 = 0;
	let bench10 = 0;
	let ci = 0;
	const out: SeriesPoint[] = [];
	months.forEach((month, index) => {
		// grow the benchmark pots one month
		bench5 *= monthlyRate(5);
		bench10 *= monthlyRate(10);
		// add this month's contributions to all three
		while (ci < contributions.length && contributions[ci].at.slice(0, 7) === month) {
			const amount = toMajor(contributions[ci].amountMinor, currency);
			moneyIn += amount;
			bench5 += amount;
			bench10 += amount;
			ci++;
		}
		// exact market value at report months, reconstructed cost value between
		const snapshot = snapshotByMonth.get(month);
		out.push({
			month,
			moneyIn,
			bench5,
			bench10,
			actual: snapshot !== undefined ? toMajor(snapshot, currency) : (cost?.[index] ?? null),
			isSnapshot: snapshot !== undefined
		});
	});
	return out;
}

/** Crude nominal annualised return from total money-in over the whole span. */
export function annualisedReturn(
	contributions: Contribution[],
	currentValueMinor: bigint,
	currency = 'EUR'
): number | null {
	if (contributions.length === 0) return null;
	const moneyIn = contributions.reduce((s, c) => s + toMajor(c.amountMinor, currency), 0);
	if (moneyIn <= 0) return null;
	const years = (Date.now() - new Date(contributions[0].at).getTime()) / (365.25 * 86400000);
	if (years < 0.5) return null;
	const ratio = toMajor(currentValueMinor, currency) / moneyIn;
	if (ratio <= 0) return null;
	return (Math.pow(ratio, 1 / years) - 1) * 100;
}
