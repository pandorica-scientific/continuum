// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
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

export async function decodeHeic(bytes: Uint8Array): Promise<Frame> {
	const { default: libheif } = await import('libheif-js');
	const decoder = new libheif.HeifDecoder();
	const images = decoder.decode(bytes);
	if (!images?.length) throw new Error('That HEIC file held no image.');

	// The PRIMARY item, not images[0]: a burst or a Live Photo carries several
	// and the first is not reliably the one the user saw in their gallery.
	const primary = images.find((image) => image.is_primary?.()) ?? images[0];

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
