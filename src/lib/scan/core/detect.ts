// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Six OpenCV calls and three quality gates.
//
// Owned rather than taken from jscanify: its convenience wrappers allocate
// internally, it exposes none of the gates, and auditing someone else's
// allocation discipline on every upgrade is worse than owning this much code.
// It also keeps 30 MB out of the bundle, next to an opencv.js that is already
// 10 MB.
//
// `cv` is a PARAMETER, not an import. That keeps this module free of the WASM
// bundle, so anything pure in it — `orderCorners` — stays testable under node.

import { withMats, type Arena } from './arena.ts';
import { quadAspect } from './geometry.ts';
import {
	EDGES,
	candidateLines,
	isConvexQuad,
	lineThrough,
	quadWinding,
	quadArea,
	quadFromLines,
	worstCornerSkew,
	type Segment
} from './lines.ts';
import type { CV } from './opencv.ts';
import type { Corners, DetectState, Frame, Point } from './types.ts';

/**
 * Detection runs here and nowhere else. Detecting on a 4K canvas at 10 fps is a
 * slideshow on a mid-range Android, and none of the gates need the extra pixels.
 */
export const DETECT_WIDTH = 640;

/** Below this share of the frame the page is too far away to be worth capturing. */
const MIN_AREA_FRACTION = 0.25;
/** Mean luminance below this is a room too dark to read the page in. */
const MIN_MEAN_LUMA = 40;
/** Variance of the Laplacian below this is out of focus. */
const MIN_SHARPNESS = 55;

/**
 * A shape must be at least this much of the frame to be a PAGE CANDIDATE at
 * all. Deliberately lower than MIN_AREA_FRACTION: a page photographed from too
 * far away should still be found, so the guidance can say "move closer" rather
 * than pretend there is nothing there.
 */
const MIN_CANDIDATE_FRACTION = 0.08;
/** A quad covering nearly everything is the FRAME, not a page lying on a desk. */
const MAX_CANDIDATE_FRACTION = 0.92;
/** A page is between square and about 1:2. A line of text is 20:1 or worse. */
const MAX_ASPECT = 4;
/**
 * How far the worst corner may sit from square, in degrees.
 *
 * Perspective skews a rectangle; it does not turn it into a dart. 35° allows a
 * comfortably angled shot of a page on a desk while rejecting the wildly skewed
 * quads that produce an unreadable capture — which the user only discovers
 * after saving, which is the worst moment to discover it.
 */
const MAX_CORNER_SKEW = 35;
/** Blur before thresholding: enough that text does not fragment the page. */
const SEGMENT_BLUR = 7;
/**
 * Opening kernel, applied BEFORE the close.
 *
 * Otsu marks every bright thing, not only the page, so a mottled desk leaves
 * specks and hairline bridges attached to the sheet. The convex hull then
 * stretches out to reach them, and the quad balloons past the page's real
 * corners into the background — worst when the page does not fill the frame,
 * which is exactly when a user is furthest away and least able to see it.
 * Opening erodes those bridges away before anything else looks at the shape.
 * Measured on real captures it lifts solidity from ~0.86 to ~0.95 and pulls the
 * detected aspect ratio back onto A4.
 */
const SEGMENT_OPEN = 9;
/** Closing kernel, to seal the holes dark text punches in the page mask. */
const SEGMENT_CLOSE = 9;
/**
 * A margin of background added around the mask before contours are traced.
 *
 * A page photographed close up runs off the edge of the frame, and its bright
 * region then touches the image border. Without a margin there is no closed
 * shape there to find, so a page that fills the view — the best-framed shot
 * someone can take — is the one the detector misses. Padding gives the region
 * somewhere to close against, and the corners come back sitting on the old
 * boundary, which is exactly right: the crop is the part that was in view.
 *
 * Honestly labelled: this is a precaution taken from the reference reading, and
 * on every sample available it changed nothing — the regions closed without it.
 * It costs one small allocation, so it stays, but it has not been shown to earn
 * its place and should be the first thing questioned if this file needs
 * simplifying.
 */
