// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Pixels in and out, through mupdf.
 *
 * OpenCV does the geometry and cannot do this: the `@techstark/opencv-js` build
 * is the BROWSER build, whose `imread` takes a canvas and which ships no
 * `imencode` or `imdecode` at all. mupdf is already a runtime dependency for
 * rasterising PDF pages during extraction, so the codec costs no new package
 * and no native build — which is the whole reason the scanner can move to the
 * server without an arch-specific image.
 *
 * Two translations live here and nowhere else, because both are silent when
 * they are wrong: mupdf returns 3-component RGB with its own stride where a
 * `Frame` is packed RGBA, and `Pixmap.warp` wants a flat eight-number quad in
 * an order that is NOT the order `Corners` reads in.
 */
import { looksLikeHeic } from '$lib/scan/core/heic';
import type { Corners, Frame } from '$lib/scan/core/types';

type Mupdf = typeof import('mupdf');
type MupdfPixmap = import('mupdf').Pixmap;

let cached: Mupdf | null = null;

async function load(): Promise<Mupdf> {
	// A dynamic import is correct for mupdf, which is ESM-clean — unlike OpenCV,
	// whose ESM import HANGS under node with no error and which the child has to
	// reach through `require`. The two are not interchangeable and the asymmetry
	// is deliberate.
	cached ??= await import('mupdf');
	return cached;
}

/**
 * Decode a photograph into a packed RGBA frame.
 *
 * mupdf does not read HEIC — it answers "unknown image file format" — and an
 * iPhone shoots HEIC by DEFAULT, so this is not an edge case, it is the most
 * common single input the scanner receives. libheif handles those and mupdf
 * handles everything else.
 */
export async function decodeToFrame(bytes: Uint8Array): Promise<Frame> {
	if (looksLikeHeic(bytes)) return decodeHeic(bytes);
	const mupdf = await load();
	const pixmap = new mupdf.Image(bytes).toPixmap();
	try {
		return pixmapToFrame(pixmap);
	} finally {
		// A pixmap holds bytes outside the JS heap until this is called. The
		// extraction path learned the same lesson; see `ocr/index.ts`.
		pixmap.destroy();
	}
}

/**
 * A HEIC, through libheif.
 *
 * Created and DISCARDED per file, exactly as the browser decoder it replaces
 * did: libheif-js is an Emscripten build carrying its own WASM heap, with the
 * same "grows and never shrinks" behaviour as opencv.js. Keeping it alive
 * between files would be a second permanent floor inside a process that exists
 * to make the first one temporary.
 *
 * `display` writes into anything ImageData-SHAPED, which matters because node
 * has no `ImageData` to construct — a plain object with the right three fields
 * is what it actually needs, and is what a `Frame` already is.
 */
function isPrimary(image: { is_primary?(): boolean }): boolean {
	try {
		return image.is_primary?.() === true;
	} catch {
		return false;
	}
}

async function decodeHeic(bytes: Uint8Array): Promise<Frame> {
	const { default: libheif } = await import('libheif-js');
	const images = new libheif.HeifDecoder().decode(bytes);
	if (!images?.length) throw new Error('That HEIC file held no image.');

	// The PRIMARY item, not images[0]: a burst or a Live Photo carries several
	// and the first is not reliably the one the user saw in their gallery.
	//
	// `is_primary` has to be called defensively. libheif-js defines it, so a
	// `typeof` check passes, but its body calls a bare global the bundle never
	// declares, so invoking it throws ReferenceError — on every file, for every
	// image. Falling back to the first is right anyway; the overwhelming
	// majority of HEICs hold exactly one.
	const primary = images.find((image) => isPrimary(image)) ?? images[0];

	const width = primary.get_width();
	const height = primary.get_height();
	const target: Frame = { data: new Uint8ClampedArray(width * height * 4), width, height };

	await new Promise<void>((resolve, reject) => {
		primary.display(target as unknown as ImageData, (result) =>
			result ? resolve() : reject(new Error('That HEIC file could not be decoded.'))
		);
	});

	// libheif does not apply EXIF orientation; the caller does that.
	return target;
}

/**
 * A pixmap's bytes, repacked as RGBA with no padding.
 *
 * `getStride()` is the row length in BYTES and is not always
 * `width * components` — mupdf pads. Walking the buffer linearly instead of row
 * by row shears the image on any width where it does, which is why the tests
 * use a width of 37.
 */
