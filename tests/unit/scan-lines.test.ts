// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';
import {
	angleBetween,
	distanceToLine,
	fitLine,
	intersect,
	lineAngle,
	lineThrough,
	quadAngles,
	refineQuad,
	worstCornerSkew,
	type Segment
} from '$lib/scan/core/lines';
import type { Corners } from '$lib/scan/core/types';

const P = (x: number, y: number) => ({ x, y });

describe('lineThrough', () => {
	it('describes a horizontal line', () => {
		const line = lineThrough(P(0, 10), P(100, 10));
		expect(distanceToLine(line, P(50, 10))).toBeCloseTo(0, 6);
		expect(distanceToLine(line, P(50, 25))).toBeCloseTo(15, 6);
	});

	it('describes a vertical line, which ordinary least squares cannot', () => {
		const line = lineThrough(P(30, 0), P(30, 400));
		expect(distanceToLine(line, P(30, 200))).toBeCloseTo(0, 6);
		expect(distanceToLine(line, P(37, 200))).toBeCloseTo(7, 6);
	});

	it('does not divide by zero on a degenerate segment', () => {
		expect(() => lineThrough(P(5, 5), P(5, 5))).not.toThrow();
	});
});

describe('angles', () => {
	it('folds opposite directions together', () => {
		// A line has no direction: the same edge found left-to-right and
		// right-to-left must compare as identical.
		const forward = lineAngle(lineThrough(P(0, 0), P(10, 10)));
		const backward = lineAngle(lineThrough(P(10, 10), P(0, 0)));
		expect(angleBetween(forward, backward)).toBeCloseTo(0, 6);
	});

	it('measures a right angle as a right angle', () => {
		const horizontal = lineAngle(lineThrough(P(0, 0), P(10, 0)));
		const vertical = lineAngle(lineThrough(P(0, 0), P(0, 10)));
		expect(angleBetween(horizontal, vertical)).toBeCloseTo(Math.PI / 2, 6);
	});

	it('treats nearly-parallel as a small angle even across the fold at π', () => {
		const a = lineAngle(lineThrough(P(0, 0), P(100, 1)));
		const b = lineAngle(lineThrough(P(0, 1), P(100, 0)));
		expect(angleBetween(a, b)).toBeLessThan(0.05);
	});
});

describe('intersect', () => {
	it('finds the crossing point', () => {
		const point = intersect(lineThrough(P(0, 10), P(100, 10)), lineThrough(P(40, 0), P(40, 90)));
		expect(point).toBeTruthy();
		expect(point!.x).toBeCloseTo(40, 6);
		expect(point!.y).toBeCloseTo(10, 6);
	});

	it('returns null for parallel lines rather than Infinity', () => {
		// An Infinity here becomes a corner off the edge of the world and a warp
		// that produces nothing.
		expect(intersect(lineThrough(P(0, 0), P(10, 0)), lineThrough(P(0, 5), P(10, 5)))).toBeNull();
	});
});

describe('fitLine', () => {
	it('fits points on a line exactly', () => {
		const line = fitLine([P(0, 20), P(50, 20), P(100, 20)]);
		expect(distanceToLine(line!, P(75, 20))).toBeCloseTo(0, 6);
	});

	it('fits a VERTICAL run, which ordinary least squares cannot', () => {
		// Half of every page edge is near-vertical. Minimising vertical error
		// blows up there; minimising perpendicular error does not.
		const line = fitLine([P(12, 0), P(12, 100), P(12, 250)]);
		expect(line).toBeTruthy();
		expect(distanceToLine(line!, P(12, 400))).toBeCloseTo(0, 6);
	});

	it('averages out noise rather than following one stray point', () => {
		const line = fitLine([P(0, 10), P(50, 11), P(100, 9), P(150, 10)]);
		expect(distanceToLine(line!, P(75, 10))).toBeLessThan(1);
	});

	it('is null when there is nothing to fit', () => {
		expect(fitLine([])).toBeNull();
		expect(fitLine([P(1, 1)])).toBeNull();
	});
});

const rough: Corners = { tl: P(10, 10), tr: P(210, 10), br: P(210, 310), bl: P(10, 310) };
const tolerant = { angleTolerance: 0.2, distanceTolerance: 12, maxDrift: 40 };

