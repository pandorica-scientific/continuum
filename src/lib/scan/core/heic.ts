// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// iPhones shoot HEIC by default and the upload path runs the pipeline on
// dropped files, so this is a real share of input.
//
// Sniff, do not trust the MIME type: Safari and several Android file pickers
// hand over HEIC with an empty or wrong `File.type`, so a check on `file.type`
// alone silently sends the file to a decoder that cannot read it.

const BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'];

export function looksLikeHeic(bytes: Uint8Array, filename?: string): boolean {
	// A `ftyp` box at offset 4, then the brand.
	if (bytes.length >= 12) {
		let box = '';
		for (let i = 4; i < 12; i++) box += String.fromCharCode(bytes[i]);
		if (box.startsWith('ftyp') && BRANDS.includes(box.slice(4, 8))) return true;
	}
	// Some pickers hand over no usable bytes at all, and the name is all there is.
	return /\.hei[cf]$/i.test(filename ?? '');
}
