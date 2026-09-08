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
import { isStraight, meshMaps, outlineSpan } from './mesh.ts';
import type { CV } from './opencv.ts';
import type { Frame, Outline, PageMode } from './types.ts';

/**
 * Round a measured span to whole pixels, never to zero.
 *
 * `outlineSpan` measures along curves and comes back fractional; a Mat needs
 * integers, and a degenerate outline must not ask for a zero-sized one.
 */
function sized(span: { width: number; height: number }): { width: number; height: number } {
	return {
		width: Math.max(1, Math.round(span.width)),
		height: Math.max(1, Math.round(span.height))
	};
}

/**
 * Sample the page through its boundary curves, a band of rows at a time.
 *
 * `remap` reads a per-pixel source coordinate, which is what lets a curved
 * boundary be followed at all — a matrix cannot express one. The cost is the
 * maps themselves, hence the striping.
 */
function dewarp(
	cv: CV,
	keep: Arena,
	src: InstanceType<CV['Mat']>,
	out: InstanceType<CV['Mat']>,
	page: Outline,
	width: number,
	height: number
): void {
	out.create(height, width, src.type());
	for (let row = 0; row < height; row += REMAP_STRIP_ROWS) {
		const rows = Math.min(REMAP_STRIP_ROWS, height - row);
		const maps = meshMaps(page, width, height, row, rows);
		const mapX = keep(cv.matFromArray(rows, width, cv.CV_32FC1, Array.from(maps.x)));
		const mapY = keep(cv.matFromArray(rows, width, cv.CV_32FC1, Array.from(maps.y)));
		const band = keep(out.roi(new cv.Rect(0, row, width, rows)));
		cv.remap(src, band, mapX, mapY, cv.INTER_CUBIC, cv.BORDER_REPLICATE, new cv.Scalar());
		// `roi` is a VIEW, so what remap wrote is already in `out`; copying it
		// back would be a second full-size write for nothing.
		mapX.delete();
		mapY.delete();
		band.delete();
	}
}

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

/**
 * How many output rows are remapped at a time on a bowed page.
 *
 * The sampling maps are two floats per output pixel, so a full A4 page at 300
 * dpi would be about 140 MB of them at once — more than a 2 GB box can spare
 * beside the source frame and the warp it is already holding. A band is a
 * window onto the same surface, so striping costs nothing but a loop.
 */
const REMAP_STRIP_ROWS = 512;

