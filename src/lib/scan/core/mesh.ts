// SPDX-License-Identifier: AGPL-3.0-or-later
// Flattening a page that is not flat.
//
// A perspective transform maps a QUADRILATERAL onto a rectangle, and does it
// exactly: four points in, four points out, one 3×3 matrix. It is the right
// tool for a sheet lying flat on a table, and it is the wrong one for a sheet
// that is not — A4 lifted at one edge, a folded letter, a page in a book. Those
// bow, and no matrix can straighten a curve.
//
// So when the boundary carries curved edges, the mapping is built point by
// point instead, as a Coons patch: a surface defined entirely by its four
// boundary curves, which is exactly what has been measured off the photograph.

import type { Edges, Outline, Point } from './types.ts';

/**
 * How many samples each edge is resampled to before interpolating.
 *
 * The detector offers a handful of points per edge and a person dragging
 * handles offers fewer still, so the curve is resampled to something dense
 * enough that the interior does not visibly facet. Cheap: this is arithmetic on
 * a few hundred points, not on the millions in the output.
 */
const EDGE_SAMPLES = 64;

/** A point along a polyline at parameter `t` in 0..1, by arc length. */
function along(points: readonly Point[], t: number): Point {
	if (points.length === 1) return points[0];
	// Arc length rather than index, or a curve with points bunched at one end
	// would move quickly through the sparse part and slowly through the dense
	// one — the page would stretch where the detector happened to sample more.
	const spans: number[] = [];
	let total = 0;
	for (let i = 1; i < points.length; i++) {
		const d = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
		spans.push(d);
		total += d;
	}
	if (total === 0) return points[0];

	let target = Math.min(1, Math.max(0, t)) * total;
	for (let i = 0; i < spans.length; i++) {
		if (target <= spans[i] || i === spans.length - 1) {
			const f = spans[i] === 0 ? 0 : target / spans[i];
			return {
				x: points[i].x + (points[i + 1].x - points[i].x) * f,
				y: points[i].y + (points[i + 1].y - points[i].y) * f
			};
		}
		target -= spans[i];
	}
	return points[points.length - 1];
}

/** The full polyline for one edge: its two corners with any bend between them. */
function edgePath(from: Point, to: Point, between: readonly Point[] | undefined): Point[] {
	return [from, ...(between ?? []), to];
}

/** Whether this outline is a plain quadrilateral, and so needs no mesh at all. */
export function isStraight(outline: Outline): boolean {
	const e = outline.edges;
	if (!e) return true;
	return !e.top.length && !e.right.length && !e.bottom.length && !e.left.length;
}

/**
 * Sample the four boundary curves, each in the direction the patch reads them.
 *
 * `right` and `bottom` are stored running clockwise — tr→br and br→bl — because
 * that is the order a person traces a page and the order the corners are named
 * in. The patch below wants every curve running left-to-right or top-to-bottom,
 * so two of them are reversed here, once, rather than at each of the four places
 * they are read.
 */
function boundary(outline: Outline) {
	const { tl, tr, br, bl } = outline.corners;
	const e = outline.edges;
	const sample = (path: Point[], reverse: boolean) => {
		const out: Point[] = [];
		for (let i = 0; i < EDGE_SAMPLES; i++) {
			const t = i / (EDGE_SAMPLES - 1);
			out.push(along(path, reverse ? 1 - t : t));
		}
		return out;
	};
	return {
		top: sample(edgePath(tl, tr, e?.top), false),
		bottom: sample(edgePath(br, bl, e?.bottom), true),
		left: sample(edgePath(bl, tl, e?.left), true),
		right: sample(edgePath(tr, br, e?.right), false)
	};
}

/**
 * Where output pixel (u, v) comes from in the source, as a Coons patch.
 *
 * The bilinearly blended Coons patch: two ruled surfaces, one interpolating the
 * top and bottom curves and one the left and right, minus the bilinear surface
 * through the four corners that both of them contain. Subtracting it is what
 * stops the corners being counted twice — leave it out and the sheet pincushions
 * inward, which looks like a lens fault rather than a mistake.
 *
 * With four straight edges this reduces exactly to the bilinear map, so a flat
 * page is not treated as a special case; it simply is one.
 */
