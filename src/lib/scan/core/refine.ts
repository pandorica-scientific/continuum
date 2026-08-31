// SPDX-License-Identifier: AGPL-3.0-or-later
// Pulling a rough quad onto the page's real edges.
//
// The quad this is handed is the convex hull of everything Otsu called bright,
// simplified to four points. That is one shape whether or not it is one sheet
// of paper: a second page in frame, or a laptop lid touching it, joins the
// region and the hull then spans both. Nothing about that quad gives it away —
// it is convex, its solidity is fine — and the crop comes out sheared across
// two objects.
//
// So this looks again, at the mask's OUTLINE rather than its filled shape, and
// asks which four straight lines actually bound a page.
//
// `cv` is a PARAMETER, not an import, for the same reason as everywhere else in
// `core`: it keeps this module free of the 10 MB WASM bundle.

import type { Arena } from './arena.ts';
import { MAX_ASPECT, MAX_CORNER_SKEW, orderCorners, quadAspect } from './geometry.ts';
import {
	EDGES,
	candidateLines,
	isConvexQuad,
	lineThrough,
	quadArea,
	quadFromLines,
	quadWinding,
	worstCornerSkew,
	type Segment
} from './lines.ts';
import type { CV } from './opencv.ts';
import type { Corners, Frame, Point } from './types.ts';

/**
 * A margin of background added around the mask before its outline is taken.
 *
 * A page held close runs off the edge of the frame, and its mask then touches
 * the image border, where a gradient has nothing on the far side to differ
 * from. Without the margin that one side — the hardest of the four to frame —
 * scored zero support, and the search kept pulling the quad inward away from
 * it. Unrelated to the segmentation's own padding, which exists so a contour
 * has somewhere to close.
 */
const OUTLINE_PAD = 8;

/**
 * The refinement search, in shares of the detection frame's width so the
 * numbers mean the same thing at any resolution.
 *
 * Every one of these was measured on real photographs; the harness that
 * produced them is in scratch-workspace/v0.6.0/tune.
 */
/** How far from an edge of the rough quad a line may point and still be a
 *  candidate for that edge, in radians. Generous, because the rough edge can be
 *  badly wrong — a second sheet in frame skewed one by about 20°. */
const SEARCH_ANGLE = 0.52;
/** Fragments this much nearer each other than the frame's width, pointing the
 *  same way, are one edge broken into pieces. */
const SEARCH_GROUP_DISTANCE = 0.02;
/** ...and no more than this far apart in direction, in radians. */
const SEARCH_GROUP_ANGLE = 0.17;
/** Lines considered per edge, on top of the rough edge itself. Five keeps the
 *  worst case at 6^4 combinations, which measured 68-145 ms. */
const SEARCH_LINES_PER_EDGE = 5;
/** How near the mask's outline a point must fall to count as supported. */
const SUPPORT_BAND = 0.012;
/** How far either side of an edge brightness is compared. */
export const CONTRAST_REACH = 0.016;
/** A page edge has paper on one side and desk on the other. Below this it has
 *  paper on both, which means it is a line of text, not the edge of a page. */
const CONTRAST_FLOOR = 0.04;
/** Brightness difference treated as full marks, so a strong edge and a very
 *  strong one are not separated by noise. */
export const CONTRAST_FULL = 0.25;
/** A quad smaller than this is a paragraph, a stamp, or a photograph printed on
 *  the page — not the page. */
const SEARCH_MIN_FRACTION = 0.2;
/** ...and one this large is the frame itself. */
const SEARCH_MAX_FRACTION = 0.95;
/** One sample every this many pixels along an edge. */
const SAMPLE_STEP = 5;
/**
 * How the three measurements are weighted against each other.
 *
 * The worst edge dominates, because one edge in the wrong place ruins the crop
 * however good the other three are. Area breaks the tie toward the whole page
 * rather than a well-supported piece of it.
 */
const WEIGHT_SUPPORT = 0.45;
const WEIGHT_CONTRAST = 0.25;
const WEIGHT_AREA = 0.3;

/**
 * Hough settings for the refinement pass.
 *
 * These run over the MASK's outline, not the photograph, so there is no text to
 * wade through: measured on real captures this returns 29-82 segments where
 * Canny over the same frames returned 383-557.
 */
const HOUGH = {
	threshold: 40,
	minLength: 0.06,
	maxGap: 0.03,
	rho: 1,
	thetaDegrees: 1
} as const;

/**
 * Find the four lines that really bound the page.
 *
 * Reads the MASK's outline, not the photograph. Canny over the photograph is
 * the intuitive choice and it is measurably wrong here: black text on white
 * paper gives far stronger gradients than white paper on a light desk, so on a
 * real capture the sixteen longest near-horizontal segments Canny produced all
 * lay inside the text block, and the page's own top edge produced nothing at
 * all. Every candidate quad built from that map scored 0.13-0.17 for support
 * along its top edge, because the edge it needed was not in the map to be
 * found. The mask's outline is precisely the paper/not-paper boundary and
 * contains no typography whatsoever.
 *
 * Each edge of the rough quad proposes a few lines; every combination is
 * scored; the rough edges are among the candidates, so a quad that was already
 * right stays right. Returns null when nothing beats what came in.
 */
