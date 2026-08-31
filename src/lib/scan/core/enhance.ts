// SPDX-License-Identifier: AGPL-3.0-or-later
// Warp, then enhance.
//
// Every allocation goes through the arena. One page here is roughly 118 MB of
// Mat — a 12 MP source, a 2480×3508 warp, and four single-channel working
// buffers — so a single missed `.delete()` kills the tab on page two.
//
// `cv` is a parameter for the same reason as in detect.ts: this module never
// imports the WASM bundle.

import { withMats, type Arena } from './arena.ts';
import { fullFrameCorners, outputSize } from './geometry.ts';
import type { CV } from './opencv.ts';
import type { Corners, Frame, PageMode } from './types.ts';

/**
 * The illumination field is low-frequency, so computing it at quarter scale and
 * upsampling is visually identical and about sixteen times cheaper. The blur is
 * the most expensive step in the whole pipeline — 1–2 s on a mid-range phone at
 * full resolution — and it dominates everything else.
 */
const BACKGROUND_SCALE = 0.25;
/** sigma ≈ outputWidth / 60. */
const BACKGROUND_SIGMA_DIVISOR = 60;
/**
 * blockSize MUST scale with resolution, or the same page binarizes differently
 * at 1000px and at 2500px — which reads as the scanner being unreliable.
 */
const BLOCK_DIVISOR = 100;
const THRESHOLD_C = 10;

export function renderPage(cv: CV, source: Frame, corners: Corners | null, mode: PageMode): Frame {
	// `original` is the upload path's escape hatch: EXIF rotation only, applied
	// by the caller before this. Deliberately does nothing here, because it has
	// to work when detection has failed completely.
	if (mode === 'original') return { ...source, data: new Uint8ClampedArray(source.data) };

	// A failed detection degrades to the full frame, never to an error.
	const quad = corners ?? fullFrameCorners(source.width, source.height);
	const { width, height } = outputSize(quad);

	return withMats((keep): Frame => {
		const src = keep(cv.matFromImageData(source as ImageData));
		const from = keep(
			cv.matFromArray(4, 1, cv.CV_32FC2, [
				quad.tl.x,
				quad.tl.y,
				quad.tr.x,
				quad.tr.y,
				quad.br.x,
				quad.br.y,
				quad.bl.x,
				quad.bl.y
			])
		);
		const to = keep(cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, width, 0, width, height, 0, height]));
		const transform = keep(cv.getPerspectiveTransform(from, to));
		const warped = keep(new cv.Mat());
		cv.warpPerspective(src, warped, transform, new cv.Size(width, height), cv.INTER_CUBIC);

		const out = keep(new cv.Mat());
		if (mode === 'color') {
			balanceColour(cv, keep, warped, out);
		} else {
			const flat = keep(flatten(cv, keep, warped, width));
			if (mode === 'grayscale') {
				cv.cvtColor(flat, out, cv.COLOR_GRAY2RGBA);
			} else {
				const binary = keep(new cv.Mat());
				cv.adaptiveThreshold(
					flat,
					binary,
					255,
					cv.ADAPTIVE_THRESH_GAUSSIAN_C,
					cv.THRESH_BINARY,
					odd(Math.round(width / BLOCK_DIVISOR)),
					THRESHOLD_C
				);
				// A 2×2 open drops the speckle adaptive thresholding leaves in the
				// margins without eating thin strokes.
				const speck = keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(2, 2)));
				cv.morphologyEx(binary, binary, cv.MORPH_OPEN, speck);
				cv.cvtColor(binary, out, cv.COLOR_GRAY2RGBA);
			}
		}

		// Copy out BEFORE the arena unwinds: `out.data` is a view into the WASM
		// heap and becomes garbage the moment the Mat is deleted.
		return { data: new Uint8ClampedArray(out.data), width: out.cols, height: out.rows };
	});
}

/**
 * CLAHE on the L channel of LAB: fixes uneven room lighting without the plastic
 * look global normalisation gives.
 */
function balanceColour(
	cv: CV,
	keep: Arena,
	warped: InstanceType<CV['Mat']>,
	out: InstanceType<CV['Mat']>
) {
	const lab = keep(new cv.Mat());
	cv.cvtColor(warped, lab, cv.COLOR_RGBA2RGB);
	cv.cvtColor(lab, lab, cv.COLOR_RGB2Lab);

	const planes = keep(new cv.MatVector());
	cv.split(lab, planes);
	const l = keep(planes.get(0));
	const a = keep(planes.get(1));
	const b = keep(planes.get(2));

	// `new cv.CLAHE(...)`, not `createCLAHE` — the factory does not exist in the
	// opencv.js build, though it does in the C++ API and in most tutorials.
	const clahe = keep(new cv.CLAHE(2.0, new cv.Size(8, 8)));
	clahe.apply(l, l);

	// split() copies the planes out, so the adjusted L has to be put back.
	const merged = keep(new cv.MatVector());
	merged.push_back(l);
	merged.push_back(a);
	merged.push_back(b);
	const balanced = keep(new cv.Mat());
	cv.merge(merged, balanced);
	cv.cvtColor(balanced, balanced, cv.COLOR_Lab2RGB);
	cv.cvtColor(balanced, out, cv.COLOR_RGB2RGBA);
}

/**
 * Divide out the illumination field. Kills a desk lamp's gradient or a hand
 * shadow in one pass, with no model. Returns a single-channel Mat whose
 * ownership passes to the caller.
 */
function flatten(cv: CV, keep: Arena, warped: InstanceType<CV['Mat']>, width: number) {
	const gray = keep(new cv.Mat());
	cv.cvtColor(warped, gray, cv.COLOR_RGBA2GRAY);

	const small = keep(new cv.Mat());
	cv.resize(
		gray,
		small,
		new cv.Size(
			Math.max(1, Math.round(gray.cols * BACKGROUND_SCALE)),
			Math.max(1, Math.round(gray.rows * BACKGROUND_SCALE))
		),
		0,
		0,
		cv.INTER_AREA
	);
	cv.GaussianBlur(
		small,
		small,
		new cv.Size(0, 0),
		(width / BACKGROUND_SIGMA_DIVISOR) * BACKGROUND_SCALE
	);

	const background = keep(new cv.Mat());
	cv.resize(small, background, new cv.Size(gray.cols, gray.rows), 0, 0, cv.INTER_LINEAR);

	const divided = keep(new cv.Mat());
	// Scaled by 255 so the quotient lands back in 0–255 rather than around 1.
	cv.divide(gray, background, divided, 255, cv.CV_8U);
	// Rule 3: ownership transfers explicitly, and the caller keep()s it again.
	return keep.release(divided);
}

const odd = (n: number) => (n < 3 ? 3 : n % 2 === 0 ? n + 1 : n);