export function meshMaps(
	outline: Outline,
	width: number,
	height: number,
	fromRow = 0,
	rowCount = height
): { x: Float32Array; y: Float32Array } {
	const { top, bottom, left, right } = boundary(outline);
	const { tl, tr, br, bl } = outline.corners;
	// Sized for the STRIP, but parameterised against the whole page: a band of
	// rows is a window onto the same surface, not a smaller page. Building the
	// maps for a full 2480x3508 render at once is about 140 MB of transient
	// buffers, which is more than a 2 GB box can spare beside everything else
	// the render is already holding.
	const x = new Float32Array(width * rowCount);
	const y = new Float32Array(width * rowCount);

	const last = EDGE_SAMPLES - 1;
	for (let strip = 0; strip < rowCount; strip++) {
		const row = fromRow + strip;
		const v = height === 1 ? 0 : row / (height - 1);
		const vs = v * last;
		const v0 = Math.min(last, Math.floor(vs));
		const v1 = Math.min(last, v0 + 1);
		const vf = vs - v0;
		const leftX = left[v0].x + (left[v1].x - left[v0].x) * vf;
		const leftY = left[v0].y + (left[v1].y - left[v0].y) * vf;
		const rightX = right[v0].x + (right[v1].x - right[v0].x) * vf;
		const rightY = right[v0].y + (right[v1].y - right[v0].y) * vf;

		for (let col = 0; col < width; col++) {
			const u = width === 1 ? 0 : col / (width - 1);
			const us = u * last;
			const u0 = Math.min(last, Math.floor(us));
			const u1 = Math.min(last, u0 + 1);
			const uf = us - u0;
			const topX = top[u0].x + (top[u1].x - top[u0].x) * uf;
			const topY = top[u0].y + (top[u1].y - top[u0].y) * uf;
			const bottomX = bottom[u0].x + (bottom[u1].x - bottom[u0].x) * uf;
			const bottomY = bottom[u0].y + (bottom[u1].y - bottom[u0].y) * uf;

			const corners =
				(1 - u) * (1 - v) * tl.x + u * (1 - v) * tr.x + (1 - u) * v * bl.x + u * v * br.x;
			const cornersY =
				(1 - u) * (1 - v) * tl.y + u * (1 - v) * tr.y + (1 - u) * v * bl.y + u * v * br.y;

			const i = strip * width + col;
			x[i] = (1 - v) * topX + v * bottomX + (1 - u) * leftX + u * rightX - corners;
			y[i] = (1 - v) * topY + v * bottomY + (1 - u) * leftY + u * rightY - cornersY;
		}
	}
	return { x, y };
}

/**
 * The corners a bowed outline should be measured at.
 *
 * `outputSize` reads the four corners, and on a bowed page those understate it:
 * the sheet is longer along its curve than across the chord between its ends,
 * so a page that bulges comes out squashed in that direction. Taking the arc
 * length of each edge instead gives back the paper's real proportions.
 */
export function outlineSpan(outline: Outline): { width: number; height: number } {
	const { top, bottom, left, right } = boundary(outline);
	const length = (points: Point[]) => {
		let total = 0;
		for (let i = 1; i < points.length; i++) {
			total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
		}
		return total;
	};
	// The LONGER of each opposing pair, matching `outputSize`: on a tilted page
	// the near edge is at true scale and the far one is foreshortened, and
	// averaging them squeezes the whole page by however far it was tilted.
	return {
		width: Math.max(length(top), length(bottom)),
		height: Math.max(length(left), length(right))
	};
}

/**
 * One clockwise quarter turn of a whole outline.
 *
 * `turnCorners` moves the four points; the bend between them has to travel with
 * them or a rotated bowed page keeps a curve belonging to the edge that used to
 * be there. The edges also SHIFT ROUND — what was the top edge is the right one
 * after a quarter turn — which is the part that is easy to miss and produces a
 * page creased along the wrong axis.
 */
export function turnEdges(edges: Edges | undefined, height: number): Edges | undefined {
	if (!edges) return undefined;
	const turn = (p: Point): Point => ({ x: height - 1 - p.y, y: p.x });
	const move = (points: Point[]) => points.map(turn);
	return {
		top: move(edges.left),
		right: move(edges.top),
		bottom: move(edges.right),
		left: move(edges.bottom)
	};
}

/** Scale every point of an outline, the way `scaleCorners` scales four. */
export function scaleOutline(outline: Outline, factor: number): Outline {
	const at = (p: Point): Point => ({ x: p.x * factor, y: p.y * factor });
	const c = outline.corners;
	return {
		corners: { tl: at(c.tl), tr: at(c.tr), br: at(c.br), bl: at(c.bl) },
		edges: outline.edges && {
			top: outline.edges.top.map(at),
			right: outline.edges.right.map(at),
			bottom: outline.edges.bottom.map(at),
			left: outline.edges.left.map(at)
		}
	};
}
