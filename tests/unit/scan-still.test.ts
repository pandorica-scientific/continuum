// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The still must be the same picture the user framed.
 *
 * `ImageCapture.takePhoto()` returns the sensor's own frame with an EXIF
 * rotation attached, and a phone writes a DIFFERENT rotation depending on how
 * it was being held. `createImageBitmap(blob)` does not reliably apply that
 * rotation — the default for `imageOrientation` has changed across versions of
 * the specification and browsers disagree — so the frame handed to the pipeline
 * could be turned relative to the preview.
 *
 * Every corner then found on it describes a region of a differently-shaped
 * image, and the crop comes from somewhere else entirely. It showed up in
 * landscape and not in portrait, which is exactly what an orientation-dependent
 * bug looks like.
 */
const source = readFileSync('src/lib/scan/client/frame.ts', 'utf8');

describe('the captured still', () => {
	it('asks for EXIF orientation explicitly', () => {
		expect(source).toContain("imageOrientation: 'from-image'");
	});

	it('checks the still agrees with what was framed', () => {
		// 4:3 against 3:4 is a 33% disagreement — far outside the tolerance, and
		// precisely the case this catches.
		expect(source).toMatch(/const framed = video\.videoWidth \/ video\.videoHeight;/);
		expect(source).toMatch(/Math\.abs\(captured - framed\) \/ framed <= ASPECT_AGREEMENT/);
	});

	it('falls back to the video frame when they disagree', () => {
		// The video element is what the user was looking at, so it cannot
		// disagree with what they framed. Lower resolution, always right.
		const tail = source.slice(source.indexOf('export async function stillFromTrack'));
		expect(tail).toMatch(/return frameFromVideo\(video, Math\.min\(video\.videoWidth/);
	});

	it('tolerates a sensor cropping its still slightly differently', () => {
		// The guard must not fire on the ordinary small difference between a
		// track and its stills, or every capture drops to the low-resolution path.
		const match = source.match(/const ASPECT_AGREEMENT = ([\d.]+);/);
		expect(match).toBeTruthy();
		const tolerance = Number(match![1]);
		expect(tolerance).toBeGreaterThan(0.05);
		expect(tolerance).toBeLessThan(0.33);
	});

	it('frees the bitmap rather than holding 48 MP of it', () => {
		expect(source).toContain('bitmap.close()');
	});
});

describe('scratch canvases', () => {
	const source = readFileSync('src/lib/scan/client/frame.ts', 'utf8');

	it('are released the moment their pixels are read', () => {
		// A backing store lives outside the JavaScript heap and is not counted
		// against it, so dropping the reference frees it eventually and no
		// sooner. Every page allocates several at capture size — 54 MB apiece
		// for a 3200x4267 frame — and a rotation allocates a fresh set on top.
		expect(source).toMatch(
			/function release\(canvas: HTMLCanvasElement\) \{\s*canvas\.width = 0;\s*canvas\.height = 0;/
		);
		expect(source.match(/release\(canvas\)/g)?.length).toBeGreaterThanOrEqual(3);
	});

	it('releases the encoder canvas only after the callback has run', () => {
		// toBlob's callback is asynchronous. Zeroing the canvas before it fires
		// hands back a fully TRANSPARENT image — which, over the preview's dark
		// card, is a page that looks solid black rather than an error.
		expect(source).toMatch(/\}\)\.finally\(\(\) => release\(canvas\)\);/);
	});
});
