// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';
import {
	MONEY_BOTTOM,
	MONEY_TOP,
	RATE_TOP_PCT,
	X_LEFT,
	X_RIGHT,
	barWidth,
	maxGross,
	rateRuns,
	rateY,
	segments,
	slotFor
} from '$lib/charts/tax-chart-geometry';

const hues = new Map([
	['CZ', '--series-health-soft'],
	['PL', '--series-taxes-soft']
]);

/** A year whose PL filing is two orders below its CZ one — the real shape. */
const lopsided = {
	year: 2025,
	grossMinor: '10000000',
	taxMinor: '2000000',
	ratePct: 20,
	byCountry: [
		{ country: 'CZ', grossMinor: '9990000', taxMinor: '2000000', ratePct: 20 },
		{ country: 'PL', grossMinor: '10000', taxMinor: '0', ratePct: 0 }
	]
};

describe('slot geometry', () => {
	it('spreads the years across the plot, centred in their slots', () => {
		const first = slotFor(0, 8);
		const last = slotFor(7, 8);
		expect(first).toBeGreaterThan(X_LEFT);
		expect(last).toBeLessThan(X_RIGHT);
		expect(last - first).toBeCloseTo(((X_RIGHT - X_LEFT) / 8) * 7, 5);
	});

	it('centres a single year rather than pinning it to the left edge', () => {
		expect(slotFor(0, 1)).toBeCloseTo((X_LEFT + X_RIGHT) / 2, 5);
	});

	it('caps the bar width so two years do not read as one block', () => {
		expect(barWidth(2)).toBe(58);
		expect(barWidth(40)).toBeLessThan(58);
	});
});

describe('segment stacking', () => {
	it('puts every tax segment at the foot and every kept segment above it', () => {
		const out = segments(lopsided, 10_000_000n, hues);
		const tax = out.filter((s) => s.hatched);
		const kept = out.filter((s) => !s.hatched);
		// SVG y grows downward, so the foot of the bar has the LARGEST y.
		expect(Math.min(...tax.map((s) => s.y))).toBeGreaterThanOrEqual(
			Math.max(...kept.map((s) => s.y + s.height))
		);
	});

	it('scales the tallest year to fill the money panel', () => {
		// A year with no sub-pixel segment, so the hairline floor does not apply
		// and the bar is exactly the panel.
		const even = {
			year: 2025,
			grossMinor: '10000000',
			taxMinor: '2000000',
			ratePct: 20,
			byCountry: [{ country: 'CZ', grossMinor: '10000000', taxMinor: '2000000', ratePct: 20 }]
		};
		const total = segments(even, 10_000_000n, hues).reduce((sum, s) => sum + s.height, 0);
		expect(total).toBeCloseTo(MONEY_BOTTOM - MONEY_TOP, 5);
	});

	it('overshoots the panel only by what the hairline floor added', () => {
		// Clamping a 0.196px segment up to 0.8px makes the bar slightly taller
		// than its true share. That is the trade the floor buys, and it is
		// bounded: at most 0.8px per segment, not a proportional error.
		const out = segments(lopsided, 10_000_000n, hues);
		const total = out.reduce((sum, s) => sum + s.height, 0);
		expect(total).toBeGreaterThanOrEqual(MONEY_BOTTOM - MONEY_TOP);
		expect(total).toBeLessThan(MONEY_BOTTOM - MONEY_TOP + 0.8 * out.length);
	});

	it('starts the stack at the baseline', () => {
		const out = segments(lopsided, 10_000_000n, hues);
		expect(Math.max(...out.map((s) => s.y + s.height))).toBeCloseTo(MONEY_BOTTOM, 5);
	});

	it('gives a sub-pixel segment a floor height so it stays findable', () => {
		// PL kept is 10 000 of 10 000 000 — 0.196px unclamped.
		const out = segments(lopsided, 10_000_000n, hues);
		for (const s of out) expect(s.height).toBeGreaterThanOrEqual(0.8);
	});

	it('withholds the stroke from a segment thinner than its own border', () => {
		// A rect 0.4px tall with a 1px border paints a ~2px band at full
		// strength, making the least significant number the loudest pixels.
		const out = segments(lopsided, 10_000_000n, hues);
		const hairlines = out.filter((s) => s.height < 2.5);
		expect(hairlines.length).toBeGreaterThan(0);
		for (const s of hairlines) expect(s.stroked).toBe(false);
	});

	it('strokes a segment big enough to carry one', () => {
		const out = segments(lopsided, 10_000_000n, hues);
		const solid = out.filter((s) => s.height >= 2.5);
		expect(solid.length).toBeGreaterThan(0);
		for (const s of solid) expect(s.stroked).toBe(true);
	});

	it('scales a shorter year against the tallest, not against itself', () => {
		// Otherwise every bar would be full height and the chart would say every
		// year earned the same.
		const half = {
			year: 2024,
			grossMinor: '5000000',
			taxMinor: '1000000',
			ratePct: 20,
			byCountry: [{ country: 'CZ', grossMinor: '5000000', taxMinor: '1000000', ratePct: 20 }]
		};
		const total = segments(half, 10_000_000n, hues).reduce((sum, s) => sum + s.height, 0);
		expect(total).toBeCloseTo((MONEY_BOTTOM - MONEY_TOP) / 2, 5);
	});

	it('never gives a segment a negative height when tax exceeds gross', () => {
		// A correction can leave tax above gross on a filed statement. It is not
		// this chart's job to refuse the data, only to not draw upside down.
		const odd = {
			year: 2025,
			grossMinor: '1000',
			taxMinor: '2000',
			ratePct: 200,
			byCountry: [{ country: 'CZ', grossMinor: '1000', taxMinor: '2000', ratePct: 200 }]
		};
		for (const s of segments(odd, 2000n, hues)) expect(s.height).toBeGreaterThan(0);
	});

	it('draws nothing rather than dividing by zero on an empty record', () => {
		expect(segments(lopsided, 0n, hues)).toEqual([]);
	});

	it('falls back to a reserve hue for a jurisdiction with no assigned token', () => {
		const out = segments(lopsided, 10_000_000n, new Map());
		for (const s of out) expect(s.token).toBe('--series-r1');
	});
});

