// SPDX-License-Identifier: AGPL-3.0-or-later
// What a salary bar MEANS. Where it goes is `line.ts`.
//
// This file used to own the pixel geometry as well — a letterboxed viewBox
// shared with the tax chart, its own stacking arithmetic, its own change scale.
// v0.8.1 moved all of that into the one chart engine, which both screens now
// draw through. What is left is the part that is about salary rather than about
// SVG: which figure each mode measures, and how tall the tallest bar is.

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
): { base: bigint; bonus: bigint; net: bigint | null } {
	const base = BigInt(row.baseTotalMinor);
	const bonus = BigInt(row.bonusTotalMinor);
	const net = BigInt(row.netTotalMinor);

	if (mode === 'total') return { base, bonus, net: row.netMonths > 0 ? net : null };

	const months = BigInt(Math.max(row.grossMonths, 1));
	return {
		base: base / months,
		bonus: bonus / months,
		net: row.netAvgMinor === null ? null : BigInt(row.netAvgMinor)
	};
}

/** The tallest bar in the set, for scaling every year against one ceiling. */
export function ceilingFor(rows: SerialisedSalaryYear[], mode: SalaryMode): bigint {
	return rows.reduce((most, row) => {
		const { base, bonus } = barValues(row, mode);
		const total = base + bonus;
		return total > most ? total : most;
	}, 0n);
}

/**
 * One year's bar, as blocks from the foot up: bonus, then base above it.
 *
 * The other way round, the base's top edge was the top of the bar minus the
 * bonus — so a bonus that changed size every year moved the base's boundary
 * for a reason that had nothing to do with the base. Seated on the baseline
 * the bonus is read directly, and gross is still the whole bar.
 *
 * Net is NOT a block. It is what was left of that same gross rather than a
 * further amount stacked on it, so it crosses the bar as a tick.
 */
export function salaryBarSegments(
	row: SerialisedSalaryYear,
	mode: SalaryMode
): { value: number; fill: string; stroke: string; kind: 'base' | 'bonus' }[] {
	const v = barValues(row, mode);
	return [
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
