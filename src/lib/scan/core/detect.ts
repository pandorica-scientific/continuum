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
/** Blur before thresholding: enough that text does not fragment the page. */
const SEGMENT_BLUR = 7;
/** Closing kernel, to seal the holes dark text punches in the page mask. */
const SEGMENT_CLOSE = 9;
/** Polygon tolerance, as a share of the hull's perimeter. */
const APPROX_EPSILON = 0.02;

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
export function detectOnce(cv: CV, frame: Frame, options?: { gates?: boolean }): DetectState {
	const gates = options?.gates ?? true;

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
		// Text punches holes in the page region; closing seals them so the page
		// is one contour rather than a constellation of paragraphs.
		const kernel = keep(
			cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(SEGMENT_CLOSE, SEGMENT_CLOSE))
		);
		cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, kernel);

		const contours = keep(new cv.MatVector());
		const hierarchy = keep(new cv.Mat());
		cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

		const frameArea = frame.width * frame.height;
		let best: Corners | null = null;
		let bestArea = 0;

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
			const approx = keep(new cv.Mat());
			cv.approxPolyDP(hull, approx, APPROX_EPSILON * cv.arcLength(hull, true), true);
			if (approx.rows !== 4 || !cv.isContourConvex(approx)) continue;

			const points: Point[] = [];
			for (let r = 0; r < 4; r++) points.push({ x: approx.intAt(r, 0), y: approx.intAt(r, 1) });
			const corners = orderCorners(points);
			if (quadAspect(corners) > MAX_ASPECT) continue;

			best = corners;
			bestArea = area;
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
 * Mean brightness within the detected page's bounding box.
 *
 * The box rather than the exact quad: a rectangle is one `roi` call against a
 * Mat that already exists, where masking the quad means allocating a full-frame
 * mask per frame. On a tilted page the box carries a little desk in the
 * corners, which moves the average by a few levels — far less than the error
 * this replaces.
 */
function meanInside(cv: CV, keep: Arena, gray: InstanceType<CV['Mat']>, corners: Corners): number {
	const xs = [corners.tl.x, corners.tr.x, corners.br.x, corners.bl.x];
	const ys = [corners.tl.y, corners.tr.y, corners.br.y, corners.bl.y];
	const left = Math.max(0, Math.floor(Math.min(...xs)));
	const top = Math.max(0, Math.floor(Math.min(...ys)));
	const right = Math.min(gray.cols, Math.ceil(Math.max(...xs)));
	const bottom = Math.min(gray.rows, Math.ceil(Math.max(...ys)));
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
