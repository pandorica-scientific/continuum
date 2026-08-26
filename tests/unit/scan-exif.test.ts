// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';
import { applyOrientation, readOrientation } from '$lib/scan/core/exif';
import { looksLikeHeic } from '$lib/scan/core/heic';
import { admitsImages } from '$lib/scan/core/accept';
import type { Frame } from '$lib/scan/core/types';

/** A minimal JPEG: SOI, an APP1/Exif segment holding one IFD0 tag, EOI. */
function jpegWithOrientation(value: number, endian: 'big' | 'little' = 'big'): Uint8Array {
	const body = new DataView(new ArrayBuffer(20));
	const little = endian === 'little';
	body.setUint16(0, little ? 0x4949 : 0x4d4d); // byte order
	body.setUint16(2, 0x002a, little); // magic
	body.setUint32(4, 8, little); // offset to IFD0
	body.setUint16(8, 1, little); // one entry
	body.setUint16(10, 0x0112, little); // Orientation
	body.setUint16(12, 3, little); // SHORT
	body.setUint32(14, 1, little); // count
	body.setUint16(18, value, little);
	const exif = new Uint8Array(body.buffer);

	const length = 2 + 6 + exif.length;
	return new Uint8Array([
		0xff,
		0xd8,
		0xff,
		0xe1,
		(length >> 8) & 0xff,
		length & 0xff,
		0x45,
		0x78,
		0x69,
		0x66,
		0x00,
		0x00,
		...exif,
		0xff,
		0xd9
	]);
}

const frame = (rows: number[][]): Frame => {
	const height = rows.length;
	const width = rows[0].length;
	const data = new Uint8ClampedArray(width * height * 4);
	rows.forEach((row, y) =>
		row.forEach((v, x) => {
			const i = (y * width + x) * 4;
			data[i] = data[i + 1] = data[i + 2] = v;
			data[i + 3] = 255;
		})
	);
	return { data, width, height };
};

const grid = (f: Frame) =>
	Array.from({ length: f.height }, (_, y) =>
		Array.from({ length: f.width }, (_, x) => f.data[(y * f.width + x) * 4])
	);

describe('readOrientation', () => {
	it('reads a big-endian tag', () => {
		expect(readOrientation(jpegWithOrientation(6))).toBe(6);
	});

	it('reads a little-endian tag, which is what most phones write', () => {
		expect(readOrientation(jpegWithOrientation(8, 'little'))).toBe(8);
	});

	it('says 1 when there is no EXIF at all, rather than throwing', () => {
		expect(readOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBe(1);
	});

	it('says 1 for a PNG', () => {
		expect(readOrientation(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(1);
	});

	it('says 1 rather than reading past the end of a truncated file', () => {
		expect(readOrientation(jpegWithOrientation(6).slice(0, 14))).toBe(1);
	});

	it('says 1 for a nonsense orientation value', () => {
		expect(readOrientation(jpegWithOrientation(99))).toBe(1);
	});
});

describe('applyOrientation', () => {
	const source = frame([
		[1, 2],
		[3, 4]
	]);

	it('leaves orientation 1 alone', () => {
		expect(grid(applyOrientation(source, 1))).toEqual([
			[1, 2],
			[3, 4]
		]);
	});

	it('rotates 6 a quarter turn clockwise — the common portrait-phone case', () => {
		expect(grid(applyOrientation(source, 6))).toEqual([
			[3, 1],
			[4, 2]
		]);
	});

	it('rotates 8 a quarter turn anticlockwise', () => {
		expect(grid(applyOrientation(source, 8))).toEqual([
			[2, 4],
			[1, 3]
		]);
	});

	it('turns 3 upside down', () => {
		expect(grid(applyOrientation(source, 3))).toEqual([
			[4, 3],
			[2, 1]
		]);
	});

	it('mirrors 2', () => {
		expect(grid(applyOrientation(source, 2))).toEqual([
			[2, 1],
			[4, 3]
		]);
	});

	it('swaps the dimensions on a quarter turn', () => {
		const wide = frame([[1, 2, 3]]);
		const turned = applyOrientation(wide, 6);
		expect([turned.width, turned.height]).toEqual([1, 3]);
	});

	it('keeps every pixel opaque', () => {
		const turned = applyOrientation(source, 6);
		for (let i = 3; i < turned.data.length; i += 4) expect(turned.data[i]).toBe(255);
	});
});

describe('looksLikeHeic', () => {
	const ftyp = (brand: string) =>
		new Uint8Array([0, 0, 0, 24, ...[...`ftyp${brand}`].map((c) => c.charCodeAt(0))]);

	it('recognises each brand a phone actually writes', () => {
		for (const brand of ['heic', 'heix', 'mif1', 'msf1']) {
			expect(looksLikeHeic(ftyp(brand))).toBe(true);
		}
	});

	it('does not mistake a JPEG for one', () => {
		expect(looksLikeHeic(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(false);
	});

	it('falls back to the extension, because some pickers send no usable bytes', () => {
		expect(looksLikeHeic(new Uint8Array(8), 'IMG_0421.HEIC')).toBe(true);
		expect(looksLikeHeic(new Uint8Array(8), 'IMG_0421.jpg')).toBe(false);
	});
});

describe('admitsImages', () => {
	it('is true for the wildcard and for a named image type', () => {
		expect(admitsImages('image/*')).toBe(true);
		expect(admitsImages('application/pdf,image/*')).toBe(true);
		expect(admitsImages('image/png,image/jpeg,image/webp')).toBe(true);
	});

	it('is true for an image extension, which is how half the call sites spell it', () => {
		expect(admitsImages('.pdf,.png,.jpg,.jpeg,.webp')).toBe(true);
	});

	it('is false where a camera could not help', () => {
		expect(admitsImages('application/json')).toBe(false);
		expect(admitsImages('.xlsx')).toBe(false);
		expect(admitsImages('.pdf')).toBe(false);
	});

	it('is false when no accept is given, rather than guessing', () => {
		expect(admitsImages(undefined)).toBe(false);
	});
});
