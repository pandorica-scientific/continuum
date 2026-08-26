// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Refining a rough quadrilateral onto the straight edges actually in the image.
//
// A page's corners taken from a polygon approximation of a thresholded mask are
// inherently a few pixels out: the mask boundary is blurred, the approximation
// tolerates error by design, and no amount of mask tuning changes either. But a
// document's edges are STRAIGHT LINES, and a line fitted to the real edge
// gradient is far more precise than any point on that boundary.
//
// This is the geometric half of the approach Dropbox describe for their scanner
// — find lines, intersect them for corners — applied to the four edges the
// segmentation has already located, rather than to every line in the frame.
// Keeping the search local is what makes it cheap enough for a live loop.
//
// Everything here is pure arithmetic on plain numbers, which is the point: the
// part of detection that can be tested without a WebAssembly runtime should be.

import type { Corners, Point } from './types.ts';

/** A line as `a·x + b·y + c = 0`, with (a, b) a unit normal. */
export type Line = { a: number; b: number; c: number };

/** A detected edge fragment, as Hough returns it. */
export type Segment = { x1: number; y1: number; x2: number; y2: number };

export function lineThrough(p: Point, q: Point): Line {
	const dx = q.x - p.x;
	const dy = q.y - p.y;
	const length = Math.hypot(dx, dy);
	if (length === 0) return { a: 1, b: 0, c: -p.x };
	// Normal is the direction turned a quarter turn, normalised.
	const a = -dy / length;
	const b = dx / length;
	return { a, b, c: -(a * p.x + b * p.y) };
}

/** Perpendicular distance, which is why the normal is kept unit length. */
export function distanceToLine(line: Line, p: Point): number {
	return Math.abs(line.a * p.x + line.b * p.y + line.c);
}

/** Direction of the line in radians, folded to [0, π) so opposites agree. */
export function lineAngle(line: Line): number {
	const angle = Math.atan2(-line.a, line.b);
	return ((angle % Math.PI) + Math.PI) % Math.PI;
}

/** The smaller angle between two directions, accounting for the fold at π. */
export function angleBetween(one: number, two: number): number {
	const raw = Math.abs(one - two) % Math.PI;
	return Math.min(raw, Math.PI - raw);
}

export function intersect(one: Line, two: Line): Point | null {
	const determinant = one.a * two.b - two.a * one.b;
	// Parallel, or near enough that the intersection would be meaningless.
	if (Math.abs(determinant) < 1e-6) return null;
	return {
		x: (one.b * two.c - two.b * one.c) / determinant,
		y: (two.a * one.c - one.a * two.c) / determinant
	};
}

/**
 * Total least squares through a set of points.
 *
 * Ordinary least squares minimises vertical error and therefore falls apart on
 * a near-vertical edge — which is half of every page. This minimises
 * perpendicular error instead, so it behaves the same at any orientation.
 */
export function fitLine(points: Point[]): Line | null {
	if (points.length < 2) return null;
	let mx = 0;
	let my = 0;
	for (const p of points) {
		mx += p.x;
		my += p.y;
	}
	mx /= points.length;
	my /= points.length;

	let sxx = 0;
	let syy = 0;
	let sxy = 0;
	for (const p of points) {
		const dx = p.x - mx;
		const dy = p.y - my;
		sxx += dx * dx;
		syy += dy * dy;
		sxy += dx * dy;
	}
	// For a 2x2 scatter matrix the principal direction has a closed form. The
	// line runs ALONG that direction, so the normal is it turned a quarter turn
	// — getting those two the wrong way round fits a line at right angles to the
	// data and looks plausible until a test measures a distance.
	const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
	const a = -Math.sin(theta);
	const b = Math.cos(theta);
	return { a, b, c: -(a * mx + b * my) };
}

const EDGES = [
	['tl', 'tr'],
	['tr', 'br'],
	['br', 'bl'],
	['bl', 'tl']
] as const;

/**
 * Pull each edge of a rough quad onto the segments that lie along it.
 *
 * Deliberately conservative. An edge with no convincing support keeps its
 * original line, and if the refined quad disagrees with the rough one by more
 * than `maxDrift` the rough one is returned untouched. Refinement may improve a
 * detection; it must never be able to wreck one.
 */
export function refineQuad(
	rough: Corners,
	segments: Segment[],
	options: { angleTolerance: number; distanceTolerance: number; maxDrift: number }
): Corners {
	const refined = EDGES.map(([from, to]) => {
		const base = lineThrough(rough[from], rough[to]);
		const wanted = lineAngle(base);

		const support: Point[] = [];
		for (const s of segments) {
			const ends = [
				{ x: s.x1, y: s.y1 },
				{ x: s.x2, y: s.y2 }
			];
			const angle = lineAngle(lineThrough(ends[0], ends[1]));
			if (angleBetween(angle, wanted) > options.angleTolerance) continue;
			if (ends.some((p) => distanceToLine(base, p) > options.distanceTolerance)) continue;
			support.push(...ends);
		}
		// Two points is one segment: enough to tilt a line onto nonsense. Ask for
		// at least two segments' worth before trusting it over the mask.
		return support.length >= 4 ? (fitLine(support) ?? base) : base;
	});

	const corners: Point[] = [];
	for (let i = 0; i < 4; i++) {
		// Corner i is where edge i-1 meets edge i.
		const point = intersect(refined[(i + 3) % 4], refined[i]);
		if (!point) return rough;
		corners.push(point);
	}

	const [tl, tr, br, bl] = corners;
	const result = { tl, tr, br, bl };
	const drifted = (['tl', 'tr', 'br', 'bl'] as const).some(
		(key) =>
			Math.hypot(result[key].x - rough[key].x, result[key].y - rough[key].y) > options.maxDrift
	);
	return drifted ? rough : result;
}

/**
 * The four interior angles of a quad, in degrees, corner by corner.
 *
 * A page photographed from directly above is a rectangle; photographed from an
 * angle it is a trapezoid, but a plausible one — perspective skews a rectangle,
 * it does not turn it into a dart. So corners far from square mean one of two
 * things, and both are worth saying out loud: either the camera is tilted badly
 * enough to distort the page, or the detector has locked onto something that
 * was never a page. Accepting it silently is how a capture ends up as the
 * skewed, unreadable rubbish the user sees only after saving.
 */
export function quadAngles(corners: Corners): number[] {
	const order = [corners.tl, corners.tr, corners.br, corners.bl];
	return order.map((corner, i) => {
		const before = order[(i + 3) % 4];
		const after = order[(i + 1) % 4];
		const ax = before.x - corner.x;
		const ay = before.y - corner.y;
		const bx = after.x - corner.x;
		const by = after.y - corner.y;
		const magnitude = Math.hypot(ax, ay) * Math.hypot(bx, by);
		if (magnitude === 0) return 0;
		const cosine = Math.min(1, Math.max(-1, (ax * bx + ay * by) / magnitude));
		return (Math.acos(cosine) * 180) / Math.PI;
	});
}

/** How far the worst corner is from square, in degrees. */
export function worstCornerSkew(corners: Corners): number {
	return Math.max(...quadAngles(corners).map((angle) => Math.abs(angle - 90)));
}
