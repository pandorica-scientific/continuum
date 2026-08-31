// SPDX-License-Identifier: AGPL-3.0-or-later
// iPhones shoot HEIC by default and the upload path runs the pipeline on
// dropped files, so this is a real share of input. Safari decodes it natively;
// Chrome and Firefox do not, and with no server there is no `sharp` to fall
// back to.
//
// libheif-js is an Emscripten build of libheif that ships its own .wasm, so it
// is self-hosted like everything else here. It is imported lazily and discarded
// after every file: it carries a SECOND WASM heap with the same "grows and
// never shrinks" behaviour as opencv.js, and keeping a module alive between
// files is a permanent floor nobody is watching.

import type { Frame } from '../core/index.ts';

function isPrimary(image: { is_primary?(): boolean }): boolean {
	try {
		return image.is_primary?.() === true;
	} catch {
		return false;
	}
}

export async function decodeHeic(bytes: Uint8Array): Promise<Frame> {
	const { default: libheif } = await import('libheif-js');
	const decoder = new libheif.HeifDecoder();
	const images = decoder.decode(bytes);
	if (!images?.length) throw new Error('That HEIC file held no image.');

	// The PRIMARY item, not images[0]: a burst or a Live Photo carries several
	// and the first is not reliably the one the user saw in their gallery.
	//
	// `is_primary` has to be called defensively. libheif-js defines it, so a
	// `typeof` check passes, but its body calls a bare global the bundle never
	// declares:
	//
	//   is_primary = function () { return !!heif_image_handle_is_primary_image(this.handle) }
	//
	// so invoking it throws ReferenceError — on every file, for every image.
	// Optional chaining does not help: the function exists, it just does not
	// work. Falling back to the first image is right anyway; the overwhelming
	// majority of HEICs hold exactly one.
	const primary = images.find((image) => isPrimary(image)) ?? images[0];

	const width = primary.get_width();
	const height = primary.get_height();
	const target = new ImageData(width, height);

	await new Promise<void>((resolve, reject) => {
		primary.display(target, (result) =>
			result ? resolve() : reject(new Error('That HEIC file could not be decoded.'))
		);
	});

	// libheif does not apply EXIF orientation either; the caller does that.
	return { data: target.data, width, height };
}