const SEGMENT_PAD = 8;
/**
 * How much of its own convex hull the page region must fill.
 *
 * A clean sheet is very nearly its own hull. A blob still trailing a bridge of
 * background is not, and this is what tells them apart — so a bad detection
 * becomes no outline at all rather than a confident, wrong one.
 */
const MIN_SOLIDITY = 0.9;
/**
 * ...and how much it must fill once there is a refinement pass to check the
 * answer.
 *
 * The strict figure above is a proxy for "is this one sheet of paper", made
 * necessary because nothing downstream could tell. It is also what rejected
 * every hard case measured: a page with a shadow across it came in at 0.68, a
 * page with a second sheet touching it at 0.87, two more real captures at 0.76
 * and 0.84. All four are pages; all four were reported as nothing at all.
 *
 * The refinement pass does not need the proxy, because it checks the thing
 * itself — whether four straight, supported, paper-on-one-side edges bound the
 * region. So propose generously and let that decide. A candidate admitted only
 * by this looser floor is NOT a detection on its own: if the search cannot
 * confirm it, it is dropped rather than shown.
 */
const SEARCH_MIN_SOLIDITY = 0.6;

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
const CONTRAST_REACH = 0.016;
/** A page edge has paper on one side and desk on the other. Below this it has
 *  paper on both, which means it is a line of text, not the edge of a page. */
const CONTRAST_FLOOR = 0.04;
/** Brightness difference treated as full marks, so a strong edge and a very
 *  strong one are not separated by noise. */
const CONTRAST_FULL = 0.25;
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
 * Two settings, because the two moments have very different budgets.
 *
 * While the user is moving the phone the loop has about 110 ms a frame and the
 * outline only has to help them aim. Once they have HELD STILL, nothing is
 * waiting on the next frame — the stability ring runs for a second and a half
 * before the shutter fires — so a slower, more thorough pass is free, and it is
 * the corners from that pass which the page is cut along.
 */
export type RefineMode = 'none' | 'thorough';
/**
 * Polygon tolerances, as a share of the hull's perimeter, tried in order.
 *
 * One fixed value does not work on real photographs. A page in a picture has a
 * curled corner, a shadow along one edge or a thumb holding it down, and its
 * convex hull then simplifies to FIVE points at 0.02 — which the four-corner
 * check threw away, so the detector found the page, measured it correctly, and
 * reported nothing. Measured on real camera photos the page needed 0.03 and
 * 0.04 where a clean screenshot needed 0.02.
 *
 * Sweeping upward keeps the tightest tolerance that yields a quad, so a page
 * that genuinely is a clean rectangle is not coarsened for the sake of one that
 * is not.
 */
const APPROX_EPSILONS = [0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.1];

/** The illumination field is estimated at an eighth of the size. */
const FIELD_SCALE = 8;
/** Dividing by the field rescales around this, so paper lands near white. */
const FIELD_MIDPOINT = 128;
/**
 * How two candidates found by DIFFERENT means are compared.
 *
 * Deliberately measured from the photograph alone — brightness either side of
 * each edge, how square the corners are, how much of the frame it covers — and
 * never from the mask that proposed it. Support against a mask says only "these
 * lines sit on the boundary MY segmentation drew", which is not a claim two
 * different segmentations can argue about.
 */
const JUDGE_CONTRAST = 0.45;
const JUDGE_SQUARE = 0.25;
const JUDGE_AREA = 0.3;

