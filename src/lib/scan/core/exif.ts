// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Canvas `drawImage` ignores EXIF, so a portrait photo from certain Androids
// lands sideways unless the tag is read and applied by hand. HEIC carries the
// same tag and libheif does not apply it either, so both paths come through
// here.
//
// This is also the WHOLE of `original` mode's processing — the upload path's
// only recovery when detection fails — so it degrades to "no rotation" on
// anything it cannot parse rather than throwing.

import type { Frame } from './types.ts';

const APP1 = 0xffe1;
const ORIENTATION_TAG = 0x0112;

export function readOrientation(bytes: Uint8Array): number {
	try {
		if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1; // not a JPEG
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		let offset = 2;

		while (offset + 4 <= view.byteLength) {
			const marker = view.getUint16(offset);
			// Every segment marker begins 0xFF. Anything else means the walk has
			// lost its place, and continuing would read lengths out of pixel data.
			if ((marker & 0xff00) !== 0xff00) return 1;
			// Start of Scan: entropy-coded image data follows and is not divided
			// into markers, so there is nothing further to walk.
			if (marker === 0xffda || marker === 0xffd9) return 1;

			const length = view.getUint16(offset + 2);
			if (length < 2) return 1;

			if (marker === APP1 && isExifSegment(bytes, offset)) {
				const found = orientationInExif(view, offset + 10);
				if (found !== null) return found;
			}
			offset += 2 + length;
		}
		return 1;
	} catch {
		// A truncated or malformed file is not worth failing a scan over; the
		// photo is simply used as it came.
		return 1;
	}
}

/**
 * Is this APP1 the Exif one?
 *
 * An iPhone writes TWO APP1 segments — Exif and XMP — and XMP usually comes
 * second but not always. Skipping this check means parsing the XMP's opening
 * text as a TIFF header: it yields a plausible-looking number, and a photo that
 * needed no rotation gets turned ninety degrees. Which is exactly what it did.
 */
function isExifSegment(bytes: Uint8Array, offset: number): boolean {
	const signature = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
	return signature.every((byte, i) => bytes[offset + 4 + i] === byte);
}

/** Read tag 0x0112 out of IFD0. Null when the block holds no such tag. */
function orientationInExif(view: DataView, tiff: number): number | null {
	if (tiff + 8 > view.byteLength) return null;
	const endian = view.getUint16(tiff);
	if (endian !== 0x4949 && endian !== 0x4d4d) return null; // not a TIFF header
	const little = endian === 0x4949;
	if (view.getUint16(tiff + 2, little) !== 0x002a) return null; // wrong magic

	const ifd = tiff + view.getUint32(tiff + 4, little);
	if (ifd + 2 > view.byteLength) return null;

	const count = view.getUint16(ifd, little);
	for (let i = 0; i < count; i++) {
		const entry = ifd + 2 + i * 12;
		if (entry + 12 > view.byteLength) return null;
		if (view.getUint16(entry, little) !== ORIENTATION_TAG) continue;
		const value = view.getUint16(entry + 8, little);
		return value >= 1 && value <= 8 ? value : 1;
	}
	return null;
}

/** The eight EXIF orientations, as a source pixel mapped to its output position. */
export function applyOrientation(frame: Frame, orientation: number): Frame {
	if (orientation === 1 || orientation < 1 || orientation > 8) return frame;

	// 5-8 involve a quarter turn, which swaps the page's width and height.
	const quarter = orientation >= 5;
	const width = quarter ? frame.height : frame.width;
	const height = quarter ? frame.width : frame.height;
	const out = new Uint8ClampedArray(width * height * 4);

	for (let y = 0; y < frame.height; y++) {
		for (let x = 0; x < frame.width; x++) {
			let nx: number;
			let ny: number;
			switch (orientation) {
				case 2:
					nx = frame.width - 1 - x;
					ny = y;
					break; // mirrored
				case 3:
					nx = frame.width - 1 - x;
					ny = frame.height - 1 - y;
					break; // 180°
				case 4:
					nx = x;
					ny = frame.height - 1 - y;
					break; // flipped
				case 5:
					nx = y;
					ny = x;
					break; // transposed
				case 6:
					nx = frame.height - 1 - y;
					ny = x;
					break; // 90° clockwise
				case 7:
					nx = frame.height - 1 - y;
					ny = frame.width - 1 - x;
					break; // transverse
				default:
					nx = y;
					ny = frame.width - 1 - x; // 8: 90° anticlockwise
			}
			const from = (y * frame.width + x) * 4;
			const to = (ny * width + nx) * 4;
			out[to] = frame.data[from];
			out[to + 1] = frame.data[from + 1];
			out[to + 2] = frame.data[from + 2];
			out[to + 3] = frame.data[from + 3];
		}
	}

	return { data: out, width, height };
}

