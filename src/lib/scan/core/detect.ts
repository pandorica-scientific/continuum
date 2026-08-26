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

		// Cheapest gate first: a dark frame has nothing worth finding contours in.
		if (gates && cv.mean(gray)[0] < MIN_MEAN_LUMA) {
			return { kind: 'rejected', corners: null, reason: 'dark' };
		}

		const blurred = keep(new cv.Mat());
		cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
		const edges = keep(new cv.Mat());
		cv.Canny(blurred, edges, 60, 180);
		// Close one-pixel gaps in the page border. Without it a softly lit edge
		// breaks into four unusable arcs and nothing is ever found.
		const kernel = keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3)));
		cv.dilate(edges, edges, kernel);

		const contours = keep(new cv.MatVector());
		const hierarchy = keep(new cv.Mat());
		cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

		let best: Point[] | null = null;
		let bestArea = 0;
		for (let i = 0; i < contours.size(); i++) {
			// Rule 2 of the arena contract: this is a NEW Mat every call, and
			// deleting the MatVector does not free it.
			const contour = keep(contours.get(i));
			const area = cv.contourArea(contour);
			if (area <= bestArea) continue;

			const approx = keep(new cv.Mat());
			cv.approxPolyDP(contour, approx, 0.02 * cv.arcLength(contour, true), true);
			if (approx.rows !== 4) continue;

			bestArea = area;
			best = [];
			for (let r = 0; r < 4; r++) {
				best.push({ x: approx.intAt(r, 0), y: approx.intAt(r, 1) });
			}
		}

		// No page found means no outline: a speculative box is a claim the
		// detector has not made.
		if (!best) return { kind: 'searching' };

		const corners = orderCorners(best);
		if (!gates) return { kind: 'detected', corners };

		if (bestArea < frame.width * frame.height * MIN_AREA_FRACTION) {
			return { kind: 'rejected', corners, reason: 'small' };
		}
		if (sharpness(cv, keep, gray) < MIN_SHARPNESS) {
			return { kind: 'rejected', corners, reason: 'blurry' };
		}
		return { kind: 'detected', corners };
	});
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
