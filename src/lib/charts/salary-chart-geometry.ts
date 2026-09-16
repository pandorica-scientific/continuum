// SPDX-License-Identifier: AGPL-3.0-or-later
// What a salary bar MEANS. Where it goes is `line.ts`.

export type SalaryMode = 'avg' | 'total' | 'change';

export interface SerialisedSalaryYear {
	year: number;
	/** Averages over the months that had one. */
	grossAvgMinor: string | null;
	netAvgMinor: string | null;
	/** The year added up. */
	grossTotalMinor: string;
	baseTotalMinor: string;
	bonusTotalMinor: string;
	netTotalMinor: string;
	equityTotalMinor: string;
	equityOnPayslipMinor: string;
	grossMonths: number;
	netMonths: number;
	netComplete: boolean;
	deltaPct: number | null;
	baseDeltaPct: number | null;
}

/**
 * Which figure each mode measures a bar against.
 *
 * `avg` divides the year's totals by its gross months, so a year with four
 * payslips is compared as a monthly rate rather than as a short year — that
 * comparison is the whole reason the mode exists.
 */
export function barValues(
	row: SerialisedSalaryYear,
	mode: SalaryMode
): { base: bigint; bonus: bigint; equity: bigint; net: bigint | null } {
	const base = BigInt(row.baseTotalMinor);
	const bonus = BigInt(row.bonusTotalMinor);
	const net = BigInt(row.netTotalMinor);
	// Only the vests not already inside gross, to avoid drawing that money twice.
	const equity = BigInt(row.equityTotalMinor) - BigInt(row.equityOnPayslipMinor);

	if (mode === 'total') return { base, bonus, equity, net: row.netMonths > 0 ? net : null };

	const months = BigInt(Math.max(row.grossMonths, 1));
	return {
		base: base / months,
		bonus: bonus / months,
		equity: equity / months,
		net: row.netAvgMinor === null ? null : BigInt(row.netAvgMinor)
	};
}

/** The tallest bar in the set, for scaling every year against one ceiling. */
export function ceilingFor(rows: SerialisedSalaryYear[], mode: SalaryMode): bigint {
	return rows.reduce((most, row) => {
		const { base, bonus, equity } = barValues(row, mode);
		const total = base + bonus + equity;
		return total > most ? total : most;
	}, 0n);
}

/**
 * One year's bar, as blocks from the foot up: bonus, then base above it — so a
 * bonus that changes size doesn't move the base's own boundary.
 *
 * Net is NOT a block: it's what was left of that same gross, so it crosses
 * the bar as a tick rather than stacking on top.
 */
export function salaryBarSegments(
	row: SerialisedSalaryYear,
	mode: SalaryMode
): { value: number; fill: string; stroke: string; kind: 'base' | 'bonus' | 'equity' }[] {
	const v = barValues(row, mode);
	return [
		{
			kind: 'equity' as const,
			value: Number(v.equity),
			fill: 'url(#salary-equity)',
			stroke: 'var(--purple)'
		},
		{
			kind: 'bonus' as const,
			value: Number(v.bonus),
			fill: 'url(#salary-bonus)',
			stroke: 'var(--orange)'
		},
		{
			kind: 'base' as const,
			value: Number(v.base),
			fill: 'url(#salary-base)',
			stroke: 'var(--series-health-soft)'
		}
	].filter((seg) => seg.value > 0);
}