function pixmapToFrame(pixmap: MupdfPixmap): Frame {
	const width = pixmap.getWidth();
	const height = pixmap.getHeight();
	const components = pixmap.getNumberOfComponents();
	const stride = pixmap.getStride();
	const source = pixmap.getPixels();
	const data = new Uint8ClampedArray(width * height * 4);

	for (let y = 0; y < height; y++) {
		let from = y * stride;
		let to = y * width * 4;
		for (let x = 0; x < width; x++) {
			if (components === 1) {
				// A greyscale pixmap, which is what a bilevel PNG decodes to.
				const grey = source[from];
				data[to] = grey;
				data[to + 1] = grey;
				data[to + 2] = grey;
				data[to + 3] = 255;
			} else {
				data[to] = source[from];
				data[to + 1] = source[from + 1];
				data[to + 2] = source[from + 2];
				// A pixmap without alpha has none to read, and a page is opaque.
				data[to + 3] = components >= 4 ? source[from + 3] : 255;
			}
			from += components;
			to += 4;
		}
	}

	return { data, width, height };
}

/** A packed RGBA frame as encoded bytes. PNG is lossless; JPEG takes a quality. */
export async function encodeFrame(
	frame: Frame,
	format: 'jpeg' | 'png',
	quality = 85
): Promise<Uint8Array<ArrayBuffer>> {
	const mupdf = await load();
	// No alpha, in BOTH formats. `asJPEG` refuses a pixmap that has it —
	// "pixmap may not have alpha to save as JPEG" — and a scanned page is
	// opaque, so carrying a channel of solid 255 would only make the PNG
	// larger for nothing. The frame's own alpha is dropped here rather than
	// being an argument, because there is no case in this pipeline where a
	// page is meant to be see-through.
	const pixmap = new mupdf.Pixmap(
		mupdf.ColorSpace.DeviceRGB,
		[0, 0, frame.width, frame.height],
		false
	);
	try {
		const target = pixmap.getPixels();
		const stride = pixmap.getStride();
		for (let y = 0; y < frame.height; y++) {
			let from = y * frame.width * 4;
			let to = y * stride;
			for (let x = 0; x < frame.width; x++) {
				target[to] = frame.data[from];
				target[to + 1] = frame.data[from + 1];
				target[to + 2] = frame.data[from + 2];
				from += 4;
				to += 3;
			}
		}
		// Copied into a plain ArrayBuffer. mupdf hands back `ArrayBufferLike`,
		// which a `Response` body and pdf-lib both refuse — and the copy is of an
		// already-encoded page, a few hundred kilobytes, not of the pixels.
		return new Uint8Array(format === 'png' ? pixmap.asPNG() : pixmap.asJPEG(quality));
	} finally {
		pixmap.destroy();
	}
}

/**
 * A smaller copy, by nearest neighbour.
 *
 * Deliberately not a filtered downscale. This produces the PREVIEW someone
 * glances at once; the expensive filtering has already happened inside
 * `renderPage`, and a box filter over a 12 MP frame in JavaScript costs more
 * than the render it is previewing.
 *
 * Never upscales: a frame already under the target comes back as it is, so a
 * small upload does not get blurrier on its way to the phone.
 */
export function downscaleFrame(frame: Frame, targetWidth: number): Frame {
	if (frame.width <= targetWidth) return frame;
	const width = targetWidth;
	const height = Math.max(1, Math.round((frame.height * targetWidth) / frame.width));
	const data = new Uint8ClampedArray(width * height * 4);

	for (let y = 0; y < height; y++) {
		const sourceRow = Math.min(frame.height - 1, Math.floor((y * frame.height) / height));
		for (let x = 0; x < width; x++) {
			const sourceColumn = Math.min(frame.width - 1, Math.floor((x * frame.width) / width));
			const from = (sourceRow * frame.width + sourceColumn) * 4;
			const to = (y * width + x) * 4;
			data[to] = frame.data[from];
			data[to + 1] = frame.data[from + 1];
			data[to + 2] = frame.data[from + 2];
			data[to + 3] = frame.data[from + 3];
		}
	}

	return { data, width, height };
}

/**
 * `Corners` in mupdf's quad order.
 *
 * mupdf reads a quad as upper-left, upper-right, LOWER-LEFT, lower-right.
 * `Corners` reads clockwise: tl, tr, br, bl. Handing one straight to the other
 * swaps the bottom two points and folds the page into a bow tie — which does
 * not throw, it just produces a wrong picture.
 */
export function quadFromCorners(corners: Corners): number[] {
	return [
		corners.tl.x,
		corners.tl.y,
		corners.tr.x,
		corners.tr.y,
		corners.bl.x,
		corners.bl.y,
		corners.br.x,
		corners.br.y
	];
}
