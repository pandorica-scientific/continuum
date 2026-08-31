// SPDX-License-Identifier: AGPL-3.0-or-later
// Where every mark in the tax chart goes.
//
// Pulled out of the component so it can be tested without rendering. The rules
// below — the stacking order, the sub-pixel floor, the withheld stroke, the
// broken rate run — are the kind that regress silently in markup and are
// obvious in a test.

/** The viewBox the chart draws into. */
export const VIEW_W = 1000;
export const VIEW_H = 322;

/** The money panel: stacked bars live between these. */
export const MONEY_TOP = 26;
export const MONEY_BOTTOM = 222;

/** The rate strip, sharing the money panel's x axis rather than taking a second y. */
export const RATE_TOP_Y = 242;
export const RATE_BOTTOM_Y = 292;

/** The plot's horizontal extent. */
export const X_LEFT = 56;
export const X_RIGHT = 992;

/** The rate strip's ceiling, as a percentage. */
export const RATE_TOP_PCT = 25;

/**
 * Where a rotated axis title sits, as a percentage of the viewBox height.
 *
 * The centre of the band the title names, DERIVED from that band rather than
 * eyeballed. Both charts used to pin these at `top: 62%` and `top: 92%`, which
 * missed the money panel's centre (38.5%) and the rate strip's (82.9%) by
 * enough to read as misaligned — and would have drifted further the moment a
 * band moved.
 */
export const MONEY_TITLE_PCT = (((MONEY_TOP + MONEY_BOTTOM) / 2) * 100) / VIEW_H;
export const RATE_TITLE_PCT = (((RATE_TOP_Y + RATE_BOTTOM_Y) / 2) * 100) / VIEW_H;
/** The same, for the mode where the strip takes the whole height. */
export const TALL_TITLE_PCT = (((MONEY_TOP + RATE_BOTTOM_Y) / 2) * 100) / VIEW_H;

/** Below this height a segment gets no stroke. See `segments`. */
const STROKE_FLOOR = 2.5;
/** No segment is thinner than this, so a real filing is never invisible. */
const HAIRLINE = 0.8;

const MONEY_H = MONEY_BOTTOM - MONEY_TOP;

export interface SerialisedCountry {
	country: string;
	grossMinor: string;
	taxMinor: string;
	ratePct: number | null;
	/** The filed figures, untouched. The hover readout shows them beside the
	 * converted ones, so a reader can see what the statement actually said. */
	native?: { currency: string; grossMinor: string; taxMinor: string }[];
}

export interface SerialisedYear {
	year: number;
	grossMinor: string;
	taxMinor: string;
	ratePct: number | null;
	byCountry: SerialisedCountry[];
}

export interface Segment {
	country: string;
	token: string;
	y: number;
	height: number;
	/** Tax is hatched; what was kept is solid. */
	hatched: boolean;
	/** Whether this segment is thick enough to carry a border. */
	stroked: boolean;
}

/** The x centre of a year's slot. */
export function slotFor(index: number, count: number): number {
	const slot = (X_RIGHT - X_LEFT) / count;
	return X_LEFT + slot * index + slot / 2;
}

/** Bar width, capped so two years do not read as one block. */
export function barWidth(count: number): number {
	const slot = (X_RIGHT - X_LEFT) / count;
	return Math.min(58, slot * 0.5);
}

/**
 * One bar's segments, from the baseline up.
 *
 * The bar's full height IS that year's gross. Its foot is the tax, hatched,
 * stacked by jurisdiction; what stands above is what was kept, solid, in the
 * same jurisdiction order. Two bars side by side was tried and rejected — it
 * makes the reader measure one against the other to see the share, where a
 * single bar makes the share a proportion of one shape.
 *
 * Two rules protect the small numbers:
 *
 * - Every segment is at least a hairline tall, so a real filing two orders
 *   below the rest is present rather than rounded out of existence.
 * - A segment thinner than its own stroke gets NO stroke. A rect 0.4px tall
 *   with a 1px border paints a ~2px band at full strength, which would make a
 *   €174 slice the loudest thing in a €37 000 bar.
 */
