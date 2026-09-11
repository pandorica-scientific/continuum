// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The shape a bottle's tasting notes make.
 *
 * Geometry with no DOM in it, tested beside the other chart arithmetic — the
 * product's rule for every chart.
 */
import { describe, expect, it } from 'vitest';
import { LEAST_AXES, RINGS, tastingRadar } from '$lib/charts/tasting-radar';

const mention = (note: string, count: number) => ({ note, count, series: 'series-r1' });

describe('too few notes to draw', () => {
	// Two axes make a line, not a shape, and a line implies a relationship
	// between two flavours that does not exist.
	it('draws nothing from two notes', () => {
		const radar = tastingRadar([mention('plum', 3), mention('oak', 2)]);
		expect(radar.axes).toEqual([]);
		expect(radar.points).toBe('');
		expect(radar.spokes).toEqual([]);
	});

	it('draws nothing from none', () => {
		expect(tastingRadar([]).axes).toEqual([]);
	});

	it('draws from three', () => {
		const radar = tastingRadar([mention('plum', 1), mention('oak', 1), mention('smoke', 1)]);
		expect(radar.axes).toHaveLength(LEAST_AXES);
	});
});

describe('how far out each note sits', () => {
	it('puts the most-mentioned on the outer ring', () => {
		const radar = tastingRadar([mention('plum', 5), mention('oak', 1), mention('smoke', 1)]);
		expect(radar.axes[0].reach).toBe(1);
		// Straight up, at the outer edge.
		expect(radar.axes[0].x).toBeCloseTo(radar.centre, 6);
		expect(radar.axes[0].y).toBeCloseTo(radar.centre - radar.radius, 6);
	});

	it('normalises the others against it', () => {
		const radar = tastingRadar([mention('plum', 5), mention('oak', 1), mention('smoke', 4)]);
		expect(radar.axes[1].reach).toBeCloseTo(0.2, 6);
		expect(radar.axes[2].reach).toBeCloseTo(0.8, 6);
	});

	// One note mentioned five times, alone, still reaches the outer ring — the
	// web is about this bottle, not an absolute scale.
	it('reaches the outer ring even when every note ties', () => {
		const radar = tastingRadar([mention('plum', 5), mention('oak', 5), mention('smoke', 5)]);
		for (const axis of radar.axes) expect(axis.reach).toBe(1);
	});

	it('puts a note nobody mentioned at the centre', () => {
		const radar = tastingRadar([mention('plum', 4), mention('oak', 0), mention('smoke', 2)]);
		expect(radar.axes[1].x).toBeCloseTo(radar.centre, 6);
		expect(radar.axes[1].y).toBeCloseTo(radar.centre, 6);
	});
});

describe('the web itself', () => {
	it('closes the polygon', () => {
		const radar = tastingRadar([mention('plum', 3), mention('oak', 2), mention('smoke', 1)]);
		const points = radar.points.split(' ');
		expect(points).toHaveLength(4);
		expect(points[0]).toBe(points[3]);
	});

	it('draws one spoke per note, all on the outer ring', () => {
		const radar = tastingRadar([
			mention('plum', 3),
			mention('oak', 2),
			mention('smoke', 1),
			mention('leather', 1)
		]);
		expect(radar.spokes).toHaveLength(4);
		for (const spoke of radar.spokes) {
			const distance = Math.hypot(spoke.x - radar.centre, spoke.y - radar.centre);
			expect(distance).toBeCloseTo(radar.radius, 6);
		}
	});

	it('has as many rings as it says it does, outermost last', () => {
		const radar = tastingRadar([mention('plum', 1), mention('oak', 1), mention('smoke', 1)]);
		expect(radar.rings).toHaveLength(RINGS);
		expect(radar.rings.at(-1)).toBeCloseTo(radar.radius, 6);
		expect(radar.rings[0]).toBeLessThan(radar.rings[1]);
	});

	it('keeps the web inside the square', () => {
		const radar = tastingRadar([mention('plum', 5), mention('oak', 5), mention('smoke', 5)], 240);
		for (const axis of radar.axes) {
			expect(axis.x).toBeGreaterThanOrEqual(0);
			expect(axis.x).toBeLessThanOrEqual(240);
			expect(axis.y).toBeGreaterThanOrEqual(0);
			expect(axis.y).toBeLessThanOrEqual(240);
		}
	});

	it('puts the label pills outside the web', () => {
		const radar = tastingRadar([mention('plum', 1), mention('oak', 1), mention('smoke', 1)]);
		for (const axis of radar.axes) {
			const distance = Math.hypot(axis.labelX - radar.centre, axis.labelY - radar.centre);
			expect(distance).toBeGreaterThan(radar.radius);
		}
	});
});
