// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import { deflate, isBilevel, packBilevel } from '$lib/scan/core/bilevel';
import { assemblePdf, type PageProvider } from '$lib/scan/core/pdf';
import type { Frame } from '$lib/scan/core/types';

/** Build a frame from a grid of 0/1, where 1 is white. */
function frameFrom(rows: number[][]): Frame {
	const height = rows.length;
	const width = rows[0].length;
	const data = new Uint8ClampedArray(width * height * 4);
	rows.forEach((row, y) =>
		row.forEach((bit, x) => {
			const i = (y * width + x) * 4;
			data[i] = data[i + 1] = data[i + 2] = bit ? 255 : 0;
			data[i + 3] = 255;
		})
	);
	return { data, width, height };
}

/** A page of text-like bands: black rules on white, which is what a scan is. */
function bilevelPage(width: number, height: number): Frame {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++) {
		const ink = y % 40 < 3;
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4;
			data[i] = data[i + 1] = data[i + 2] = ink ? 0 : 255;
			data[i + 3] = 255;
		}
	}
	return { data, width, height };
}

// The real one needs a canvas, which core may not touch.
const encodeJpeg = async () => new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

describe('isBilevel', () => {
	it('is true when every pixel is pure black or pure white', () => {
		expect(
			isBilevel(
				frameFrom([
					[0, 1],
					[1, 0]
				])
			)
		).toBe(true);
	});

	it('is false for anything in between', () => {
		const frame = frameFrom([[0, 1]]);
		frame.data[0] = 128;
		expect(isBilevel(frame)).toBe(false);
	});
});

describe('packBilevel', () => {
	it('packs MSB first, which is what PDF reads', () => {
		expect(Array.from(packBilevel(frameFrom([[1, 0, 0, 0, 0, 0, 0, 0]])))).toEqual([0x80]);
	});

	it('pads each row to a whole byte, because rows do not share bytes in PDF', () => {
		// Three pixels per row, two rows: one byte EACH, not one byte total.
		// Packing continuously shears the image by a pixel per row.
		const packed = packBilevel(
			frameFrom([
				[1, 1, 1],
				[0, 0, 0]
			])
		);
		expect(packed.length).toBe(2);
		expect(Array.from(packed)).toEqual([0b11100000, 0b00000000]);
	});

	it('is eight times smaller than one byte per pixel, which is the whole point', () => {
		const rows = Array.from({ length: 64 }, () => Array.from({ length: 64 }, () => 1));
		expect(packBilevel(frameFrom(rows)).length).toBe((64 * 64) / 8);
	});
});

describe('deflate', () => {
	it('round-trips through a standard inflater', () => {
		// If this is not real zlib, every reader rejects the page.
		const original = new Uint8Array(1000).fill(0xff);
		return deflate(original).then((packed) => {
			expect(Array.from(inflateSync(packed))).toEqual(Array.from(original));
		});
	});

	it('actually compresses a page-shaped run of white', async () => {
		const white = new Uint8Array((2480 * 3508) / 8).fill(0xff);
		expect((await deflate(white)).length).toBeLessThan(white.length / 50);
	});
});

describe('assemblePdf', () => {
	it('makes one page per scan page, in the order given', async () => {
		const pages: PageProvider[] = [
			async () => ({ frame: bilevelPage(200, 283), mode: 'bw' as const }),
			async () => ({ frame: bilevelPage(200, 283), mode: 'bw' as const }),
			async () => ({ frame: bilevelPage(283, 200), mode: 'bw' as const })
		];
		const bytes = await assemblePdf(pages, { title: 'Nájemní smlouva', encodeJpeg });
		expect((await PDFDocument.load(bytes)).getPageCount()).toBe(3);
	});

	it('titles the document with the name the user typed', async () => {
		const bytes = await assemblePdf(
			[async () => ({ frame: bilevelPage(200, 283), mode: 'bw' as const })],
			{
				title: 'Nájemní smlouva',
				encodeJpeg
			}
		);
		expect((await PDFDocument.load(bytes)).getTitle()).toBe('Nájemní smlouva');
	});

	it('turns the sheet to match the image, rather than rotating the page', async () => {
		const bytes = await assemblePdf(
			[async () => ({ frame: bilevelPage(283, 200), mode: 'bw' as const })],
			{
				title: 'Wide',
				encodeJpeg
			}
		);
		const [page] = (await PDFDocument.load(bytes)).getPages();
		expect(page.getWidth()).toBeGreaterThan(page.getHeight());
		// Still A4, just landscape.
		expect(Math.round(page.getWidth())).toBe(842);
		expect(Math.round(page.getHeight())).toBe(595);
	});

	it('makes an A4 sheet regardless of how many pixels the capture had', async () => {
		// Deriving the page size from the pixel count made the PHYSICAL page
		// shrink with the capture resolution: a 1240px scan came out as a
		// 105x148mm card. Resolution decides quality, not paper size.
		for (const [w, h] of [
			[2480, 3508],
			[1240, 1754],
			[800, 1131]
		]) {
			const bytes = await assemblePdf(
				[async () => ({ frame: bilevelPage(w, h), mode: 'bw' as const })],
				{
					title: 'A4',
					encodeJpeg
				}
			);
			const [page] = (await PDFDocument.load(bytes)).getPages();
			expect(Math.round(page.getWidth())).toBe(595);
			expect(Math.round(page.getHeight())).toBe(842);
		}
	}, 60_000);

	it('keeps a binarized A4 page well under 150 KB', async () => {
		// The acceptance criterion, and the thing that silently breaks if anyone
		// swaps the raw 1-bit stream for pdf-lib's embedPng.
		const bytes = await assemblePdf(
			[async () => ({ frame: bilevelPage(2480, 3508), mode: 'bw' as const })],
			{
				title: 'Big',
				encodeJpeg
			}
		);
		expect(bytes.length).toBeLessThan(150 * 1024);
	}, 30_000);

	it('refuses to build a PDF from no pages rather than emitting an empty one', async () => {
		await expect(assemblePdf([], { title: 'Nothing', encodeJpeg })).rejects.toThrow(
			/at least one page/i
		);
	});
});
