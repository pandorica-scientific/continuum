// SPDX-License-Identifier: AGPL-3.0-or-later
// A binarized A4 page is 8.7 million pixels. At one byte each that is 8.7 MB
// before compression; at one BIT each it is 1.1 MB, and deflate takes a typical
// page to well under 150 KB.
//
// This is done by hand rather than through pdf-lib's `embedPng` because pdf-lib
// decodes a PNG and re-embeds it as RGB — which would discard the entire saving
// silently. The page would still look right, every test would still pass, and
// the only symptom would be files several times larger than promised.

import type { Frame } from './types.ts';

export function isBilevel(frame: Frame): boolean {
	for (let i = 0; i < frame.data.length; i += 4) {
		const v = frame.data[i];
		if (v !== 0 && v !== 255) return false;
	}
	return true;
}

export function packBilevel(frame: Frame): Uint8Array {
	// PDF image rows do not share bytes: each row starts on a byte boundary, and
	// packing them continuously shears the image by a pixel per row.
	const bytesPerRow = Math.ceil(frame.width / 8);
	const out = new Uint8Array(bytesPerRow * frame.height);
	for (let y = 0; y < frame.height; y++) {
		const rowStart = y * bytesPerRow;
		for (let x = 0; x < frame.width; x++) {
			if (frame.data[(y * frame.width + x) * 4] === 0) continue; // 0 = black = bit clear
			out[rowStart + (x >> 3)] |= 0x80 >> (x & 7); // MSB first, as PDF reads
		}
	}
	return out;
}

/**
 * zlib deflate, via the platform's own compressor.
 *
 * `CompressionStream` exists in every browser this app supports and in node, so
 * the tests exercise the same implementation that ships rather than a stand-in.
 */
export async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
	const stream = new Blob([bytes as BlobPart])
		.stream()
		.pipeThrough(new CompressionStream('deflate'));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}
