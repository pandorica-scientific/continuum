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
			const length = view.getUint16(offset + 2);
			if (marker !== APP1) {
				if (length <= 0) return 1; // malformed; walking further would loop
				offset += 2 + length;
				continue;
			}

			// "Exif\0\0" then a TIFF header, whose first two bytes give the
			// endianness the rest of the block is written in.
			const tiff = offset + 10;
			if (tiff + 8 > view.byteLength) return 1;
			const little = view.getUint16(tiff) === 0x4949;
			const ifd = tiff + view.getUint32(tiff + 4, little);
			if (ifd + 2 > view.byteLength) return 1;

			const count = view.getUint16(ifd, little);
			for (let i = 0; i < count; i++) {
				const entry = ifd + 2 + i * 12;
				if (entry + 12 > view.byteLength) return 1;
				if (view.getUint16(entry, little) !== ORIENTATION_TAG) continue;
				const value = view.getUint16(entry + 8, little);
				return value >= 1 && value <= 8 ? value : 1;
			}
			return 1;
		}
		return 1;
	} catch {
		// A truncated or malformed file is not worth failing a scan over; the
		// photo is simply used as it came.
		return 1;
	}
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