/**
 * The photograph with its lighting evened out.
 *
 * Otsu picks ONE threshold for the whole picture, so a shadow falling across a
 * page puts half of it on the wrong side: measured on a real capture, the mask
 * kept 0.68 of its own hull because a shadow down the right-hand side had bitten
 * a piece out of the page. Estimating the illumination and dividing it out fixes
 * that particular photograph — and breaks others, because dividing amplifies the
 * noise in a dark background until the speckle sticks to the page.
 *
 * So this is not a replacement for the plain reading. It is a SECOND opinion,
 * and `detectBest` keeps whichever of the two produces the better crop.
 *
 * The field is low-frequency, so it is estimated on a thumbnail: a blur wide
 * enough to erase a page costs nothing at an eighth of the size.
 */
export function flattenLighting(cv: CV, frame: Frame): Frame {
	return withMats((keep): Frame => {
		const src = keep(cv.matFromImageData(frame as ImageData));
		const gray = keep(new cv.Mat());
		cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

		const small = keep(new cv.Mat());
		const width = Math.max(4, Math.round(frame.width / FIELD_SCALE));
		const height = Math.max(4, Math.round(frame.height / FIELD_SCALE));
		cv.resize(gray, small, new cv.Size(width, height), 0, 0, cv.INTER_AREA);
		const blurred = keep(new cv.Mat());
		cv.GaussianBlur(small, blurred, new cv.Size(0, 0), Math.max(1, width / 4));
		const field = keep(new cv.Mat());
		cv.resize(blurred, field, new cv.Size(frame.width, frame.height), 0, 0, cv.INTER_LINEAR);

		const evened = keep(new cv.Mat());
		cv.divide(gray, field, evened, FIELD_MIDPOINT, cv.CV_8U);
		const out = keep(new cv.Mat());
		cv.cvtColor(evened, out, cv.COLOR_GRAY2RGBA);
		return {
			data: new Uint8ClampedArray(out.data),
			width: frame.width,
			height: frame.height
		};
	});
}

export function orderCorners(points: Point[]): Corners {
	// Sum and difference, which needs no trigonometry: the top-left corner has
	// the smallest x+y and the bottom-right the largest, while the top-right has
	// the largest x−y and the bottom-left the smallest.
	const bySum = [...points].sort((a, b) => a.x + a.y - (b.x + b.y));
	const byDiff = [...points].sort((a, b) => a.x - a.y - (b.x - b.y));
	return { tl: bySum[0], br: bySum[3], bl: byDiff[0], tr: byDiff[3] };
}

/**
 * One frame in, one state out. `frame` is expected to be DETECT_WIDTH wide;
 * the caller scales the corners back up before warping.
 *
 * `gates: false` on the upload path. The photo is whatever it is, and rejecting
 * it helps nobody when there is no viewfinder to retake with.
 */
