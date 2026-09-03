// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The line chart's geometry, kept pure: no DOM, no Svelte, no measuring.
 *
 * v0.8.1 puts a line chart behind four things that used to be bars or nothing
 * at all — salary change year on year, effective tax rate, the retirement pot
 * against what the target requires, and portfolio value against money in. One
 * engine rather than four, for the same reason `sankey.ts` exists: the axis
 * arithmetic is where the bugs live, and it can be tested without a browser.
 *
 * The renderer measures its own box and hands the width in; everything here is
 * a function of that width, so a chart is never drawn at a scaled stroke.
 */

/** One point. A null value breaks the line rather than drawing through zero. */
export interface LinePoint {
	value: number | null;
}

export interface LineSeries {
	key: string;
	/** A palette token name — `--blue`, `--series-health`. Never a literal. */
	colorVar: string;
	points: LinePoint[];
	/** Drawn dashed: a reference line rather than a measurement. */
	dashed?: boolean;
	/** The name printed at the end of the line, where a legend would otherwise go. */
	endLabel?: string;
}

export interface LineTick {
	value: number;
	/** Distance from the top of the box, in px. */
	y: number;
	label: string;
}

export interface PlacedPoint {
	x: number;
	y: number;
	value: number;
}

export interface PlacedSeries {
	key: string;
	colorVar: string;
	dashed: boolean;
	endLabel?: string;
	/** One `M…L…` run per unbroken stretch, so a null leaves a gap. */
	paths: string[];
	points: PlacedPoint[];
	/** Where to print `endLabel`, or null when the series is entirely null. */
	end: PlacedPoint | null;
}

/**
 * One block of a stacked bar, in data units.
 *
 * `fill` is whatever SVG will accept — `var(--teal)`, or `url(#hatch)` for a
 * pattern the caller has put in `defs`. The engine never invents a colour; it
 * only decides where the block goes.
 */
export interface BarSegment {
	value: number;
	fill: string;
	stroke?: string;
}

export interface BarSlot {
	segments: BarSegment[];
	/** A rule drawn across the whole bar — salary's net tick. */
	tick?: number | null;
}

export interface PlacedBarSegment {
	x: number;
	y: number;
	w: number;
	h: number;
	fill: string;
	stroke?: string;
}

export interface PlacedBar {
	x: number;
	w: number;
	segments: PlacedBarSegment[];
	/** Where the tick crosses, or null when this slot has none. */
	tickY: number | null;
}

export interface LineGeometry {
	width: number;
	height: number;
	plot: { x: number; y: number; w: number; h: number };
	ticks: LineTick[];
	series: PlacedSeries[];
	/** Present only when the data crosses zero, so a loss reads as one. */
	zeroY: number | null;
	/** X position of each slot, for the labels underneath. */
	slots: number[];
	/**
	 * Where a pointer over each slot counts, as [x, width].
	 *
	 * The whole pitch, not the bar: a reader aiming at the gap between two
	 * years is aiming at one of them, and a hit zone the width of the bar makes
	 * a chart with thin bars feel broken.
	 */
	hits: { x: number; w: number }[];
	/** Bars, when the caller passed any. Measured against `barTicks`. */
	bars: PlacedBar[];
	/** The bars' own axis. Empty when there are no bars. */
	barTicks: LineTick[];
	/** The y the bar band ends and the line band begins. */
	splitY: number;
}

export interface LineOptions {
	/** Turns a line-axis value into what is printed beside it. */
	format?: (value: number) => string;
	/** Turns a bar-axis value into what is printed beside it. */
	barFormat?: (value: number) => string;
	bars?: readonly BarSlot[];
	/**
	 * How much of the plot the bars get, 0–1.
	 *
	 * Two bands rather than two axes over one band, which is what the salary
	 * and tax charts have always drawn: money on top at its own scale, the
	 * percentage line beneath at its own. Sharing one band would mean a scale
	 * factor between koruna and percent that means nothing, and a line that
	 * crosses the bars wherever that factor happens to put it.
	 *
	 * 0 gives the whole plot to the lines, which is what the "Change" and
	 * "Effective rate" views are.
	 */
	barShare?: number;
	/** Widest a bar may be drawn, whatever the slot pitch allows. */
	maxBarWidth?: number;
}

