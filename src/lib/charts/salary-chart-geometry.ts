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
	equityUnvestedMinor: string;
	grossMonths: number;
	netMonths: number;
	netComplete: boolean;
	deltaPct: number | null;
	/** The same change with equity counted in — the package, not the pay. */
	compDeltaPct: number | null;
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
): { base: bigint; bonus: bigint; equity: bigint; equityUnvested: bigint; net: bigint | null } {
	const base = BigInt(row.baseTotalMinor);
	const bonus = BigInt(row.bonusTotalMinor);
	const net = BigInt(row.netTotalMinor);
	// Only the part not already inside gross, to avoid drawing that money twice.
	// What the employer put through a payslip is necessarily vested, so it comes
	// off the vested half and never off what is still to come.
	const unvested = BigInt(row.equityUnvestedMinor);
	const equity = BigInt(row.equityTotalMinor) - BigInt(row.equityOnPayslipMinor) - unvested;

	if (mode === 'total') {
		return { base, bonus, equity, equityUnvested: unvested, net: row.netMonths > 0 ? net : null };
	}

	const months = BigInt(Math.max(row.grossMonths, 1));
	return {
		base: base / months,
		bonus: bonus / months,
		equity: equity / months,
		equityUnvested: unvested / months,
		net: row.netAvgMinor === null ? null : BigInt(row.netAvgMinor)
	};
}

/** The tallest bar in the set, for scaling every year against one ceiling. */
export function ceilingFor(rows: SerialisedSalaryYear[], mode: SalaryMode): bigint {
	return rows.reduce((most, row) => {
		const { base, bonus, equity, equityUnvested } = barValues(row, mode);
		const total = base + bonus + equity + equityUnvested;
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
): {
	value: number;
	fill: string;
	stroke: string;
	kind: 'base' | 'bonus' | 'equity' | 'equity-unvested';
}[] {
	const v = barValues(row, mode);
	return [
		{
			// Topmost, and drawn faintest: this is the half that has not happened
			// yet and reprices every time a close is fetched.
			kind: 'equity-unvested' as const,
			value: Number(v.equityUnvested),
			fill: 'url(#salary-equity-unvested)',
			stroke: 'var(--purple)'
		},
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