export function renderPage(cv: CV, source: Frame, outline: Outline | null, mode: PageMode): Frame {
	// `original` is CROPPED but not cleaned up.
	//
	// It used to return the photograph whole, on the grounds that it was the
	// recovery for a detection that had gone wrong. But those are two different
	// wishes and it only served one: someone who wants the page cropped and the
	// colours left exactly as photographed — a passport, a card, anything whose
	// appearance IS the document — had to choose between the crop and the
	// colours. Cropping here gives them both.
	//
	// Nothing is lost. The uncropped photograph is still one tap away, in the
	// edge editor, where "Whole photo" sets the boundary to the full frame — and
	// when detection has failed there is no boundary to apply, so the escape
	// hatch below returns the picture untouched exactly as it always did.
	if (mode === 'original' && !outline) {
		return { ...source, data: new Uint8ClampedArray(source.data) };
	}

	// A failed detection degrades to the full frame, never to an error.
	const page: Outline = outline ?? { corners: fullFrameCorners(source.width, source.height) };
	const quad = page.corners;
	const flat = isStraight(page);
	// A bowed page is LONGER along its curve than across the chord between its
	// corners, so measuring corner-to-corner renders it squashed.
	const { width, height } = flat ? outputSize(quad) : sized(outlineSpan(page));

	return withMats((keep): Frame => {
		const src = keep(cv.matFromImageData(source as ImageData));
		const warped = keep(new cv.Mat());

		if (flat) {
			// Four points onto four points, exactly, in one matrix. Nothing about
			// the ordinary case changed when curves became possible.
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
			const to = keep(
				cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, width, 0, width, height, 0, height])
			);
			const transform = keep(cv.getPerspectiveTransform(from, to));
			cv.warpPerspective(src, warped, transform, new cv.Size(width, height), cv.INTER_CUBIC);
		} else {
			dewarp(cv, keep, src, warped, page, width, height);
		}

		const out = keep(new cv.Mat());
		if (mode === 'original') {
			// Geometry only. Every other mode goes on to even out the lighting or
			// binarize, and this one deliberately does neither: the pixels are the
			// ones the camera recorded, moved but not judged.
			warped.copyTo(out);
		} else if (mode === 'color') {
			balanceColour(cv, keep, warped, out, width);
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
 * Flat-field the lightness: take the room's lighting out of the picture and
 * leave the colours where they were.
 *
 * This used to be CLAHE on the same channel, and CLAHE is the wrong instrument
 * here. It equalises LOCAL contrast, so it does not merely remove a lamp's
 * gradient — it rewrites the relationship between light and dark everywhere,
 * pulls flat regions apart, and amplifies sensor noise in exactly the smooth
 * areas a photograph has most of. Hue survived it, because `a` and `b` were
 * never touched, but a duty-free bag and a laminated licence came back looking
 * washed out and grainy against the original, which is not what "Colour" should
 * mean when "Original" sits next to it.
 *
 * Dividing by the illumination field is the older and duller correction, and
 * it is the right one: a desk lamp's gradient and a hand's shadow are a slowly
 * varying multiplier over the picture, so dividing them out removes them and
 * leaves local contrast exactly as the sensor recorded it.
 *
 * Scaled by the field's own MEAN rather than by 255. The grey modes below scale
 * by 255 deliberately — that is what drives paper to white — but doing it here
 * would drive every photograph to white, which is only ever right for a page.
 * The mean preserves the picture's overall lightness and takes away nothing but
 * the gradient.
 */
/**
 * How far the illumination correction may push a single pixel.
 *
 * A desk lamp across a page is a gradient of maybe ±40%; anything beyond that
 * is not lighting, it is the document. Clamping is what stops a large evenly
 * coloured object — a passport cover, an ID card — being read as a shadow and
 * "corrected" into pale grey.
 */
const MIN_GAIN = 0.7;
const MAX_GAIN = 1.6;

/**
 * Even out the lighting WITHOUT touching the colour.
 *
 * The previous version divided only the L channel in Lab and left a and b
 * alone, which sounds conservative and is not: Lab's chroma is not perceptual
 * saturation, so lifting L while holding a and b fixed makes a colour PALER.
 * On white paper that is invisible, which is why it survived — every test
 * document was a white page. On a burgundy passport or a teal identity card it
 * is the whole appearance of the thing, and both came back washed out.
 *
 * Dividing all three channels by the SAME field cannot do that. It scales R, G
 * and B together, so their ratios — and with them the hue and the saturation —
 * come through untouched, and only the brightness changes. Which is all
 * "evening out the lighting" ever meant.
 */
function balanceColour(
	cv: CV,
	keep: Arena,
	warped: InstanceType<CV['Mat']>,
	out: InstanceType<CV['Mat']>,
	width: number
) {
	const rgb = keep(new cv.Mat());
	cv.cvtColor(warped, rgb, cv.COLOR_RGBA2RGB);

	// The field is measured on brightness, because that is what a lamp changes.
	const gray = keep(new cv.Mat());
	cv.cvtColor(rgb, gray, cv.COLOR_RGB2GRAY);
	const field = keep(illuminationField(cv, keep, gray, width));

	// Guard the divide: a black region gives a field near zero, and 0/0 is
	// where a correction turns into a blown-out square of noise.
	const floor = keep(new cv.Mat(field.rows, field.cols, field.type(), new cv.Scalar(1)));
	cv.max(field, floor, field);

	const field32 = keep(new cv.Mat());
	field.convertTo(field32, cv.CV_32F);
	const gain = keep(new cv.Mat());
	// gain = mean(field) / field — greater than one where the page was in
	// shadow, less where the lamp fell on it, one on average.
	const level = keep(
		new cv.Mat(field.rows, field.cols, cv.CV_32F, new cv.Scalar(cv.mean(field)[0]))
	);
	cv.divide(level, field32, gain);

	const low = keep(new cv.Mat(gain.rows, gain.cols, cv.CV_32F, new cv.Scalar(MIN_GAIN)));
	const high = keep(new cv.Mat(gain.rows, gain.cols, cv.CV_32F, new cv.Scalar(MAX_GAIN)));
	cv.max(gain, low, gain);
	cv.min(gain, high, gain);

	// The same gain on every channel. This is the line that keeps the colour.
	const gains = keep(new cv.MatVector());
	gains.push_back(gain);
	gains.push_back(gain);
	gains.push_back(gain);
	const gain3 = keep(new cv.Mat());
	cv.merge(gains, gain3);

	const rgb32 = keep(new cv.Mat());
	rgb.convertTo(rgb32, cv.CV_32F);
	cv.multiply(rgb32, gain3, rgb32);
	const balanced = keep(new cv.Mat());
	// convertTo saturates rather than wrapping, so a highlight pushed past 255
	// clips to white instead of turning black.
	rgb32.convertTo(balanced, cv.CV_8U);

	cv.cvtColor(balanced, out, cv.COLOR_RGB2RGBA);
}

/**
 * The lighting across a frame: the picture with everything but the illumination
 * blurred out of it.
 *
 * Measured at a quarter scale, because a blur wide enough to erase the content
 * is enormous at full size and the field it produces is smooth enough that the
 * detail thrown away by the resize cannot be seen in it.
 */
function illuminationField(cv: CV, keep: Arena, single: InstanceType<CV['Mat']>, width: number) {
	const small = keep(new cv.Mat());
	cv.resize(
		single,
		small,
		new cv.Size(
			Math.max(1, Math.round(single.cols * BACKGROUND_SCALE)),
			Math.max(1, Math.round(single.rows * BACKGROUND_SCALE))
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
	const field = keep(new cv.Mat());
	cv.resize(small, field, new cv.Size(single.cols, single.rows), 0, 0, cv.INTER_LINEAR);
	return keep.release(field);
}

/**
 * Divide out the illumination field. Kills a desk lamp's gradient or a hand
 * shadow in one pass, with no model. Returns a single-channel Mat whose
 * ownership passes to the caller.
 */
function flatten(cv: CV, keep: Arena, warped: InstanceType<CV['Mat']>, width: number) {
	const gray = keep(new cv.Mat());
	cv.cvtColor(warped, gray, cv.COLOR_RGBA2GRAY);

	const background = keep(illuminationField(cv, keep, gray, width));

	const divided = keep(new cv.Mat());
	// Scaled by 255 so the quotient lands back in 0–255 rather than around 1.
	cv.divide(gray, background, divided, 255, cv.CV_8U);
	// Rule 3: ownership transfers explicitly, and the caller keep()s it again.
	return keep.release(divided);
}

const odd = (n: number) => (n < 3 ? 3 : n % 2 === 0 ? n + 1 : n);