/**
 * Room for a five-figure axis label on the left and an end label on the right.
 *
 * The right is the wider of the two because the label sits BESIDE the last
 * point rather than under it — a legend costs a whole row and makes the reader
 * match colours; a name at the end of the line costs nothing to read.
 */
export const PAD_LEFT = 56;
export const PAD_RIGHT = 96;
const PAD_TOP = 14;
const PAD_BOTTOM = 38;

/** Headroom above the tallest point, so a peak never touches the top edge. */
const HEADROOM = 0.12;

/**
 * No bar segment is thinner than this, so a real figure two orders below the
 * rest is present rather than rounded out of existence.
 *
 * Carried over from the tax and salary charts this engine replaces, where it
 * was written for a €174 filing inside a €37 000 bar.
 */
const HAIRLINE = 0.8;

/**
 * Below this height a segment gets no stroke.
 *
 * A rect 0.4px tall with a 1px border paints a ~2px band at full strength,
 * which would make the least significant number the loudest thing in the bar.
 */
const STROKE_FLOOR = 2.5;

/**
 * The next "round" number at or above `rough`.
 *
 * 1, 2, 2.5 and 5 times a power of ten — the steps a person reads without
 * doing arithmetic. 2.5 is in the list because without it a range of 240 jumps
 * from a step of 200 (two gridlines) to 500 (one).
 */
export function niceStep(rough: number): number {
	if (!(rough > 0)) return 1;
	const power = 10 ** Math.floor(Math.log10(rough));
	const scaled = rough / power;
	const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10;
	return step * power;
}

/**
 * A axis covering `min`–`max` on round steps, with headroom above.
 *
 * Always includes zero when the data is one-signed: a bar or a line measured
 * from an arbitrary floor exaggerates every change on it, which is the oldest
 * misleading chart there is.
 */
export function axisTicks(
	min: number,
	max: number,
	target = 5
): { min: number; max: number; ticks: number[] } {
	const lo = Math.min(0, min);
	const hi = Math.max(0, max);
	const span = hi - lo || 1;
	const step = niceStep((span * (1 + HEADROOM)) / Math.max(1, target));
	const from = Math.floor(lo / step) * step;
	const to = Math.ceil((hi + span * HEADROOM) / step) * step;
	const ticks: number[] = [];
	// A guard, not a limit: floating-point steps can otherwise run away.
	for (let v = from, i = 0; v <= to + step / 2 && i < 40; v += step, i++) {
		ticks.push(Number(v.toFixed(10)));
	}
	return { min: from, max: to === from ? from + step : to, ticks };
}

/**
 * Where each slot sits across the plot.
 *
 * The first and last points are inset rather than flush with the edges: a
 * point drawn on the axis is half clipped, and its end label would run off the
 * box. The inset is a share of the gap, capped, so two points do not sit in
 * the middle of a wide chart with nothing either side.
 */
function slotPositions(count: number, x: number, w: number): number[] {
	if (count <= 0) return [];
	if (count === 1) return [x + w / 2];
	const inset = Math.min(56, w / (count * 2));
	const usable = w - inset * 2;
	return Array.from({ length: count }, (_, i) => x + inset + (usable * i) / (count - 1));
}