export function segments(
	row: SerialisedYear,
	maxGrossMinor: bigint,
	hues: Map<string, string>
): Segment[] {
	if (maxGrossMinor <= 0n) return [];

	// Scaled in floating point only after the ratio is taken, so the arithmetic
	// that decides the height is exact.
	const scale = (minor: bigint) => (Number(minor) / Number(maxGrossMinor)) * MONEY_H;

	const out: Segment[] = [];
	let cursor = MONEY_BOTTOM;

	const place = (country: string, raw: number, hatched: boolean) => {
		const height = Math.max(HAIRLINE, raw);
		cursor -= height;
		out.push({
			country,
			token: hues.get(country) ?? '--series-r1',
			y: cursor,
			height,
			hatched,
			stroked: raw >= STROKE_FLOOR
		});
	};

	// All the tax first, then all the kept — so the hatched foot is one block
	// rather than interleaved with what was kept.
	for (const c of row.byCountry) place(c.country, scale(BigInt(c.taxMinor)), true);
	for (const c of row.byCountry) {
		const kept = BigInt(c.grossMinor) - BigInt(c.taxMinor);
		place(c.country, scale(kept > 0n ? kept : 0n), false);
	}
	return out;
}

/** Where the household's blended rate sits in the rate strip, per year. */
export function ratePoints(rows: SerialisedYear[]): { x: number; y: number }[] {
	return rows
		.map((row, i) => ({ row, i }))
		.filter(({ row }) => row.ratePct !== null)
		.map(({ row, i }) => ({
			x: slotFor(i, rows.length),
			y: rateY(row.ratePct!)
		}));
}

/**
 * One jurisdiction's rate line, split into unbroken runs.
 *
 * A run breaks where that jurisdiction has no filing. Bridging the gap would
 * assert a figure that does not exist — a year someone lived elsewhere is not a
 * year their rate quietly held steady. A single-year run draws a dot and no
 * line, which is the honest mark for one observation.
 */
export function rateRuns(
	rows: SerialisedYear[],
	country: string,
	band: [number, number] = [RATE_TOP_Y, RATE_BOTTOM_Y]
): { x: number; y: number; year: number }[][] {
	const runs: { x: number; y: number; year: number }[][] = [];
	let current: { x: number; y: number; year: number }[] = [];

	rows.forEach((row, i) => {
		const entry = row.byCountry.find((c) => c.country === country);
		if (!entry || entry.ratePct === null) {
			if (current.length > 0) runs.push(current);
			current = [];
			return;
		}
		current.push({ x: slotFor(i, rows.length), y: rateY(entry.ratePct, band), year: row.year });
	});
	if (current.length > 0) runs.push(current);
	return runs;
}

/**
 * A percentage's y, clamped to the ceiling.
 *
 * The band it maps into depends on the mode. In `stack` the rate is a companion
 * to the bars and lives in the strip beneath them; in `rate` it is the whole
 * subject, so it gets the plot — leaving the money panel drawn but empty would
 * hold two thirds of the chart for an axis labelled in a unit nothing on screen
 * is measured in.
 */
export function rateY(pct: number, band: [number, number] = [RATE_TOP_Y, RATE_BOTTOM_Y]): number {
	const [top, bottom] = band;
	const clamped = Math.min(Math.max(pct, 0), RATE_TOP_PCT);
	return bottom - (clamped / RATE_TOP_PCT) * (bottom - top);
}

/** The band the rate is drawn in, per mode. */
export function rateBand(mode: 'stack' | 'rate'): [number, number] {
	return mode === 'rate' ? [MONEY_TOP, RATE_BOTTOM_Y] : [RATE_TOP_Y, RATE_BOTTOM_Y];
}

/** The tallest year in the set, for scaling every bar against one ceiling. */
export function maxGross(rows: SerialisedYear[]): bigint {
	return rows.reduce((most, r) => {
		const gross = BigInt(r.grossMinor);
		return gross > most ? gross : most;
	}, 0n);
}
