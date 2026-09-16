// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Decoding a 12 MP photograph to pixels in-browser could exhaust an iPhone's
 * WASM heap. Instead of capping decoded width, the decode was removed entirely:
 * this asserts THE BROWSER NEVER MATERIALISES A PHOTOGRAPH'S PIXELS.
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
		// `getImageData`/`ImageData` are how a decoded frame becomes a JavaScript array.
		const offenders = files(CLIENT).filter((path) =>
			/\b(getImageData|putImageData|new ImageData)\b/.test(code(path))
		);
		expect(offenders).toEqual([]);
	});

	it('never decodes a photograph it was given', () => {
		// `createImageBitmap` is the other door to the same room.
		const offenders = files(CLIENT).filter((path) => /\bcreateImageBitmap\b/.test(code(path)));
		expect(offenders).toEqual([]);
	});

	it('draws to a canvas in exactly one place, to get the photograph OUT of the camera', () => {
		// Fallback shutter for browsers without ImageCapture; encodes straight to a Blob.
		const drawing = files(CLIENT).filter((path) => /\bdrawImage\b/.test(code(path)));
		expect(drawing).toEqual([join(CLIENT, 'frame.ts')]);
	});

	it('releases that canvas rather than trusting the collector', () => {
		// A canvas backing store is off-heap; a browser that won't give another silently
		// returns a transparent image instead of throwing.
		const source = code(join(CLIENT, 'frame.ts'));
		expect(source).toMatch(/canvas\.width = 0;\s*canvas\.height = 0;/);
	});
});