export function searchQuad(
	cv: CV,
	keep: Arena,
	gray: InstanceType<CV['Mat']>,
	mask: InstanceType<CV['Mat']>,
	rough: Corners,
	frame: Frame
): Corners | null {
	const width = frame.width;

	// Pad before taking the gradient. A page held close runs off the edge of the
	// frame, and its mask then touches the image border, where a gradient has
	// nothing on the far side to differ from — so the one side of the page that
	// is hardest to frame scored zero support and the search kept pulling the
	// quad inward, away from it. With the margin, that boundary exists, and the
	// crop is the part that was in view.
	const bordered = keep(new cv.Mat());
	cv.copyMakeBorder(
		mask,
		bordered,
		OUTLINE_PAD,
		OUTLINE_PAD,
		OUTLINE_PAD,
		OUTLINE_PAD,
		cv.BORDER_CONSTANT,
		new cv.Scalar(0, 0, 0, 0)
	);
	const thin = keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3)));
	const wide = keep(new cv.Mat());
	cv.morphologyEx(bordered, wide, cv.MORPH_GRADIENT, thin);
	const outline = keep(new cv.Mat());
	keep(wide.roi(new cv.Rect(OUTLINE_PAD, OUTLINE_PAD, frame.width, frame.height))).copyTo(outline);

	const lines = keep(new cv.Mat());
	cv.HoughLinesP(
		outline,
		lines,
		HOUGH.rho,
		(Math.PI / 180) * HOUGH.thetaDegrees,
		HOUGH.threshold,
		width * HOUGH.minLength,
		width * HOUGH.maxGap
	);
	const segments: Segment[] = [];
	const data = lines.data32S;
	for (let i = 0; i + 3 < data.length; i += 4) {
		segments.push({ x1: data[i], y1: data[i + 1], x2: data[i + 2], y2: data[i + 3] });
	}
	if (segments.length === 0) return null;

	// Distance to the nearest outline pixel, computed once. Testing whether a
	// point sits on the page's boundary is then a single lookup instead of a
	// walk across the tolerance band, which is what brought the whole search
	// inside the budget.
	const away = keep(new cv.Mat());
	cv.bitwise_not(outline, away);
	const distance = keep(new cv.Mat());
	cv.distanceTransform(away, distance, cv.DIST_L2, 3);

	const perEdge = EDGES.map(([from, to]) => {
		const base = lineThrough(rough[from], rough[to]);
		return [
			base,
			...candidateLines(base, segments, {
				angleTolerance: SEARCH_ANGLE,
				groupAngle: SEARCH_GROUP_ANGLE,
				groupDistance: width * SEARCH_GROUP_DISTANCE,
				keep: SEARCH_LINES_PER_EDGE
			})
		];
	});

	const band = Math.max(2, Math.round(width * SUPPORT_BAND));
	const reach = Math.max(3, Math.round(width * CONTRAST_REACH));
	const frameArea = frame.width * frame.height;
	// What the rough quad already manages. Putting the edges ON the page's
	// boundary is the one thing this search exists to do, so a winner that does
	// it no better than the shape it started from has not found the page — it
	// has found another way of being wrong. Measured over real captures every
	// good outcome improves this a lot (0.12 to 0.87, 0.16 to 0.70, 0.15 to
	// 0.31); the one that produced a visibly loose crop was the only one to go
	// backwards, 0.27 to 0.24.
	const roughSupport = Math.min(
		...EDGES.map(([from, to]) => edgeSupport(distance, rough[from], rough[to], band, frame))
	);
	let best: Corners | null = null;
	let bestScore = -1;
	let bestSupport = -1;

	for (const top of perEdge[0]) {
		for (const right of perEdge[1]) {
			for (const bottom of perEdge[2]) {
				for (const left of perEdge[3]) {
					const meeting = quadFromLines(top, right, bottom, left);
					if (!meeting) continue;
					// Four lines bound a quad without saying which corner is the
					// top-left one. Taking the labels from which line played which
					// role gets that wrong whenever the search puts the page's
					// bottom edge in the top slot: the page then comes out
					// mirrored, or turned through half a circle, and it scores
					// exactly the same as the right way up because it is built
					// from the very same four lines. So name the corners from
					// where they actually are, the way the rough pass does.
					const quad = orderCorners([meeting.tl, meeting.tr, meeting.br, meeting.bl]);
					// Cheap geometry first. Most combinations of four lines meet
					// in a bow tie or far outside the picture, and none of those
					// deserve a pixel walk.
					if (!withinFrame(quad, frame)) continue;
					if (!isConvexQuad(quad)) continue;
					// Ordering a convex quad always winds it this way, so this is
					// a guard against a degenerate one rather than a live filter.
					if (quadWinding(quad) <= 0) continue;
					if (quadAspect(quad) > MAX_ASPECT) continue;
					// The same reasoning as the capture gate below, applied where
					// the quad is BUILT rather than after the fact: perspective
					// skews a rectangle, it does not turn it into a dart. Four
					// lines picked from a pool are under no such obligation, and
					// without this a wildly skewed one scored respectably on
					// support and contrast and was handed back as a page.
					if (worstCornerSkew(quad) > MAX_CORNER_SKEW) continue;

					const area = quadArea(quad) / frameArea;
					if (area < SEARCH_MIN_FRACTION || area > SEARCH_MAX_FRACTION) continue;

					const contrasts = EDGES.map(([from, to]) =>
						edgeContrast(gray, quad, quad[from], quad[to], reach)
					);
					if (Math.min(...contrasts) < CONTRAST_FLOOR) continue;

					const supports = EDGES.map(([from, to]) =>
						edgeSupport(distance, quad[from], quad[to], band, frame)
					);
					const meanContrast = contrasts.reduce((a, b) => a + b, 0) / 4;
					const worstSupport = Math.min(...supports);
					const score =
						WEIGHT_SUPPORT * worstSupport +
						WEIGHT_CONTRAST * Math.min(1, meanContrast / CONTRAST_FULL) +
						WEIGHT_AREA * area;
					if (score > bestScore) {
						bestScore = score;
						bestSupport = worstSupport;
						best = quad;
					}
				}
			}
		}
	}

	return bestSupport > roughSupport ? best : null;
}

