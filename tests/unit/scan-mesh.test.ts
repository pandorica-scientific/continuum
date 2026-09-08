// SPDX-License-Identifier: AGPL-3.0-or-later
// Flattening a page that is not flat.
//
// A perspective transform maps a quadrilateral exactly and a curve not at all.
// These check the replacement does the easy case identically — so a flat page
// is not quietly changed by a feature it does not use — and the hard case at
// all.
import { describe, expect, it } from 'vitest';
import { isStraight, meshMaps, outlineSpan } from '$lib/scan/core/mesh';
import type { Outline, Point } from '$lib/scan/core/types';

const square: Outline = {
	corners: {
		tl: { x: 0, y: 0 },
		tr: { x: 100, y: 0 },
		br: { x: 100, y: 200 },
		bl: { x: 0, y: 200 }
	}
};

/** Where output pixel (col,row) reads from. */
const at = (maps: { x: Float32Array; y: Float32Array }, w: number, col: number, row: number) => ({
	x: maps.x[row * w + col],
	y: maps.y[row * w + col]
});

describe('a straight outline', () => {
	it('is recognised whether its edges are absent or merely empty', () => {
		expect(isStraight(square)).toBe(true);
		expect(isStraight({ ...square, edges: { top: [], right: [], bottom: [], left: [] } })).toBe(
			true
		);
		expect(
			isStraight({ ...square, edges: { top: [{ x: 50, y: 5 }], right: [], bottom: [], left: [] } })
		).toBe(false);
	});

	it('maps the four corners onto the four corners', () => {
		const maps = meshMaps(square, 11, 21);
		expect(at(maps, 11, 0, 0).x).toBeCloseTo(0, 3);
		expect(at(maps, 11, 10, 0).x).toBeCloseTo(100, 3);
		expect(at(maps, 11, 10, 20).y).toBeCloseTo(200, 3);
		expect(at(maps, 11, 0, 20).y).toBeCloseTo(200, 3);
	});

	it('reduces exactly to the bilinear map, so a flat page is not a special case', () => {
		// With four straight edges the Coons patch IS the bilinear surface: the
		// ruled parts and the correction cancel. Anything else here means a flat
		// page would be silently re-sampled by a feature it does not use.
		const maps = meshMaps(square, 21, 41);
		for (const [col, row] of [
			[10, 20],
			[5, 30],
			[17, 8]
		]) {
			const u = col / 20;
			const v = row / 40;
			expect(at(maps, 21, col, row).x).toBeCloseTo(u * 100, 2);
			expect(at(maps, 21, col, row).y).toBeCloseTo(v * 200, 2);
		}
	});
});

describe('a bowed outline', () => {
	// A page whose top edge lifts: its middle sits 20px above the chord.
	const bowed: Outline = {
		corners: square.corners,
		edges: { top: [{ x: 50, y: -20 }], right: [], bottom: [], left: [] }
	};

	it('follows the curve along the edge it was given', () => {
		const maps = meshMaps(bowed, 21, 41);
		// The middle of the top row must read from the bow, not from the chord.
		expect(at(maps, 21, 10, 0).y).toBeLessThan(-15);
		// The corners are untouched: a bend between them cannot move them.
		expect(at(maps, 21, 0, 0).y).toBeCloseTo(0, 3);
		expect(at(maps, 21, 20, 0).y).toBeCloseTo(0, 3);
	});

	it('lets the bend fade across the page rather than shearing it', () => {
		const maps = meshMaps(bowed, 21, 41);
		const top = at(maps, 21, 10, 0).y;
		const middle = at(maps, 21, 10, 20).y;
		const bottom = at(maps, 21, 10, 40).y;
		// Strongest at the edge that bends, gone at the opposite one.
		expect(top).toBeLessThan(0);
		expect(middle).toBeGreaterThan(top);
		expect(bottom).toBeCloseTo(200, 3);
	});

	it('does not pincushion the interior', () => {
		// The Coons patch subtracts the bilinear surface through the corners
		// because both ruled surfaces already contain it. Leaving that term out
		// pulls the middle of a FLAT page inward — a fault that looks like a lens
		// rather than a mistake — so it is checked on the flat case, where the
		// centre must land exactly at the centre.
		const maps = meshMaps(square, 21, 41);
		expect(at(maps, 21, 10, 20).x).toBeCloseTo(50, 2);
		expect(at(maps, 21, 10, 20).y).toBeCloseTo(100, 2);
	});
});

describe('the size a bowed page is rendered at', () => {
	it('measures along the curve, not across the chord', () => {
		// A bulging sheet is longer than the straight line between its ends, so
		// measuring corner-to-corner renders it squashed in that direction.
		const flat = outlineSpan(square);
		expect(flat.width).toBeCloseTo(100, 1);
		expect(flat.height).toBeCloseTo(200, 1);

		const bowed: Outline = {
			corners: square.corners,
			edges: { top: [{ x: 50, y: -30 }], right: [], bottom: [], left: [] }
		};
		expect(outlineSpan(bowed).width).toBeGreaterThan(105);
		// The other axis is untouched by a bend in this one.
		expect(outlineSpan(bowed).height).toBeCloseTo(200, 1);
	});
});

describe('an edge sampled unevenly', () => {
	it('is walked by arc length, so the page does not stretch where points bunch', () => {
		// Points crowded at one end of an edge would otherwise be traversed
		// slowly and the sparse end quickly, stretching the paper across the
		// difference.
		const bunched: Point[] = [
			{ x: 2, y: 0 },
			{ x: 4, y: 0 },
			{ x: 6, y: 0 }
		];
		const outline: Outline = {
			corners: square.corners,
			edges: { top: bunched, right: [], bottom: [], left: [] }
		};
		const maps = meshMaps(outline, 21, 41);
		// Halfway along the top edge is halfway along its LENGTH, which for a
		// straight run from 0 to 100 is still 50 however the points are spaced.
		expect(at(maps, 21, 10, 0).x).toBeCloseTo(50, 0);
	});
});