/** Segments lying along a rectangle inset from `rough` by `off`. */
function edgesOf(off: number): Segment[] {
	const l = 10 + off,
		r = 210 + off,
		t = 10 + off,
		b = 310 + off;
	return [
		{ x1: l, y1: t, x2: r, y2: t },
		{ x1: l + 20, y1: t, x2: r - 20, y2: t },
		{ x1: r, y1: t, x2: r, y2: b },
		{ x1: r, y1: t + 20, x2: r, y2: b - 20 },
		{ x1: r, y1: b, x2: l, y2: b },
		{ x1: r - 20, y1: b, x2: l + 20, y2: b },
		{ x1: l, y1: b, x2: l, y2: t },
		{ x1: l, y1: b - 20, x2: l, y2: t + 20 }
	];
}

describe('refineQuad', () => {
	it('pulls the corners onto the real edges', () => {
		const refined = refineQuad(rough, edgesOf(6), tolerant);
		expect(refined.tl.x).toBeCloseTo(16, 3);
		expect(refined.tl.y).toBeCloseTo(16, 3);
		expect(refined.br.x).toBeCloseTo(216, 3);
		expect(refined.br.y).toBeCloseTo(316, 3);
	});

	it('leaves the quad alone when nothing supports a move', () => {
		expect(refineQuad(rough, [], tolerant)).toEqual(rough);
	});

	it('ignores segments at the wrong angle', () => {
		// Text lines run parallel to the top edge but sit nowhere near it; the
		// distance test is what keeps them out. A diagonal has neither excuse.
		const diagonal: Segment[] = [{ x1: 20, y1: 20, x2: 200, y2: 300 }];
		expect(refineQuad(rough, diagonal, tolerant)).toEqual(rough);
	});

	it('ignores segments too far from the edge, however well aligned', () => {
		const textLine: Segment[] = [{ x1: 30, y1: 150, x2: 190, y2: 150 }];
		expect(refineQuad(rough, textLine, tolerant)).toEqual(rough);
	});

	it('refuses a single segment, which could tilt a line onto nonsense', () => {
		const one: Segment[] = [{ x1: 10, y1: 14, x2: 60, y2: 14 }];
		expect(refineQuad(rough, one, tolerant)).toEqual(rough);
	});

	it('falls back to the rough quad when refinement drifts too far', () => {
		// Refinement may improve a detection; it must never be able to wreck one.
		const strict = { ...tolerant, maxDrift: 2 };
		expect(refineQuad(rough, edgesOf(6), strict)).toEqual(rough);
	});

	it('returns the rough quad rather than an impossible corner', () => {
		const parallel: Segment[] = [
			{ x1: 0, y1: 10, x2: 300, y2: 10 },
			{ x1: 0, y1: 11, x2: 300, y2: 11 }
		];
		const out = refineQuad(rough, parallel, tolerant);
		for (const key of ['tl', 'tr', 'br', 'bl'] as const) {
			expect(Number.isFinite(out[key].x)).toBe(true);
			expect(Number.isFinite(out[key].y)).toBe(true);
		}
	});
});

describe('quad angles', () => {
	it('are all square for a rectangle', () => {
		const square: Corners = { tl: P(0, 0), tr: P(100, 0), br: P(100, 200), bl: P(0, 200) };
		for (const angle of quadAngles(square)) expect(angle).toBeCloseTo(90, 6);
		expect(worstCornerSkew(square)).toBeCloseTo(0, 6);
	});

	it('stay near square for a page photographed at a mild angle', () => {
		// Perspective skews a rectangle; a comfortable over-the-desk shot must
		// still be accepted or the scanner is unusable.
		const tilted: Corners = { tl: P(20, 8), tr: P(180, 0), br: P(196, 260), bl: P(4, 268) };
		expect(worstCornerSkew(tilted)).toBeLessThan(20);
	});

	it('are far from square for the skewed quads that produce rubbish', () => {
		// The shape the detector used to hand over when the hull ballooned into
		// the background: a dart, not a page.
		const dart: Corners = { tl: P(10, 40), tr: P(300, 10), br: P(280, 300), bl: P(150, 120) };
		expect(worstCornerSkew(dart)).toBeGreaterThan(35);
	});

	it('sum to about 360 degrees, as any simple quadrilateral must', () => {
		const quad: Corners = { tl: P(12, 20), tr: P(190, 5), br: P(205, 250), bl: P(0, 262) };
		const total = quadAngles(quad).reduce((sum, angle) => sum + angle, 0);
		expect(total).toBeCloseTo(360, 4);
	});

	it('does not produce NaN for a collapsed quad', () => {
		// Detection can collapse on a blank wall, and a NaN sails through every
		// comparison meant to reject it.
		const collapsed: Corners = { tl: P(5, 5), tr: P(5, 5), br: P(5, 5), bl: P(5, 5) };
		for (const angle of quadAngles(collapsed)) expect(Number.isFinite(angle)).toBe(true);
	});
});