export function detectOnce(
	cv: CV,
	frame: Frame,
	options?: { gates?: boolean; refine?: RefineMode }
): DetectState {
	const gates = options?.gates ?? true;
	// Off while tracking, by default. The mask's boundary is smooth and
	// approximate — good enough to aim by — and the caller turns this on at the
	// moment the page stops moving, when there is time to do better.
	//
	// Better matters most on an imperfect page: a folded corner drags the convex
	// hull out of shape, while a line fitted along the edge either side of the
	// fold does not care about it at all.
	const refining = options?.refine ?? 'none';

	return withMats((keep): DetectState => {
		const src = keep(cv.matFromImageData(frame as ImageData));
		const gray = keep(new cv.Mat());
		cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

		// Segment on BRIGHTNESS, not on edges.
		//
		// Edge detection is the intuitive choice and it is the wrong one here.
		// Black text on white paper produces far stronger gradients than a white
		// page against a desk does, so Canny reliably finds the typography and
		// misses the document. Measured against real photographs it picked out
		// single lines of text — 0.2% of the frame at 20:1 — and found the page
		// in none of them. Otsu splits the histogram between paper and
		// everything else, which is a property text does not disturb.
		const work = keep(new cv.Mat());
		cv.GaussianBlur(gray, work, new cv.Size(SEGMENT_BLUR, SEGMENT_BLUR), 0);
		const mask = keep(new cv.Mat());
		cv.threshold(work, mask, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
		// Open first, to shed the specks and bridges a patterned desk leaves
		// stuck to the page; then close, to seal the holes text punches in it.
		// Both matter, and the order does: closing first would weld the bridges
		// on permanently.
		const opening = keep(
			cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(SEGMENT_OPEN, SEGMENT_OPEN))
		);
		cv.morphologyEx(mask, mask, cv.MORPH_OPEN, opening);
		const closing = keep(
			cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(SEGMENT_CLOSE, SEGMENT_CLOSE))
		);
		cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, closing);

		const padded = keep(new cv.Mat());
		cv.copyMakeBorder(
			mask,
			padded,
			SEGMENT_PAD,
			SEGMENT_PAD,
			SEGMENT_PAD,
			SEGMENT_PAD,
			cv.BORDER_CONSTANT,
			new cv.Scalar(0, 0, 0, 0)
		);

		const contours = keep(new cv.MatVector());
		const hierarchy = keep(new cv.Mat());
		cv.findContours(padded, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

		const frameArea = frame.width * frame.height;
		let best: Corners | null = null;
		let bestArea = 0;
		// Whether the winning region was clean enough to stand on its own, which
		// decides what happens if refinement finds nothing.
		let bestIsClean = false;
		const solidityFloor = refining === 'none' ? MIN_SOLIDITY : SEARCH_MIN_SOLIDITY;

		for (let i = 0; i < contours.size(); i++) {
			// Rule 2 of the arena contract: this is a NEW Mat every call, and
			// deleting the MatVector does not free it.
			const contour = keep(contours.get(i));
			const area = cv.contourArea(contour);
			if (area <= bestArea) continue;
			if (area < frameArea * MIN_CANDIDATE_FRACTION) continue;
			if (area > frameArea * MAX_CANDIDATE_FRACTION) continue;

			// Approximate the convex HULL rather than the raw contour. A real
			// page has a curled corner, a shadow, or a thumb holding it down, and
			// the raw outline then approximates to five or six points and is
			// thrown away. The hull ignores all of that.
			const hull = keep(new cv.Mat());
			cv.convexHull(contour, hull, false, true);
			// A page is very nearly its own convex hull. Anything trailing a
			// bridge of background is not, and would be turned into a quad that
			// reaches out to the far end of it.
			const hullArea = cv.contourArea(hull);
			if (hullArea <= 0) continue;
			const solidity = area / hullArea;
			if (solidity < solidityFloor) continue;
			const approx = keep(new cv.Mat());
			const perimeter = cv.arcLength(hull, true);
			for (const epsilon of APPROX_EPSILONS) {
				cv.approxPolyDP(hull, approx, epsilon * perimeter, true);
				if (approx.rows <= 4) break;
			}
			if (approx.rows !== 4 || !cv.isContourConvex(approx)) continue;

			const points: Point[] = [];
			for (let r = 0; r < 4; r++) {
				// Back out of the padded frame's coordinates, and clamp: a corner
				// found in the margin belongs on the edge of the real image.
				points.push({
					x: Math.min(frame.width, Math.max(0, approx.intAt(r, 0) - SEGMENT_PAD)),
					y: Math.min(frame.height, Math.max(0, approx.intAt(r, 1) - SEGMENT_PAD))
				});
			}
			const corners = orderCorners(points);
			if (quadAspect(corners) > MAX_ASPECT) continue;

			best = corners;
			bestArea = area;
			bestIsClean = solidity >= MIN_SOLIDITY;
		}

		if (best && refining !== 'none') {
			// The corners so far are the convex hull of everything Otsu called
			// bright, simplified to four points. That is one shape whether or not
			// it is one sheet of paper: a second page in frame, or a laptop lid
			// touching the page, joins it, and the hull then spans both. Nothing
			// downstream can tell — the quad is convex, its solidity is fine, and
			// the crop comes out sheared across two objects.
			//
			// So look again, at the mask's OUTLINE rather than its filled shape,
			// and ask which four straight lines actually bound a page.
			const found = searchQuad(cv, keep, gray, mask, best, frame);
			// Nothing confirmed. A region clean enough for the strict floor keeps
			// the corners it already had — that is exactly the answer this
			// detector gave before there was a search, and it is a good one. A
			// region admitted only by the looser floor has nothing to fall back
			// on, and a dented blob's convex hull is precisely the sheared,
			// unreadable crop the search exists to prevent.
			if (found) best = found;
			else if (!bestIsClean) best = null;
		}

		if (!best) {
			// Nothing found. If the whole frame is dark that is worth saying,
			// because it is probably why; otherwise there is simply no page in
			// view, and no outline — a speculative box is a claim the detector
			// has not made.
			if (gates && cv.mean(gray)[0] < MIN_MEAN_LUMA) {
				return { kind: 'rejected', corners: null, reason: 'dark' };
			}
			return { kind: 'searching' };
		}
		if (!gates) return { kind: 'detected', corners: best };

		if (bestArea < frameArea * MIN_AREA_FRACTION) {
			return { kind: 'rejected', corners: best, reason: 'small' };
		}
		if (worstCornerSkew(best) > MAX_CORNER_SKEW) {
			return { kind: 'rejected', corners: best, reason: 'angle' };
		}
		// Measure the PAGE, not the room.
		//
		// Averaged across the whole frame this gate fired constantly: a sheet of
		// paper lit well enough to read, lying on a dark desk that fills most of
		// the view, averages below the threshold. What matters is whether the
		// document is legible, and the document is the region just found.
		if (meanInside(cv, keep, gray, best) < MIN_MEAN_LUMA) {
			return { kind: 'rejected', corners: best, reason: 'dark' };
		}
		if (sharpness(cv, keep, gray) < MIN_SHARPNESS) {
			return { kind: 'rejected', corners: best, reason: 'blurry' };
		}
		return { kind: 'detected', corners: best };
	});
}

