// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { captureWidth } from '$lib/scan/client/frame';

/**
 * The cap that keeps a photograph inside the memory the pipeline was designed
 * for. It used to cap the WIDTH, which for a portrait photograph — the way
 * every document is photographed — never fired at all.
 *
 * The consequence was not a slow scan. The full-resolution frame was still
 * held when OpenCV asked iOS for a heap of its own, the allocation failed,
 * Emscripten aborted without ever calling `onRuntimeInitialized`, and the scan
 * screen waited on "Reading photo…" for the life of the tab.
 */
const megapixels = (w: number, h: number) => (w * h) / 1_000_000;
/** RGBA, which is how every frame in the pipeline is held. Decimal MB, the
 *  unit the figures in frame.ts are quoted in. */
const megabytes = (w: number, h: number) => (w * h * 4) / 1_000_000;

/** The height that comes with a capped width, at the source's aspect ratio. */
function capped(width: number, height: number) {
	const target = captureWidth(width, height);
	return { width: target, height: Math.max(1, Math.round((height * target) / width)) };
}

describe('the capture cap', () => {
	it('caps an iPhone 12 MP portrait, which a width cap let through whole', () => {
		// 3024 is inside a 3200 WIDTH cap, so the old rule did nothing at all
		// and handed 48.8 MB to a phone that could not spare it.
		expect(megabytes(3024, 4032)).toBeGreaterThan(48);
		const out = capped(3024, 4032);
		expect(Math.max(out.width, out.height)).toBe(3200);
		expect(megabytes(out.width, out.height)).toBeLessThan(31);
	});

	it('puts portrait and landscape on the same budget', () => {
		const portrait = capped(3024, 4032);
		const landscape = capped(4032, 3024);
		expect(megapixels(portrait.width, portrait.height)).toBeCloseTo(
			megapixels(landscape.width, landscape.height),
			1
		);
	});

	it('caps a 48 MP photograph in either orientation', () => {
		for (const [w, h] of [
			[8064, 6048],
			[6048, 8064]
		]) {
			const out = capped(w, h);
			expect(Math.max(out.width, out.height)).toBe(3200);
			// The ~30 MB the cap was written for, not the 54.6 MB a width cap
			// left on a portrait 48 MP frame.
			expect(megabytes(out.width, out.height)).toBeLessThan(31);
		}
	});

	it('never scales a small photograph up', () => {
		expect(captureWidth(800, 600)).toBe(800);
		expect(captureWidth(600, 800)).toBe(600);
		// Exactly on the cap is not past it.
		expect(captureWidth(2400, 3200)).toBe(2400);
	});

	it('keeps the aspect ratio it was given', () => {
		const out = capped(3024, 4032);
		expect(out.width / out.height).toBeCloseTo(3024 / 4032, 3);
	});
});

describe('the paths a photograph arrives by', () => {
	const source = readFileSync('src/lib/scan/client/frame.ts', 'utf8');

	it('cap every one of them, so none can leave 12 MP in memory', () => {
		// A width cap is the bug this file just fixed; it must not come back
		// under the old name.
		expect(source).not.toContain('MAX_CAPTURE_WIDTH');
		// Bitmap, HEIC and video, each capped on the long side.
		expect(source.match(/captureWidth\(/g)?.length).toBeGreaterThanOrEqual(4);
	});

	it('caps the HEIC fallback too, which used to return the frame whole', () => {
		const tail = source.slice(source.indexOf('export async function frameFromFile'));
		expect(tail).toMatch(/frameFromBitmapSource\(decoded, captureWidth\(/);
	});
});
