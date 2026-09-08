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

	it('decodes at the size asked for rather than the size stored', async () => {
		// The whole point: a photograph's file size says nothing about its decoded
		// size, so the cap is handed to the decoder instead of applied afterwards.
		// Measured on a 48 MP frame — a 0.8 MB JPEG — asking for the cap rather
		// than the whole thing took the peak from 784 MB to 411 MB.
		const jpeg = await encodeFrame(swatch(1200, 900), 'jpeg', 90);
		const small = await decodeToFrame(jpeg, 400);
		expect(Math.max(small.width, small.height)).toBe(400);
		expect(small.height).toBe(300);
	});

	it('does not turn the photograph upside down on the way', async () => {
		// The trap this guards. mupdf's sample code draws images with a y-flip,
		// which is right in PDF user space — y upward, so the first row has to be
		// sent to the TOP of the unit square — and wrong over a bare pixmap, whose
		// device space already runs downward like the rows do. Someone will
		// eventually add the idiomatic flip; this is what tells them.
		//
		// Red rises left to right and green top to bottom, so the top-left corner
		// is dark in both and the bottom-left is green.
		const jpeg = await encodeFrame(swatch(1200, 900), 'jpeg', 95);
		const small = await decodeToFrame(jpeg, 300);
		const at = (x: number, y: number) => {
			const i = (y * small.width + x) * 4;
			return { red: small.data[i], green: small.data[i + 1] };
		};
		expect(at(0, 0).green).toBeLessThan(40);
		expect(at(0, small.height - 1).green).toBeGreaterThan(215);
		expect(at(small.width - 1, 0).red).toBeGreaterThan(215);
	});

	it('reads a page back EXACTLY when no size is asked for', async () => {
		// The artefact re-read on the way into the PDF goes down this path, and
		// `assemblePdf` checks it is bilevel before packing a 1-bit stream. mupdf's
		// resampling filter is not the identity, so drawing even a 1:1 copy through
		// it would put grey along every stroke and the page would silently become
		// a JPEG instead.
		const page: Frame = { data: new Uint8ClampedArray(64 * 64 * 4), width: 64, height: 64 };
		for (let i = 0; i < 64 * 64; i++) {
			const black = (i / 64) % 2 < 1;
			page.data.set(black ? [0, 0, 0, 255] : [255, 255, 255, 255], i * 4);
		}
		const back = await decodeToFrame(await encodeFrame(page, 'png'));
		expect(back.width).toBe(64);
		const greys = [...back.data].filter((_, i) => i % 4 === 0 && ![0, 255].includes(back.data[i]));
		expect(greys).toEqual([]);
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
