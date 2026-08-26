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

/**
 * The same distance, keeping its sign, so two lines on OPPOSITE sides of a
 * reference are not grouped together as one.
 */
export function signedDistanceToLine(line: Line, p: Point): number {
	return line.a * p.x + line.b * p.y + line.c;
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

export const EDGES = [
	['tl', 'tr'],
	['tr', 'br'],
	['br', 'bl'],
	['bl', 'tl']
] as const;

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

/**
 * The straight lines running along one edge of the page, best first.
 *
 * Fragments pointing roughly the same way and lying roughly the same distance
 * from `base` are one edge seen in pieces — broken by a fold, a shadow, or a
 * second sheet lying across it — so they are grouped and fitted as one line.
 * Groups are ranked by how much total segment length went into them, because a
 * page edge is the longest straight thing anywhere near it.
 *
 * `base` is NOT included in the result: the caller adds it, so that "leave this
 * edge where the mask put it" is always among the options considered.
 */
export function candidateLines(
	base: Line,
	segments: readonly Segment[],
	options: {
		angleTolerance: number;
		groupAngle: number;
		groupDistance: number;
		keep: number;
	}
): Line[] {
	const wanted = lineAngle(base);
	const groups: { offset: number; angle: number; length: number; points: Point[] }[] = [];

	for (const s of segments) {
		const ends = [
			{ x: s.x1, y: s.y1 },
			{ x: s.x2, y: s.y2 }
		];
		const line = lineThrough(ends[0], ends[1]);
		const angle = lineAngle(line);
		if (angleBetween(angle, wanted) > options.angleTolerance) continue;

		const length = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
		const middle = { x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 };
		const offset = signedDistanceToLine(base, middle);
		const group = groups.find(
			(g) =>
				Math.abs(g.offset - offset) < options.groupDistance &&
				angleBetween(g.angle, angle) < options.groupAngle
		);
		if (group) {
			// Weight the running offset by length, so one stray fragment cannot
			// drag a group off the edge that formed it.
			group.offset = (group.offset * group.length + offset * length) / (group.length + length);
			group.length += length;
			group.points.push(...ends);
		} else {
			groups.push({ offset, angle, length, points: [...ends] });
		}
	}

	groups.sort((one, two) => two.length - one.length);
	const lines: Line[] = [];
	for (const group of groups.slice(0, options.keep)) {
		const line = fitLine(group.points);
		if (line) lines.push(line);
	}
	return lines;
}

/** The four corners where consecutive edges meet, or null if any pair is parallel. */
export function quadFromLines(top: Line, right: Line, bottom: Line, left: Line): Corners | null {
	const tl = intersect(left, top);
	const tr = intersect(top, right);
	const br = intersect(right, bottom);
	const bl = intersect(bottom, left);
	if (!tl || !tr || !br || !bl) return null;
	if (![tl, tr, br, bl].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) return null;
	return { tl, tr, br, bl };
}

/**
 * True when the corners wind consistently one way.
 *
 * Four lines always meet SOMEWHERE, and most combinations of them meet in a
 * bow tie or an inside-out shape rather than a page. This is the cheap test
 * that throws those away before anything expensive looks at them.
 */
export function isConvexQuad(corners: Corners): boolean {
	const points = [corners.tl, corners.tr, corners.br, corners.bl];
	let sign = 0;
	for (let i = 0; i < 4; i++) {
		const a = points[i];
		const b = points[(i + 1) % 4];
		const c = points[(i + 2) % 4];
		const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
		if (cross === 0) return false;
		const here = cross > 0 ? 1 : -1;
		if (sign === 0) sign = here;
		else if (here !== sign) return false;
	}
	return true;
}

/**
 * Twice the signed area, positive when the corners run tl → tr → br → bl the
 * way `orderCorners` lays them out.
 *
 * Four lines bound a quad without saying which side of it is the top. Label
 * them the wrong way round and the corners come out wound backwards — the same
 * shape MIRRORED — and the page is warped through it into a mirror image of
 * itself. It scores identically to the correct one, because it is built from
 * the very same four lines, so nothing else in the search can tell them apart
 * and whichever is reached first wins. That is why the fault appeared at
 * random rather than on particular pages.
 */
export function quadWinding(corners: Corners): number {
	const points = [corners.tl, corners.tr, corners.br, corners.bl];
	let sum = 0;
	for (let i = 0; i < 4; i++) {
		const a = points[i];
		const b = points[(i + 1) % 4];
		sum += a.x * b.y - b.x * a.y;
	}
	return sum;
}

/** Area of the quad, as two triangles. */
export function quadArea(corners: Corners): number {
	const triangle = (a: Point, b: Point, c: Point) =>
		Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
	return (
		triangle(corners.tl, corners.tr, corners.bl) + triangle(corners.tr, corners.br, corners.bl)
	);
}