/**
 * Detect on a STILL, where there is time to be thorough.
 *
 * The live loop has about a tenth of a second and only has to help someone aim.
 * This runs once, after the shutter, with a second or two to spend — so rather
 * than trusting one reading of the picture it takes two, by different means,
 * and keeps whichever produced the better crop.
 *
 * Neither reading wins outright, which is the whole reason for doing both.
 * Measured over real captures, evening out the lighting rescued a page with a
 * shadow across it (its mask went from filling 0.68 of its own hull to 0.92)
 * and wrecked two that were already fine (0.93 down to 0.83). Running both and
 * judging the RESULTS turns that dilemma into a choice.
 */
export function detectBest(cv: CV, frame: Frame): DetectState {
	const plain = detectOnce(cv, frame, { gates: false, refine: 'thorough' });
	const evened = detectOnce(cv, flattenLighting(cv, frame), {
		gates: false,
		refine: 'thorough'
	});

	const candidates = [plain, evened]
		.map((state) => ('corners' in state ? state.corners : null))
		.filter((corners): corners is Corners => corners !== null);
	if (candidates.length === 0) return { kind: 'searching' };

	return withMats((keep): DetectState => {
		const src = keep(cv.matFromImageData(frame as ImageData));
		const gray = keep(new cv.Mat());
		cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

		let best: Corners | null = null;
		let bestScore = -1;
		for (const corners of candidates) {
			const score = judgeQuad(gray, corners, frame);
			if (score > bestScore) {
				bestScore = score;
				best = corners;
			}
		}
		if (!best) return { kind: 'searching' };
		return { kind: 'detected', corners: best };
	});
}

