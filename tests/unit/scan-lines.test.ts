// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';
import {
	angleBetween,
	candidateLines,
	distanceToLine,
	fitLine,
	intersect,
	isConvexQuad,
	lineAngle,
	lineThrough,
	quadAngles,
	quadArea,
	quadFromLines,
	quadWinding,
	signedDistanceToLine,
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
const grouping = {
	angleTolerance: 0.52,
	groupAngle: 0.17,
	groupDistance: 12,
	keep: 5
};

describe('signedDistanceToLine', () => {
	it('separates the two sides of a line', () => {
		const line = lineThrough(P(0, 100), P(200, 100));
		const above = signedDistanceToLine(line, P(100, 40));
		const below = signedDistanceToLine(line, P(100, 160));
		expect(Math.sign(above)).not.toBe(Math.sign(below));
		expect(Math.abs(above)).toBeCloseTo(60);
		expect(Math.abs(below)).toBeCloseTo(60);
	});
});

describe('candidateLines', () => {
	const top = lineThrough(rough.tl, rough.tr);

	it('gathers the pieces of one broken edge into a single line', () => {
		// Two fragments of the same edge with a gap between them, which is what a
		// fold or a second sheet lying across the page leaves behind.
		const broken: Segment[] = [
			{ x1: 10, y1: 60, x2: 90, y2: 60 },
			{ x1: 130, y1: 60, x2: 210, y2: 60 }
		];
		const found = candidateLines(top, broken, grouping);
		expect(found).toHaveLength(1);
		expect(distanceToLine(found[0], P(110, 60))).toBeLessThan(1);
	});

	it('keeps edges at different distances apart', () => {
		const two: Segment[] = [
			{ x1: 10, y1: 60, x2: 210, y2: 60 },
			{ x1: 10, y1: 200, x2: 210, y2: 200 }
		];
		expect(candidateLines(top, two, grouping)).toHaveLength(2);
	});

	it('ignores anything pointing the wrong way', () => {
		const across: Segment[] = [{ x1: 100, y1: 10, x2: 100, y2: 310 }];
		expect(candidateLines(top, across, grouping)).toHaveLength(0);
	});

	it('offers the longest edges first', () => {
		const mixed: Segment[] = [
			{ x1: 90, y1: 60, x2: 130, y2: 60 },
			{ x1: 10, y1: 200, x2: 210, y2: 200 }
		];
		const found = candidateLines(top, mixed, grouping);
		expect(distanceToLine(found[0], P(100, 200))).toBeLessThan(1);
	});

	it('returns no more than it was asked for', () => {
		const many: Segment[] = [40, 80, 120, 160, 200, 240, 280].map((y) => ({
			x1: 10,
			y1: y,
			x2: 210,
			y2: y
		}));
		expect(candidateLines(top, many, { ...grouping, keep: 3 })).toHaveLength(3);
	});

	it('does not include the edge it was given', () => {
		// The caller adds that itself, so "leave this edge alone" is always an
		// option; returning it here as well would just double the search.
		const along: Segment[] = [{ x1: 10, y1: 10, x2: 210, y2: 10 }];
		const found = candidateLines(top, along, grouping);
		expect(found).toHaveLength(1);
		expect(found[0]).not.toBe(top);
	});
});

describe('quadFromLines', () => {
	it('rebuilds a rectangle from its four sides', () => {
		const quad = quadFromLines(
			lineThrough(rough.tl, rough.tr),
			lineThrough(rough.tr, rough.br),
			lineThrough(rough.br, rough.bl),
			lineThrough(rough.bl, rough.tl)
		);
		expect(quad?.tl.x).toBeCloseTo(10);
		expect(quad?.br.y).toBeCloseTo(310);
	});

	it('is null when two ADJACENT sides are parallel', () => {
		// Which is most of what the search enumerates: four lines picked out of a
		// pool have no obligation to bound anything.
		const top = lineThrough(P(0, 0), P(100, 0));
		const right = lineThrough(P(0, 50), P(100, 50));
		const bottom = lineThrough(P(0, 100), P(100, 100));
		const left = lineThrough(P(0, 0), P(0, 100));
		expect(quadFromLines(top, right, bottom, left)).toBeNull();
	});
});

describe('isConvexQuad', () => {
	it('accepts a rectangle and a page seen at an angle', () => {
		expect(isConvexQuad(rough)).toBe(true);
		expect(isConvexQuad({ tl: P(30, 10), tr: P(210, 40), br: P(190, 310), bl: P(10, 280) })).toBe(
			true
		);
	});

	it('rejects the bow tie four crossing lines usually make', () => {
		expect(isConvexQuad({ tl: P(10, 10), tr: P(210, 10), br: P(10, 310), bl: P(210, 310) })).toBe(
			false
		);
	});
});

describe('quadWinding', () => {
	it('is positive for corners named the way orderCorners names them', () => {
		expect(quadWinding(rough)).toBeGreaterThan(0);
	});

	it('is negative for the same shape mirrored', () => {
		// Swapping left for right is the whole bug: four lines bound a quad
		// without saying which side is the top, and a page warped through the
		// mirrored labelling comes out as a mirror image of itself.
		const mirrored = { tl: rough.tr, tr: rough.tl, br: rough.bl, bl: rough.br };
		expect(quadWinding(mirrored)).toBeLessThan(0);
	});

	it('does not notice a half turn, which is why ordering is what fixes it', () => {
		// Rotating the labels by two keeps the winding and still turns the page
		// upside down, so the winding test alone was never enough.
		const turned = { tl: rough.br, tr: rough.bl, br: rough.tl, bl: rough.tr };
		expect(quadWinding(turned)).toBeGreaterThan(0);
	});
});

describe('quadArea', () => {
	it('measures a rectangle', () => {
		expect(quadArea(rough)).toBeCloseTo(200 * 300);
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