/**
 * The dimensions stored in the JPEG itself, before any rotation is applied.
 *
 * This exists to settle an argument no amount of reading the specification
 * could: whether the thing that decoded the image already turned it. Chrome
 * applies EXIF orientation to `createImageBitmap` whatever `imageOrientation`
 * asks for — measured, `'none'`, `'from-image'` and the default all return the
 * same rotated bitmap — while other decoders may not. Applying the rotation a
 * second time turns an upright page onto its side, which is a bug that looks
 * exactly like not applying it at all.
 *
 * Comparing what came out against what was stored answers it directly: if the
 * decoded image is the transpose of the stored one, the decoder has already
 * done the work.
 *
 * Null when the size cannot be read, which is the caller's cue not to guess.
 */
export function readStoredSize(bytes: Uint8Array): { width: number; height: number } | null {
	try {
		if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		let offset = 2;

		while (offset + 4 <= view.byteLength) {
			const marker = view.getUint16(offset);
			if ((marker & 0xff00) !== 0xff00) return null;
			if (marker === 0xffda || marker === 0xffd9) return null;

			// Any Start Of Frame carries the dimensions. C4, C8 and CC are not
			// frames — they are Huffman tables, extensions and arithmetic coding.
			const isFrame =
				marker >= 0xffc0 &&
				marker <= 0xffcf &&
				marker !== 0xffc4 &&
				marker !== 0xffc8 &&
				marker !== 0xffcc;
			if (isFrame) {
				return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
			}

			const length = view.getUint16(offset + 2);
			if (length < 2) return null;
			offset += 2 + length;
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * Does this orientation swap the image's width and height?
 *
 * Orientations 5 to 8 all involve a quarter turn; 1 to 4 do not.
 */
export function turnsAQuarter(orientation: number): boolean {
	return orientation >= 5 && orientation <= 8;
}

/**
 * Should the EXIF rotation be applied, given what the decoder produced?
 *
 * Pure, and separated out because this decision has been got wrong three times
 * in three different ways: parsing the wrong APP1 segment, trusting
 * `imageOrientation: 'none'` that Chrome ignores, and comparing exact
 * dimensions after the frame had already been scaled down. Each mistake looks
 * identical from the outside — a page on its side — so reasoning about it
 * carefully is not enough. It needs a table of cases.
 *
 * `decoded` is what came out of the decoder, at whatever size; `stored` is what
 * the file holds, before any rotation. Only the ORIENTATION of each is
 * compared, never the sizes, because the frame is routinely resized first.
 */
export function needsRotation(
	orientation: number,
	decoded: { width: number; height: number },
	stored: { width: number; height: number } | null
): boolean {
	if (orientation === 1 || orientation < 1 || orientation > 8) return false;
	// Mirrors and 180° turns do not change the shape, so nothing can be inferred
	// from it — apply and accept that a decoder which already did so is rare.
	if (!turnsAQuarter(orientation)) return true;
	// Without the stored size there is nothing to compare against. Leave the
	// image alone: the wrong way round is recoverable by hand, corrupted is not.
	if (!stored) return false;
	// A quarter turn swaps portrait for landscape. If they already disagree, the
	// decoder has done it.
	return decoded.height > decoded.width === stored.height > stored.width;
}
