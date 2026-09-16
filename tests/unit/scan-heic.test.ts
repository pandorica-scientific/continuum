// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/** Verified against a real iPhone HEIC, not against the library's documentation. */
const source = readFileSync('src/lib/server/scan/worker/codec.ts', 'utf8');

describe('the HEIC path in the scan codec', () => {
	it('imports libheif lazily, so 1.5 MB of WASM never loads for a JPEG', () => {
		// A static import pulls the decoder into the main chunk and every visitor
		// pays for it whether or not an iPhone photo ever arrives.
		expect(source).toMatch(/await import\(['"]libheif-js['"]\)/);
		expect(source).not.toMatch(/^import .*libheif-js/m);
	});

	it('does not hold the decoder between files', () => {
		// libheif is Emscripten too: instantiate, decode, discard, like opencv.
		// A module-level instance would be an unwatched second permanent heap.
		expect(source).not.toMatch(/^let\s+\w*[Dd]ecoder/m);
	});

	it('calls is_primary defensively, because it throws', () => {
		// libheif-js defines is_primary, so a `typeof` check passes, but its body
		// calls a bare global the bundle never declares — it throws every time,
		// on every image. Optional chaining alone does not save you from that.
		expect(source).toContain('image.is_primary?.() === true');
		expect(source).toMatch(/catch \{\s*return false;/);
	});

	it('still prefers the primary item when it can be identified', () => {
		// A burst or Live Photo carries several images; the first is not reliably
		// the one the user saw in their gallery.
		expect(source).toMatch(/images\.find\(\(image\) => isPrimary\(image\)\) \?\? images\[0\]/);
	});

	it('leaves EXIF rotation to the caller', () => {
		// libheif does not apply it, and neither does canvas drawImage — so the
		// one place it happens is applyOrientation on the way out of frameFromFile.
		expect(source).toMatch(/does not apply EXIF orientation/i);
	});
});