describe('the rate strip', () => {
	it('puts a higher rate higher up', () => {
		expect(rateY(20)).toBeLessThan(rateY(5));
	});

	it('clamps a rate past the ceiling rather than drawing outside the strip', () => {
		expect(rateY(RATE_TOP_PCT + 50)).toBe(rateY(RATE_TOP_PCT));
	});
});

describe('rate runs', () => {
	const rows = [
		{
			year: 2021,
			grossMinor: '1',
			taxMinor: '0',
			ratePct: 15,
			byCountry: [{ country: 'CZ', grossMinor: '1', taxMinor: '0', ratePct: 15 }]
		},
		{
			year: 2022,
			grossMinor: '1',
			taxMinor: '0',
			ratePct: 16,
			byCountry: [{ country: 'CZ', grossMinor: '1', taxMinor: '0', ratePct: 16 }]
		},
		{ year: 2023, grossMinor: '0', taxMinor: '0', ratePct: null, byCountry: [] },
		{
			year: 2024,
			grossMinor: '1',
			taxMinor: '0',
			ratePct: 18,
			byCountry: [{ country: 'CZ', grossMinor: '1', taxMinor: '0', ratePct: 18 }]
		}
	];

	it('breaks the run where a jurisdiction did not file', () => {
		// A connected line across a year with no filing asserts a figure that
		// does not exist.
		const runs = rateRuns(rows, 'CZ');
		expect(runs).toHaveLength(2);
		expect(runs[0].map((p) => p.year)).toEqual([2021, 2022]);
		expect(runs[1].map((p) => p.year)).toEqual([2024]);
	});

	it('keeps a lone year as a one-point run, so it draws a dot and no line', () => {
		const runs = rateRuns([rows[3]], 'CZ');
		expect(runs).toHaveLength(1);
		expect(runs[0]).toHaveLength(1);
	});

	it('returns nothing for a jurisdiction that never filed', () => {
		expect(rateRuns(rows, 'DE')).toEqual([]);
	});

	it('keeps each run at its own year slot', () => {
		const runs = rateRuns(rows, 'CZ');
		expect(runs[1][0].x).toBeCloseTo(slotFor(3, rows.length), 5);
	});
});

describe('maxGross', () => {
	it('finds the tallest year', () => {
		expect(
			maxGross([
				{ year: 2024, grossMinor: '500', taxMinor: '0', ratePct: null, byCountry: [] },
				{ year: 2025, grossMinor: '900', taxMinor: '0', ratePct: null, byCountry: [] }
			])
		).toBe(900n);
	});

	it('is zero for an empty record rather than undefined', () => {
		expect(maxGross([])).toBe(0n);
	});
});