/**
 * How good a crop this is, judged from the PHOTOGRAPH alone.
 *
 * That restriction is the point: it lets two candidates found by different
 * segmentations be compared on the same terms.
 *
 * It CHOOSES between candidates; it does not veto them. Each reading has
 * already applied its own gates to get this far, and letting the chooser
 * overrule those threw away a perfectly good crop whose one weak edge lay
 * against a background almost the same brightness as the paper.
 */
function judgeQuad(gray: InstanceType<CV['Mat']>, quad: Corners, frame: Frame): number {
	const reach = Math.max(3, Math.round(frame.width * CONTRAST_REACH));
	const contrasts = EDGES.map(([from, to]) =>
		edgeContrast(gray, quad, quad[from], quad[to], reach)
	);
	const meanContrast = contrasts.reduce((a, b) => a + b, 0) / 4;
	const square = 1 - worstCornerSkew(quad) / 90;
	const area = quadArea(quad) / (frame.width * frame.height);
	return (
		JUDGE_CONTRAST * Math.min(1, meanContrast / CONTRAST_FULL) +
		JUDGE_SQUARE * square +
		JUDGE_AREA * area
	);
}

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
function searchQuad(
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
		SEGMENT_PAD,
		SEGMENT_PAD,
		SEGMENT_PAD,
		SEGMENT_PAD,
		cv.BORDER_CONSTANT,
		new cv.Scalar(0, 0, 0, 0)
	);
	const thin = keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3)));
	const wide = keep(new cv.Mat());
	cv.morphologyEx(bordered, wide, cv.MORPH_GRADIENT, thin);
	const outline = keep(new cv.Mat());
	keep(wide.roi(new cv.Rect(SEGMENT_PAD, SEGMENT_PAD, frame.width, frame.height))).copyTo(outline);

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
function edgeContrast(
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

/**
 * Mean brightness within the detected page's bounding box.
 *
 * The middle of the box rather than the exact quad: a rectangle is one `roi`
 * call against a Mat that already exists, where masking the quad means
 * allocating a full-frame mask every frame. Shrinking to the middle is what
 * keeps the desk out of it — on a tilted page the bounding box holds four
 * triangles of whatever the page is lying on, and against dark wood that was
 * enough to report a well-lit page as too dark to read.
 */
function meanInside(cv: CV, keep: Arena, gray: InstanceType<CV['Mat']>, corners: Corners): number {
	const xs = [corners.tl.x, corners.tr.x, corners.br.x, corners.bl.x];
	const ys = [corners.tl.y, corners.tr.y, corners.br.y, corners.bl.y];
	const rawLeft = Math.min(...xs);
	const rawTop = Math.min(...ys);
	const rawRight = Math.max(...xs);
	const rawBottom = Math.max(...ys);
	// Inset by a fifth on every side: comfortably inside the page at any tilt a
	// scan is worth taking at.
	const insetX = (rawRight - rawLeft) * 0.2;
	const insetY = (rawBottom - rawTop) * 0.2;
	const left = Math.max(0, Math.floor(rawLeft + insetX));
	const top = Math.max(0, Math.floor(rawTop + insetY));
	const right = Math.min(gray.cols, Math.ceil(rawRight - insetX));
	const bottom = Math.min(gray.rows, Math.ceil(rawBottom - insetY));
	if (right - left < 1 || bottom - top < 1) return cv.mean(gray)[0];
	const region = keep(gray.roi(new cv.Rect(left, top, right - left, bottom - top)));
	return cv.mean(region)[0];
}

/** Variance of the Laplacian: the standard cheap focus measure. */
function sharpness(cv: CV, keep: Arena, gray: InstanceType<CV['Mat']>): number {
	const laplacian = keep(new cv.Mat());
	cv.Laplacian(gray, laplacian, cv.CV_64F);
	const mean = keep(new cv.Mat());
	const stddev = keep(new cv.Mat());
	cv.meanStdDev(laplacian, mean, stddev);
	const sd = stddev.doubleAt(0, 0);
	return sd * sd;
}
