// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Where every mark in the salary chart goes.
//
// Shares the tax chart's panel constants deliberately: the two screens sit one
// tab apart in the same area, and a reader moving between them should not have
// to re-learn where the baseline is. Only the stacking differs — a tax bar
// splits tax against kept, a salary bar splits base against bonus.

import {
	MONEY_BOTTOM,
	MONEY_TITLE_PCT,
	MONEY_TOP,
	RATE_TITLE_PCT,
	TALL_TITLE_PCT,
	RATE_BOTTOM_Y,
	RATE_TOP_Y,
	X_LEFT,
	X_RIGHT,
	barWidth,
	slotFor
} from './tax-chart-geometry';

export {
	MONEY_BOTTOM,
	MONEY_TITLE_PCT,
	MONEY_TOP,
	RATE_BOTTOM_Y,
	RATE_TITLE_PCT,
	RATE_TOP_Y,
	TALL_TITLE_PCT,
	X_LEFT,
	X_RIGHT,
	barWidth,
	slotFor
};

export const VIEW_W = 1000;
export const VIEW_H = 322;

/** Below this height a segment gets no stroke — see `bars`. */
const STROKE_FLOOR = 2.5;
/** No segment is thinner than this, so a real bonus is never invisible. */
const HAIRLINE = 0.8;

const MONEY_H = MONEY_BOTTOM - MONEY_TOP;

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

export interface SalarySegment {
	kind: 'base' | 'bonus';
	y: number;
	height: number;
	stroked: boolean;
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
 * One bar's segments, from the baseline up: bonus first, then the base above it.
 *
 * The whole bar is GROSS — base plus bonus and nothing else. Net is not a
 * segment; it crosses the bar as a tick, because it is what was left of that
 * same gross rather than a further amount stacked on it.
 *
 * The two protections the tax chart uses apply unchanged: every segment gets at
 * least a hairline so a small bonus is present rather than rounded away, and a
 * segment thinner than its own stroke gets no stroke, because a 1px border on a
 * 0.4px rect paints a band at full strength on the least significant number.
 */
export function bars(
	row: SerialisedSalaryYear,
	mode: SalaryMode,
	ceiling: bigint
): SalarySegment[] {
	if (ceiling <= 0n) return [];
	const { base, bonus } = barValues(row, mode);
	const scale = (minor: bigint) => (Number(minor) / Number(ceiling)) * MONEY_H;

	const out: SalarySegment[] = [];
	let cursor = MONEY_BOTTOM;
	const place = (kind: 'base' | 'bonus', raw: number) => {
		if (raw <= 0) return;
		const height = Math.max(HAIRLINE, raw);
		cursor -= height;
		out.push({ kind, y: cursor, height, stroked: raw >= STROKE_FLOOR });
	};

	// Bonus at the foot, base above it. The other way round, the base's top edge
	// was the top of the bar minus the bonus — so a bonus that changed size every
	// year moved the base's boundary for a reason that had nothing to do with the
	// base. Seated on the baseline the bonus is read directly, and gross is still
	// the whole bar.
	place('bonus', scale(bonus));
	place('base', scale(base));
	return out;
}

/** Where the net figure sits on a bar, as a tick. Null when the year has none. */
export function netTickY(
	row: SerialisedSalaryYear,
	mode: SalaryMode,
	ceiling: bigint
): number | null {
	if (ceiling <= 0n) return null;
	const { net } = barValues(row, mode);
	if (net === null) return null;
	return MONEY_BOTTOM - (Number(net) / Number(ceiling)) * MONEY_H;
}

/** The percentage band the change lines are drawn in. */
export function changeBand(mode: SalaryMode): [number, number] {
	return mode === 'change' ? [MONEY_TOP, RATE_BOTTOM_Y] : [RATE_TOP_Y, RATE_BOTTOM_Y];
}

/**
 * A change percentage's y, on a scale that holds both directions.
 *
 * Symmetric around zero rather than starting at it: a pay cut is a real reading
 * and a floor at zero would draw it as no change at all.
 */
export function changeY(pct: number, span: number, band: [number, number]): number {
	const [top, bottom] = band;
	const clamped = Math.min(Math.max(pct, -span), span);
	const mid = (top + bottom) / 2;
	return mid - (clamped / span) * ((bottom - top) / 2);
}

/** The scale the change lines need, rounded out to a readable step. */
export function changeSpan(rows: SerialisedSalaryYear[]): number {
	const seen = rows.flatMap((r) =>
		[r.deltaPct, r.baseDeltaPct].filter((v): v is number => v !== null).map(Math.abs)
	);
	const peak = Math.max(5, ...seen);
	return Math.ceil(peak / 5) * 5;
}

/**
 * One series' change line, split into unbroken runs.
 *
 * A run breaks where the year has no comparable figure — the first year on
 * record, or a year that switched between gross and net evidence. Bridging that
 * gap would assert a change that was never computed.
 */
export function changeRuns(
	rows: SerialisedSalaryYear[],
	pick: (row: SerialisedSalaryYear) => number | null,
	span: number,
	band: [number, number]
): { x: number; y: number; year: number; pct: number }[][] {
	const runs: { x: number; y: number; year: number; pct: number }[][] = [];
	let current: { x: number; y: number; year: number; pct: number }[] = [];

	rows.forEach((row, i) => {
		const pct = pick(row);
		if (pct === null) {
			if (current.length > 0) runs.push(current);
			current = [];
			return;
		}
		current.push({
			x: slotFor(i, rows.length),
			y: changeY(pct, span, band),
			year: row.year,
			pct
		});
	});
	if (current.length > 0) runs.push(current);
	return runs;
}
