// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The arithmetic behind the scratch.
 *
 * These are the handoff prototype's numbers, pulled out of the canvas engine so
 * they can be checked without a DOM. The one that matters most is the brush
 * size: without it, scratching Luxembourg takes as many strokes as scratching
 * the United States.
 */
import { describe, expect, it } from 'vitest';
import {
	BRUSH_MAX,
	BRUSH_MIN,
	CLEARED,
	MOST_SAMPLES,
	brushWidth,
	sampleGrid,
	stepsAlong,
	strokePressure,
	strokeWidth
} from '$lib/life/map/brush';

const box = (width: number, height: number): [[number, number], [number, number]] => [
	[0, 0],
	[width, height]
];

describe('how wide the brush is', () => {
	it('grows with the region', () => {
		expect(brushWidth(box(40, 40))).toBeLessThan(brushWidth(box(400, 400)));
	});

	it('never gets so small that a region cannot be cleared', () => {
		expect(brushWidth(box(1, 1))).toBeGreaterThanOrEqual(BRUSH_MIN);
		expect(brushWidth(box(0, 0))).toBeGreaterThanOrEqual(BRUSH_MIN);
	});

	// A brush the size of Russia would clear its neighbours in one stroke were
	// the region not locked, and would clear Russia itself in two.
	it('never gets so big that one stroke does everything', () => {
		expect(brushWidth(box(900, 400))).toBeLessThanOrEqual(BRUSH_MAX);
	});

	it('is the same every time for the same region', () => {
		expect(brushWidth(box(240, 160))).toBe(brushWidth(box(240, 160)));
	});
});

describe('where coverage is sampled', () => {
	const everywhere = () => true;

	it('covers a region with a grid', () => {
		const points = sampleGrid(box(200, 200), everywhere);
		expect(points.length).toBeGreaterThan(20);
		for (const point of points) {
			expect(point.x).toBeGreaterThan(0);
			expect(point.x).toBeLessThan(200);
		}
	});

	// A continent-sized region must not cost thousands of pixel reads.
	it('caps how many points a huge region gets', () => {
		expect(sampleGrid(box(960, 480), everywhere).length).toBeLessThanOrEqual(MOST_SAMPLES);
	});

	it('gives a tiny region at least a handful', () => {
		expect(sampleGrid(box(12, 12), everywhere).length).toBeGreaterThan(0);
	});

	// The grid covers the bounding box; the region is rarely a rectangle.
	it('drops the points that fall outside the region itself', () => {
		const leftHalf = sampleGrid(box(200, 200), (x) => x < 100);
		const whole = sampleGrid(box(200, 200), everywhere);
		expect(leftHalf.length).toBeLessThan(whole.length);
		for (const point of leftHalf) expect(point.x).toBeLessThan(100);
	});

	it('has nothing to sample in a region with no area', () => {
		expect(sampleGrid(box(0, 0), everywhere)).toEqual([]);
	});
});

describe('how hard a stroke is', () => {
	it('presses harder the faster it moves', () => {
		expect(strokePressure(10, 16)).toBeLessThan(strokePressure(100, 16));
	});

	it('never presses harder than all the way', () => {
		expect(strokePressure(10_000, 1)).toBeLessThanOrEqual(1);
	});

	it('widens with speed, but only so far', () => {
		const base = 30;
		expect(strokeWidth(base, 10, 16)).toBeGreaterThan(base);
		expect(strokeWidth(base, 10_000, 1)).toBeLessThanOrEqual(base * 1.4);
	});

	// A device that reports two points a hundred units apart must still leave a
	// scratch rather than two dots.
	it('lays enough stamps along a fast drag to leave no gap', () => {
		const width = 40;
		const steps = stepsAlong(400, width);
		expect(400 / steps).toBeLessThanOrEqual(width / 2);
	});

	it('lays at least one stamp however short the move', () => {
		expect(stepsAlong(0.1, 40)).toBeGreaterThanOrEqual(1);
	});
});

describe('when a region counts as scratched off', () => {
	// Not 100%: the last few per cent of a ragged edge take longer than the
	// whole rest of the region, and nobody would ever finish one.
	it('is most of the way, not all of it', () => {
		expect(CLEARED).toBeGreaterThan(0.7);
		expect(CLEARED).toBeLessThan(1);
	});
});
