// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The still must be the same picture the user framed.
 *
 * This file used to guard an elaborate agreement check. `ImageCapture.takePhoto()`
 * returns the sensor's own frame with an EXIF rotation attached, a phone writes
 * a DIFFERENT rotation depending on how it was held, and `createImageBitmap`
 * does not reliably apply it — the default for `imageOrientation` changed across
 * versions of the specification and browsers disagree. So the decoded frame
 * could be turned relative to the preview, every corner found on it described a
 * region of a differently-shaped image, and the crop came from somewhere else
 * entirely. It showed up in landscape and not in portrait, which is exactly what
 * an orientation-dependent bug looks like.
 *
 * v0.8.6 did not fix that check. IT REMOVED WHAT THE CHECK WAS FOR. The browser
 * no longer decodes the still, does not measure it, and finds no corners on it:
 * the blob goes to the server, and detection runs on those exact bytes. There is
 * no second version of the picture left to disagree with the first.
 *
 * What remains worth guarding is the one thing the browser still does — get the
 * photograph out of the camera without holding it as pixels.
 */
const source = readFileSync('src/lib/scan/client/frame.ts', 'utf8');

describe('the captured still', () => {
	it('is handed over as bytes, never as a decoded frame', () => {
		// The blob from `takePhoto` is already an encoded JPEG with its EXIF
		// intact. Uploading it as it stands is what keeps a 12 MP decode — the
		// allocation that failed on iOS — out of the browser entirely.
		expect(source).toMatch(/Promise<File>/);
		expect(source).not.toContain('createImageBitmap');
		expect(source).not.toContain('getImageData');
	});

	it('prefers the sensor over the video track', () => {
		// A track is commonly 1080p behind a 12 MP camera, and that gap is the
		// whole margin between a legible scan of small print and a blurry one.
		expect(source).toContain('ImageCapture');
		expect(source).toMatch(/takePhoto\(\)/);
	});

	it('falls back to the video frame, which cannot disagree with what was framed', () => {
		// Some Android cameras advertise ImageCapture and then refuse takePhoto
		// while the track is live. The video element is literally what the user
		// was looking at: lower resolution, always right.
		expect(source).toMatch(/frameFromVideo\(video\)/);
	});

	it('names the file so the server knows how to decode it', () => {
		// The extension is what `isImageFile` admits and what the codec branches
		// on — a HEIC reaching mupdf instead of libheif is "unknown image file
		// format" rather than a scan.
		expect(source).toMatch(/new File\(\[blob\]/);
	});
});

describe('the one scratch canvas left', () => {
	it('is released as soon as its bytes are encoded', () => {
		// A backing store lives outside the JavaScript heap and is not counted
		// against it, so dropping the reference frees it eventually and no sooner.
		expect(source).toMatch(/canvas\.width = 0;\s*canvas\.height = 0;/);
	});

	it('is released only after toBlob has called back', () => {
		// toBlob's callback is asynchronous. Zeroing the canvas before it fires
		// hands back a fully TRANSPARENT image — which, over the preview's dark
		// card, is a page that looks solid black rather than an error.
		const callback = source.slice(source.indexOf('canvas.toBlob('));
		expect(callback.indexOf('canvas.width = 0')).toBeGreaterThan(callback.indexOf('(blob) =>'));
	});
});