/** Lay the series, and any bars, out in a box of `width` × `height` pixels. */
export function lineGeometry(
	series: readonly LineSeries[],
	width: number,
	height: number,
	options: LineOptions | ((value: number) => string) = {}
): LineGeometry {
	// A bare formatter is still accepted: the first callers passed one, and a
	// two-argument overload is cheaper than changing them to pass `{format}`.
	const opts: LineOptions = typeof options === 'function' ? { format: options } : options;
	const format = opts.format ?? ((v: number) => String(v));
	const bars = opts.bars ?? [];
	const barShare = bars.length ? Math.min(0.9, Math.max(0, opts.barShare ?? 0.7)) : 0;

	const plot = {
		x: PAD_LEFT,
		y: PAD_TOP,
		w: Math.max(0, width - PAD_LEFT - PAD_RIGHT),
		h: Math.max(0, height - PAD_TOP - PAD_BOTTOM)
	};
	// The bars take the top band, the lines the rest. A gap between them, so a
	// line at the top of its band does not touch the foot of a bar.
	const GAP = barShare > 0 ? 18 : 0;
	const barH = Math.max(0, plot.h * barShare - GAP);
	const splitY = plot.y + barH + GAP;
	const lineTop = splitY;
	const lineH = Math.max(0, plot.y + plot.h - lineTop);

	const count = Math.max(...series.map((s) => s.points.length), bars.length, 0);
	const values = series.flatMap((s) =>
		s.points.map((p) => p.value).filter((v): v is number => v !== null)
	);
	const axis = axisTicks(
		values.length ? Math.min(...values) : 0,
		values.length ? Math.max(...values) : 1
	);
	const span = axis.max - axis.min || 1;
	const toY = (value: number) => lineTop + lineH - ((value - axis.min) / span) * lineH;
	const slots = slotPositions(count, plot.x, plot.w);

	const placed: PlacedSeries[] = series.map((s) => {
		const points: PlacedPoint[] = [];
		const paths: string[] = [];
		let run: string[] = [];
		s.points.forEach((point, i) => {
			if (point.value === null) {
				// A gap, not a zero. Close the run so the line breaks here.
				if (run.length > 1) paths.push(run.join(''));
				run = [];
				return;
			}
			const x = slots[i] ?? plot.x;
			const y = toY(point.value);
			points.push({ x, y, value: point.value });
			run.push(`${run.length === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`);
		});
		if (run.length > 1) paths.push(run.join(''));
		return {
			key: s.key,
			colorVar: s.colorVar,
			dashed: s.dashed ?? false,
			endLabel: s.endLabel,
			paths,
			points,
			end: points.length ? points[points.length - 1] : null
		};
	});

	// The bars' own axis, over the top band.
	const barTotals = bars.map((slot) => slot.segments.reduce((sum, seg) => sum + seg.value, 0));
	const barAxis = barShare > 0 ? axisTicks(0, Math.max(...barTotals, 0), 4) : null;
	const barSpan = barAxis ? barAxis.max - barAxis.min || 1 : 1;
	const barY = (value: number) => plot.y + barH - ((value - (barAxis?.min ?? 0)) / barSpan) * barH;

	// A share of the pitch, capped. Flush bars read as a histogram, which says
	// the x axis is continuous — these are years, and they are not.
	const pitch = count > 1 ? Math.abs(slots[1] - slots[0]) : plot.w;
	const barWidth = Math.min(opts.maxBarWidth ?? 34, Math.max(2, pitch * 0.38));

	const placedBars: PlacedBar[] = bars.map((slot, i) => {
		const x = (slots[i] ?? plot.x) - barWidth / 2;
		// Stacked in pixels rather than in values, so the hairline floor below
		// cannot be undone by the next segment being placed from a running total
		// that ignored it. `cursor` walks UP from the foot of the band.
		let cursor = plot.y + barH;
		const segments = slot.segments.map((seg) => {
			const raw = Math.max(0, barY(0) - barY(seg.value));
			const h = Math.max(HAIRLINE, raw);
			cursor -= h;
			return {
				x,
				y: cursor,
				w: barWidth,
				h,
				fill: seg.fill,
				// A segment too thin to carry a border does not get one.
				stroke: raw >= STROKE_FLOOR ? seg.stroke : undefined
			};
		});
		return {
			x,
			w: barWidth,
			segments,
			tickY: slot.tick === null || slot.tick === undefined ? null : barY(slot.tick)
		};
	});

	return {
		width,
		height,
		plot,
		ticks: axis.ticks.map((value) => ({ value, y: toY(value), label: format(value) })),
		series: placed,
		// Only when the data actually straddles it: a zero line at the foot of a
		// chart of positive numbers is the axis drawn twice.
		zeroY: axis.min < 0 && axis.max > 0 ? toY(0) : null,
		slots,
		hits: slots.map((x) => ({ x: x - pitch / 2, w: pitch })),
		bars: placedBars,
		barTicks: barAxis
			? barAxis.ticks.map((value) => ({
					value,
					y: barY(value),
					label: (opts.barFormat ?? format)(value)
				}))
			: [],
		splitY
	};
}
