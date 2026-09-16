// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The still must be the same picture the user framed. The browser never decodes
 * or measures it — the blob goes to the server as-is and detection runs on those
 * exact bytes, so there is no second, possibly misrotated version to disagree
 * with the first.
 */
const source = readFileSync('src/lib/scan/client/frame.ts', 'utf8');

describe('the captured still', () => {
	it('is handed over as bytes, never as a decoded frame', () => {
		// The blob is already an encoded JPEG; decoding it in-browser risked a 12 MP
		// allocation that failed on iOS.
		expect(source).toMatch(/Promise<File>/);
		expect(source).not.toContain('createImageBitmap');
		expect(source).not.toContain('getImageData');
	});

	it('prefers the sensor over the video track', () => {
		// A track is commonly 1080p behind a 12 MP camera — the difference between a
		// legible scan and a blurry one.
		expect(source).toContain('ImageCapture');
		expect(source).toMatch(/takePhoto\(\)/);
	});

	it('falls back to the video frame, which cannot disagree with what was framed', () => {
		// Some Android cameras advertise ImageCapture and then refuse takePhoto while live.
		expect(source).toMatch(/frameFromVideo\(video\)/);
	});

	it('names the file so the server knows how to decode it', () => {
		// The extension drives the codec branch — a HEIC reaching mupdf instead of
		// libheif fails as "unknown image file format".
		expect(source).toMatch(/new File\(\[blob\]/);
	});
});

describe('the one scratch canvas left', () => {
	it('is released as soon as its bytes are encoded', () => {
		// A canvas backing store lives outside the JS heap; only zeroing it frees it.
		expect(source).toMatch(/canvas\.width = 0;\s*canvas\.height = 0;/);
	});

	it('is released only after toBlob has called back', () => {
		// toBlob is asynchronous; zeroing the canvas before it fires hands back a
		// transparent image, which reads as solid black over the preview's dark card.
		const callback = source.slice(source.indexOf('canvas.toBlob('));
		expect(callback.indexOf('canvas.width = 0')).toBeGreaterThan(callback.indexOf('(blob) =>'));
	});
});
