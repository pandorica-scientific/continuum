// SPDX-License-Identifier: AGPL-3.0-or-later
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

/**
 * Real JPEG bytes, 20x30 and 30x20. `pdf-lib` PARSES what it embeds, so these
 * must survive `embedJpg` — including their dimensions, for the landscape case.
 */
const REAL_JPEG = Uint8Array.from(
	Buffer.from(
		'/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wgARCAAeABQDAREAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAVAQEBAAAAAAAAAAAAAAAAAAAAA//aAAwDAQACEAMQAAABrSqAAAAAP//EABQQAQAAAAAAAAAAAAAAAAAAADD/2gAIAQEAAQUCT//EABQRAQAAAAAAAAAAAAAAAAAAADD/2gAIAQMBAT8BT//EABQRAQAAAAAAAAAAAAAAAAAAADD/2gAIAQIBAT8BT//EABQQAQAAAAAAAAAAAAAAAAAAADD/2gAIAQEABj8CT//EABQQAQAAAAAAAAAAAAAAAAAAADD/2gAIAQEAAT8hT//aAAwDAQACAAMAAAAQkkkkkk//xAAUEQEAAAAAAAAAAAAAAAAAAAAw/9oACAEDAQE/EE//xAAUEQEAAAAAAAAAAAAAAAAAAAAw/9oACAECAQE/EE//xAAUEAEAAAAAAAAAAAAAAAAAAAAw/9oACAEBAAE/EE//2Q==',
		'base64'
	)
);
const REAL_JPEG_LANDSCAPE = Uint8Array.from(
	Buffer.from(
		'/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wgARCAAUAB4DAREAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAVAQEBAAAAAAAAAAAAAAAAAAAAA//aAAwDAQACEAMQAAABrSqAAAAAP//EABQQAQAAAAAAAAAAAAAAAAAAADD/2gAIAQEAAQUCT//EABQRAQAAAAAAAAAAAAAAAAAAADD/2gAIAQMBAT8BT//EABQRAQAAAAAAAAAAAAAAAAAAADD/2gAIAQIBAT8BT//EABQQAQAAAAAAAAAAAAAAAAAAADD/2gAIAQEABj8CT//EABQQAQAAAAAAAAAAAAAAAAAAADD/2gAIAQEAAT8hT//aAAwDAQACAAMAAAAQkkkkkk//xAAUEQEAAAAAAAAAAAAAAAAAAAAw/9oACAEDAQE/EE//xAAUEQEAAAAAAAAAAAAAAAAAAAAw/9oACAECAQE/EE//xAAUEAEAAAAAAAAAAAAAAAAAAAAw/9oACAEBAAE/EE//2Q==',
		'base64'
	)
);

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
		// One byte EACH row; packing continuously would shear the image by a pixel per row.
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
	it('embeds an already-encoded page without encoding it again', async () => {
		// Regression: re-encoding an already-encoded page compresses it twice at high quality.
		let encodes = 0;
		const counting = async () => {
			encodes++;
			return new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
		};
		const bytes = await assemblePdf([async () => ({ jpeg: REAL_JPEG, mode: 'color' as const })], {
			title: 'Already encoded',
			encodeJpeg: counting
		});
		expect(encodes).toBe(0);
		expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
	});

	it('still turns the sheet to match an already-encoded landscape page', async () => {
		// No `frame` to measure here, so orientation comes off the embedded image instead.
		const bytes = await assemblePdf(
			[async () => ({ jpeg: REAL_JPEG_LANDSCAPE, mode: 'color' as const })],
			{ title: 'Wide', encodeJpeg }
		);
		const [page] = (await PDFDocument.load(bytes)).getPages();
		expect(page.getWidth()).toBeGreaterThan(page.getHeight());
	});

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
		// Resolution decides quality, not paper size.
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
		// Breaks silently if the raw 1-bit stream is swapped for pdf-lib's embedPng.
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
