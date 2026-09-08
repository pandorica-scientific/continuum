// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * This file used to hold the capture cap.
 *
 * The cap existed because the browser decoded every photograph and held it as
 * pixels: an iPhone's ordinary 12 MP frame is 48.8 MB of RGBA, and with one of
 * those resident OpenCV asked iOS for a heap of its own, the allocation failed,
 * Emscripten aborted without ever calling `onRuntimeInitialized`, and the scan
 * screen waited on "Reading photo…" for the life of the tab. An earlier version
 * capped the WIDTH, which for a portrait photograph — the way every document is
 * photographed — never fired at all.
 *
 * v0.8.6 removed the decode instead of tuning the cap. The photograph goes to
 * the server as bytes and comes back as a preview, so there is no frame in the
 * browser to be too large. `captureWidth`, `frameFromFile` and
 * `frameFromBitmapSource` are all gone with it.
 *
 * What is tested here now is the property that made the cap unnecessary, which
 * is strictly stronger than the property the cap enforced: THE BROWSER NEVER
 * MATERIALISES A PHOTOGRAPH'S PIXELS. If that stops being true, the whole class
 * of failure above is available again, and a cap will not be there to soften it.
 */
const CLIENT = join('src', 'lib', 'scan', 'client');

function code(path: string): string {
	return readFileSync(path, 'utf8')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/^[ \t]*\/\/.*$/gm, '');
}

function files(dir: string): string[] {
	return readdirSync(dir).flatMap((entry) => {
		const path = join(dir, entry);
		return statSync(path).isDirectory() ? files(path) : [path];
	});
}

describe('the browser half of the scanner', () => {
	it('never reads pixels out of anything', () => {
		// `getImageData` and `ImageData` are how a decoded frame becomes a
		// JavaScript array, and that array is the 48.8 MB the failure needed.
		const offenders = files(CLIENT).filter((path) =>
			/\b(getImageData|putImageData|new ImageData)\b/.test(code(path))
		);
		expect(offenders).toEqual([]);
	});

	it('never decodes a photograph it was given', () => {
		// `createImageBitmap` is the other door to the same room, and it is the
		// one the upload path used to go through.
		const offenders = files(CLIENT).filter((path) => /\bcreateImageBitmap\b/.test(code(path)));
		expect(offenders).toEqual([]);
	});

	it('draws to a canvas in exactly one place, to get the photograph OUT of the camera', () => {
		// The viewfinder's fallback shutter, for browsers without ImageCapture.
		// There is no other way to reach a live track's pixels, so this one is
		// allowed — and it encodes straight to a Blob rather than keeping them.
		const drawing = files(CLIENT).filter((path) => /\bdrawImage\b/.test(code(path)));
		expect(drawing).toEqual([join(CLIENT, 'frame.ts')]);
	});

	it('releases that canvas rather than trusting the collector', () => {
		// A canvas's backing store is not on the JavaScript heap, so dropping the
		// reference frees it eventually and no sooner. A browser that will not
		// give out another does not throw: `toBlob` hands back a fully
		// TRANSPARENT image, which over the preview's dark card reads as a solid
		// black page.
		const source = code(join(CLIENT, 'frame.ts'));
		expect(source).toMatch(/canvas\.width = 0;\s*canvas\.height = 0;/);
	});
});
