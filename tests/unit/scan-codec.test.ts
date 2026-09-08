// SPDX-License-Identifier: AGPL-3.0-or-later
// Pixels in and out of the scan child, through mupdf.
//
// The translations under test here are SILENT when wrong: mupdf hands back
// 3-component RGB with its own stride where a Frame is packed RGBA, and the
// size cap measures the long edge where the downscale measures the width.
// Neither mistake throws; each produces a picture, or a heap, that is merely
// wrong.
import { describe, expect, it } from 'vitest';
import {
	decodeToFrame,
	downscaleFrame,
	encodeFrame,
	limitFrame
} from '$lib/server/scan/worker/codec';
import type { Frame } from '$lib/scan/core/types';

/** A frame with a known, asymmetric pattern, so an orientation error is visible. */
function swatch(width: number, height: number): Frame {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4;
			// Red rises left to right, green top to bottom, blue constant. A shear
			// or a flip moves one of the two gradients and not the other.
			data[i] = Math.round((x / Math.max(1, width - 1)) * 255);
			data[i + 1] = Math.round((y / Math.max(1, height - 1)) * 255);
			data[i + 2] = 40;
			data[i + 3] = 255;
		}
	}
	return { data, width, height };
}

describe('the scan codec', () => {
	it('round-trips a frame through PNG without touching the pixels', async () => {
		const original = swatch(64, 48);
		const back = await decodeToFrame(await encodeFrame(original, 'png'));

		expect(back.width).toBe(64);
		expect(back.height).toBe(48);
		// PNG is lossless, so every channel survives exactly. This is what catches
		// a stride or component-count mistake: an off-by-one in either shears the
		// gradient rather than changing it slightly.
		for (let i = 0; i < original.data.length; i += 4) {
			expect(back.data[i]).toBe(original.data[i]);
			expect(back.data[i + 1]).toBe(original.data[i + 1]);
			expect(back.data[i + 2]).toBe(original.data[i + 2]);
		}
	});

	it('always returns four packed channels, whatever mupdf hands back', async () => {
		// An ordinary photograph decodes as 3-component RGB. A Frame is
		// ImageData-shaped — RGBA, packed, no padding — because that is what lets
		// it go straight into the ImageData constructor without a defensive copy,
		// and a copy of a full page is 35 MB.
		const back = await decodeToFrame(await encodeFrame(swatch(37, 19), 'jpeg', 90));
		expect(back.data.length).toBe(back.width * back.height * 4);
		for (let i = 3; i < back.data.length; i += 4) expect(back.data[i]).toBe(255);
	});

	it('survives a width that is not a multiple of four', async () => {
		// The stride bug only shows on a width where mupdf pads the row. 37 * 3
		// is 111, which is where a linear walk of the buffer starts to drift.
		const original = swatch(37, 5);
		const back = await decodeToFrame(await encodeFrame(original, 'png'));
		expect(back.width).toBe(37);

		const green = (frame: Frame, x: number, y: number) => frame.data[(y * frame.width + x) * 4 + 1];
		// Column 0 of the last row must still be the START of a row. Under a
		// stride mistake it holds a pixel from somewhere along the row above.
		expect(green(back, 0, 4)).toBe(green(original, 0, 4));
		expect(green(back, 36, 4)).toBe(green(original, 36, 4));
	});

	it('downscales to the requested width and keeps the aspect ratio', () => {
		const small = downscaleFrame(swatch(1000, 500), 200);
		expect(small.width).toBe(200);
		expect(small.height).toBe(100);
		expect(small.data.length).toBe(200 * 100 * 4);
	});

	it('does not upscale a frame already smaller than the target', () => {
		// A small upload must not get blurrier on its way to the phone.
		const same = downscaleFrame(swatch(120, 90), 400);
		expect(same.width).toBe(120);
		expect(same.height).toBe(90);
	});

	it('keeps the corners where they belong when it downscales', () => {
		// Nearest neighbour, so the extremes of both gradients survive: a
		// downscale that shifted the sampling would darken the far edge.
		const small = downscaleFrame(swatch(800, 400), 100);
		expect(small.data[0]).toBe(0);
		expect(small.data[(small.width - 1) * 4]).toBeGreaterThan(240);
	});

	it('caps a PORTRAIT photograph, which is how a document is photographed', () => {
		// The mistake the browser's old capture cap made: it measured width, so a
		// tall frame was never over the limit and never came down. A phone shoots
		// portrait, so that cap fired on almost nothing.
		const tall = limitFrame(swatch(3000, 4000), 2000);
		expect(Math.max(tall.width, tall.height)).toBe(2000);
		expect(tall.width).toBe(1500);
	});

	it('caps a landscape one on the same edge', () => {
		const wide = limitFrame(swatch(4000, 3000), 2000);
		expect(wide.width).toBe(2000);
		expect(wide.height).toBe(1500);
	});

	it('leaves a frame already within the cap exactly as it is', () => {
		// Not merely equal in size — the SAME frame, because copying a 12 MP
		// photograph to change nothing is 48 MB for nothing.
		const small = swatch(800, 600);
		expect(limitFrame(small, 2000)).toBe(small);
	});
});
