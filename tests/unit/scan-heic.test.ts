// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Verified against a real 48 MP iPhone HEIC, not against the library's
 * documentation. Three of four assumptions held; the fourth did not, and it
 * would have thrown on every file a user ever dropped.
 */
const source = readFileSync('src/lib/scan/client/heic-decode.ts', 'utf8');

describe('heic-decode', () => {
	it('imports libheif lazily, so 1.5 MB of WASM never loads for a JPEG', () => {
		// A static import pulls the decoder into the main chunk and every visitor
		// pays for it whether or not an iPhone photo ever arrives.
		expect(source).toMatch(/await import\(['"]libheif-js['"]\)/);
		expect(source).not.toMatch(/^import .*libheif-js/m);
	});

	it('does not hold the decoder between files', () => {
		// libheif is Emscripten too, with its own heap and the same discipline as
		// opencv: instantiate, decode, discard. A module-level instance is a
		// second permanent heap nobody is watching.
		expect(source).not.toMatch(/^let\s+\w*[Dd]ecoder/m);
	});

	it('calls is_primary defensively, because it throws', () => {
		// libheif-js DEFINES is_primary, so a `typeof` check passes — but its
		// body calls a bare global the bundle never declares:
		//
		//   is_primary = function () { return !!heif_image_handle_is_primary_image(this.handle) }
		//
		// Invoking it raises ReferenceError, on every file, for every image.
		// Optional chaining does not save you: the function exists, it simply
		// does not work. Confirmed against a real iPhone HEIC, where it threw
		// every time and took the whole decode with it.
		expect(source).toContain('image.is_primary?.() === true');
		expect(source).toMatch(/catch \{\s*return false;/);
	});

	it('still prefers the primary item when it can be identified', () => {
		// A burst or a Live Photo carries several images and the first is not
		// reliably the one the user saw in their gallery. Falling back to
		// images[0] is correct, not a shrug: nearly every HEIC holds exactly one.
		expect(source).toMatch(/images\.find\(\(image\) => isPrimary\(image\)\) \?\? images\[0\]/);
	});

	it('leaves EXIF rotation to the caller', () => {
		// libheif does not apply it, and neither does canvas drawImage — so the
		// one place it happens is applyOrientation on the way out of frameFromFile.
		expect(source).toMatch(/does not apply EXIF orientation/i);
	});
});
