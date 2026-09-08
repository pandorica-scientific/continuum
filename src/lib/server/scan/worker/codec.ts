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
 * The translation that lives here and nowhere else is the one that is silent
 * when it is wrong: mupdf returns 3-component RGB with its own stride where a
 * `Frame` is packed RGBA, so walking the buffer linearly shears the picture on
 * any width mupdf pads.
 */
import { looksLikeHeic } from '$lib/scan/core/heic';
import type { Frame } from '$lib/scan/core/types';

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
 * Decode a photograph into a packed RGBA frame, no larger than `maxLong` on its
 * long edge.
 *
 * mupdf does not read HEIC — it answers "unknown image file format" — and an
 * iPhone shoots HEIC by DEFAULT, so this is not an edge case, it is the most
 * common single input the scanner receives. libheif handles those and mupdf
 * handles everything else.
 *
 * THE SIZE IS ASKED FOR BEFORE THE DECODE, NOT AFTER IT. A photograph's file
 * size says nothing about its decoded size — the 48 MP frame this was measured
 * on is a 0.8 MB JPEG — and decoding one whole and shrinking it afterwards paid
 * for every pixel twice: once in mupdf's pixmap and again in the packed copy
 * taken out of it. Handing mupdf a destination of the size actually wanted lets
 * it choose its own decode resolution, which for a JPEG means libjpeg
 * subsampling as it goes. Measured on that 48 MP frame: 784 MB peak whole,
 * 411 MB asked for at the cap, 284 MB asked for at a thumbnail.
 *
 * `maxLong` defaults to no limit, for the caller that is reading back a page
 * this pipeline WROTE and wants it exactly.
 */
export async function decodeToFrame(bytes: Uint8Array, maxLong = Infinity): Promise<Frame> {
	// libheif has no scaled decode to ask for: it writes into a buffer of the
	// image's own size, so the cap can only be applied afterwards. An iPhone's
	// 12 MP is 48 MB, which is why this is tolerable and the JPEG path was not.
	if (looksLikeHeic(bytes)) return limitFrame(await decodeHeic(bytes), maxLong);

	const mupdf = await load();
	const image = new mupdf.Image(bytes);
	try {
		const width = image.getWidth();
		const height = image.getHeight();
		const scale = Math.min(1, maxLong / Math.max(width, height));
		// EXACTLY as stored when it already fits. mupdf's resampling filter is
		// not the identity, so drawing a 1:1 copy through it would put grey
		// pixels along the strokes of the black-and-white artefact that gets read
		// back on the way into the PDF — and `assemblePdf` checks for bilevel
		// before packing one, so the page would quietly become a JPEG.
		const pixmap = scale === 1 ? image.toPixmap() : drawn(mupdf, image, width, height, scale);
		try {
			return pixmapToFrame(pixmap);
		} finally {
			// A pixmap holds bytes outside the JS heap until this is called. The
			// extraction path learned the same lesson; see `ocr/index.ts`.
			pixmap.destroy();
		}
	} finally {
		image.destroy();
	}
}

/**
 * The image drawn into a pixmap of the size wanted, rather than its own.
 *
 * An image occupies the UNIT SQUARE, so the transform that lands it on this
 * pixmap is simply the pixmap's size.
 *
 * NO Y-FLIP, however much the examples suggest one. `scale(w, -h)` then
 * `translate(0, h)` is the idiom throughout mupdf's own sample code, and it is
 * correct THERE because those callers work in PDF user space, where y increases
 * upward and the image's first row therefore has to be sent to the top of the
 * square. A `DrawDevice` over a bare pixmap is not in that space: it is raster
 * device space, y downward, which is already the order the rows are stored in.
 * The flip is a second inversion, and the photograph comes back upside down —
 * measured both ways, not reasoned about.
 */
function drawn(
	mupdf: Mupdf,
	image: import('mupdf').Image,
	width: number,
	height: number,
	scale: number
): MupdfPixmap {
	const target = Math.max(1, Math.round(width * scale));
	const rows = Math.max(1, Math.round(height * scale));
	const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, target, rows], false);
	// A photograph is opaque, but the pixmap arrives uninitialised: anything the
	// draw does not cover would otherwise be whatever the heap last held.
	pixmap.clear(255);

	const device = new mupdf.DrawDevice(mupdf.Matrix.identity, pixmap);
	try {
		device.fillImage(image, mupdf.Matrix.scale(target, rows), 1);
		device.close();
	} finally {
		device.destroy();
	}
	return pixmap;
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
 * A frame no larger than `maxLong` along its LONG edge.
 *
 * `downscaleFrame` measures width, which is the wrong axis half the time: a
 * portrait photograph is over the limit on its height and comes back untouched,
 * and a document is photographed portrait. That is the same mistake the
 * browser's old capture cap made before it was deleted, so it is not made again
 * here.
 *
 * This does not remove the decode's own peak — the decoder produces whatever
 * the file holds — but it is everything after it: the copy into the WASM heap,
 * the warp, the flat-field blur and the maps are all sized from this frame.
 */
export function limitFrame(frame: Frame, maxLong: number): Frame {
	const long = Math.max(frame.width, frame.height);
	if (long <= maxLong) return frame;
	return downscaleFrame(frame, Math.max(1, Math.round((frame.width * maxLong) / long)));
}