/** A corner a little outside the picture is a page running off the edge; one
 *  far outside is two lines that happened to cross out there. */
function withinFrame(quad: Corners, frame: Frame): boolean {
	const marginX = frame.width * 0.1;
	const marginY = frame.height * 0.1;
	return (['tl', 'tr', 'br', 'bl'] as const).every(
		(key) =>
			quad[key].x >= -marginX &&
			quad[key].y >= -marginY &&
			quad[key].x <= frame.width + marginX &&
			quad[key].y <= frame.height + marginY
	);
}

/** The share of an edge that runs along the mask's outline. */
function edgeSupport(
	distance: InstanceType<CV['Mat']>,
	from: Point,
	to: Point,
	band: number,
	frame: Frame
): number {
	const length = Math.hypot(to.x - from.x, to.y - from.y);
	if (length === 0) return 0;
	const steps = Math.max(8, Math.round(length / SAMPLE_STEP));
	let on = 0;
	for (let i = 0; i <= steps; i++) {
		const t = i / steps;
		const x = Math.round(from.x + (to.x - from.x) * t);
		const y = Math.round(from.y + (to.y - from.y) * t);
		if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) continue;
		if (distance.floatAt(y, x) <= band) on++;
	}
	return on / (steps + 1);
}

/**
 * How much brighter it is just inside an edge than just outside, as a share of
 * full scale, taken as the MEDIAN along the edge so that a shadow or a corner
 * of something overlapping cannot decide it.
 *
 * This is what stops the search collapsing onto the text block. A line of type
 * is a strong, straight, well-supported edge — and it has paper on both sides,
 * where the edge of a page has paper on one side and a desk on the other.
 * Without this term the search happily cropped four paragraphs out of the
 * middle of the page and scored it better than the page.
 */
export function edgeContrast(
	gray: InstanceType<CV['Mat']>,
	quad: Corners,
	from: Point,
	to: Point,
	reach: number
): number {
	const length = Math.hypot(to.x - from.x, to.y - from.y);
	if (length === 0) return 0;
	const middle = {
		x: (quad.tl.x + quad.tr.x + quad.br.x + quad.bl.x) / 4,
		y: (quad.tl.y + quad.tr.y + quad.br.y + quad.bl.y) / 4
	};
	let normalX = -(to.y - from.y) / length;
	let normalY = (to.x - from.x) / length;
	// Point the normal away from the middle of the quad, so "outside" means
	// outside whichever edge this is.
	const midX = (from.x + to.x) / 2;
	const midY = (from.y + to.y) / 2;
	const toward = (midX + normalX - middle.x) ** 2 + (midY + normalY - middle.y) ** 2;
	const away = (midX - normalX - middle.x) ** 2 + (midY - normalY - middle.y) ** 2;
	if (toward < away) {
		normalX = -normalX;
		normalY = -normalY;
	}

	const steps = Math.max(8, Math.round(length / SAMPLE_STEP));
	const differences: number[] = [];
	for (let i = 1; i < steps; i++) {
		const t = i / steps;
		const px = from.x + (to.x - from.x) * t;
		const py = from.y + (to.y - from.y) * t;
		const inX = Math.round(px - normalX * reach);
		const inY = Math.round(py - normalY * reach);
		const outX = Math.round(px + normalX * reach);
		const outY = Math.round(py + normalY * reach);
		if (inX < 0 || inY < 0 || inX >= gray.cols || inY >= gray.rows) continue;
		if (outX < 0 || outY < 0 || outX >= gray.cols || outY >= gray.rows) continue;
		differences.push(gray.ucharPtr(inY, inX)[0] - gray.ucharPtr(outY, outX)[0]);
	}
	if (differences.length === 0) return 0;
	differences.sort((a, b) => a - b);
	return differences[differences.length >> 1] / 255;
}
