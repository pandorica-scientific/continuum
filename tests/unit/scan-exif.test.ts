// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
	applyOrientation,
	needsRotation,
	readOrientation,
	readStoredSize,
	turnsAQuarter
} from '$lib/scan/core/exif';
import { looksLikeHeic } from '$lib/scan/core/heic';
import { admitsImages, admitsPdf } from '$lib/scan/core/accept';
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

describe('admitsPdf', () => {
	it('is true where a PDF is welcome, however the accept is spelled', () => {
		expect(admitsPdf('.pdf')).toBe(true);
		expect(admitsPdf('application/pdf,image/*')).toBe(true);
		expect(admitsPdf('.pdf,.png,.jpg,.jpeg,.webp')).toBe(true);
	});

	it('is false for image-only sites, which is what separates the two buttons', () => {
		// A scan is a PDF. Offering one where PDFs are refused would produce a
		// file the form then rejects.
		expect(admitsPdf('image/png,image/jpeg,image/webp')).toBe(false);
		expect(admitsPdf('image/*')).toBe(false);
	});

	it('is false for the sites that take neither', () => {
		expect(admitsPdf('application/json')).toBe(false);
		expect(admitsPdf('.xlsx')).toBe(false);
		expect(admitsPdf(undefined)).toBe(false);
	});
});

/** A JPEG with an XMP APP1 BEFORE the Exif one, as an iPhone actually writes. */
function jpegWithXmpFirst(orientation: number): Uint8Array {
	const xmp = [...'http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>'].map((c) => c.charCodeAt(0));
	const xmpLength = xmp.length + 2;

	const body = new DataView(new ArrayBuffer(20));
	body.setUint16(0, 0x4d4d);
	body.setUint16(2, 0x002a);
	body.setUint32(4, 8);
	body.setUint16(8, 1);
	body.setUint16(10, 0x0112);
	body.setUint16(12, 3);
	body.setUint32(14, 1);
	body.setUint16(18, orientation);
	const exif = [...new Uint8Array(body.buffer)];
	const exifLength = 2 + 6 + exif.length;

	return new Uint8Array([
		0xff,
		0xd8,
		0xff,
		0xe1,
		(xmpLength >> 8) & 0xff,
		xmpLength & 0xff,
		...xmp,
		0xff,
		0xe1,
		(exifLength >> 8) & 0xff,
		exifLength & 0xff,
		0x45,
		0x78,
		0x69,
		0x66,
		0x00,
		0x00,
		...exif,
		0xff,
		0xc0,
		0x00,
		0x11,
		0x08,
		0x17,
		0x70,
		0x1f,
		0x40,
		0x03,
		0x01,
		0x11,
		0x00,
		0x02,
		0x11,
		0x01,
		0x03,
		0x11,
		0x01,
		0xff,
		0xd9
	]);
}

describe('an APP1 that is not Exif', () => {
	it('is skipped rather than parsed as a TIFF header', () => {
		// An iPhone writes TWO APP1 segments, Exif and XMP. Reading the XMP's
		// opening text as a TIFF header yields a plausible-looking number — it
		// produced 6 where the truth was 1 — and a photo needing no rotation was
		// turned ninety degrees.
		expect(readOrientation(jpegWithXmpFirst(6))).toBe(6);
		expect(readOrientation(jpegWithXmpFirst(1))).toBe(1);
	});

	it('stops at the start of scan rather than walking into pixel data', () => {
		const truncated = jpegWithXmpFirst(6).slice(0, 30);
		expect(() => readOrientation(truncated)).not.toThrow();
	});
});

describe('readStoredSize', () => {
	it('reads the dimensions the file actually holds', () => {
		// 0x1770 = 6000 tall, 0x1f40 = 8000 wide, from the SOF above.
		expect(readStoredSize(jpegWithXmpFirst(6))).toEqual({ width: 8000, height: 6000 });
	});

	it('is null for something that is not a JPEG', () => {
		// The caller's cue not to guess: unreadable means leave the image alone.
		expect(readStoredSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
	});

	it('does not mistake a Huffman table for a frame', () => {
		// 0xFFC4 sits inside the SOF marker range and is not one.
		const withDht = new Uint8Array([0xff, 0xd8, 0xff, 0xc4, 0x00, 0x04, 0x00, 0x00, 0xff, 0xd9]);
		expect(readStoredSize(withDht)).toBeNull();
	});
});

describe('turnsAQuarter', () => {
	it('is true only for the four that swap width and height', () => {
		expect([1, 2, 3, 4].map(turnsAQuarter)).toEqual([false, false, false, false]);
		expect([5, 6, 7, 8].map(turnsAQuarter)).toEqual([true, true, true, true]);
	});
});

describe('needsRotation', () => {
	// Your iPhone's photo: stored landscape, EXIF 6, displayed portrait.
	const stored = { width: 8064, height: 6048 };

	it('says no when the decoder already turned it — Chrome', () => {
		// Chrome applies EXIF whatever `imageOrientation` asks. Measured: 'none',
		// 'from-image' and the default all return the same rotated bitmap.
		expect(needsRotation(6, { width: 6048, height: 8064 }, stored)).toBe(false);
	});

	it('says yes when the decoder did not — Safari', () => {
		expect(needsRotation(6, { width: 8064, height: 6048 }, stored)).toBe(true);
	});

	it('is unaffected by the frame having been scaled down first', () => {
		// THE bug. Frames are capped at 3200px before this runs, so no dimension
		// matches anything stored. Comparing sizes concluded "not turned" every
		// time and rotated twice — right on Safari, wrong on Chrome, which is
		// exactly the split that showed up: upright on the phone, on its side in
		// the browser.
		expect(needsRotation(6, { width: 3200, height: 4267 }, stored)).toBe(false);
		expect(needsRotation(6, { width: 3200, height: 2400 }, stored)).toBe(true);
	});

	it('leaves an upright image alone', () => {
		expect(needsRotation(1, { width: 100, height: 200 }, stored)).toBe(false);
	});

	it('applies a mirror or a half turn, which change no shape to compare', () => {
		for (const orientation of [2, 3, 4]) {
			expect(needsRotation(orientation, { width: 100, height: 200 }, stored)).toBe(true);
		}
	});

	it('does nothing when the stored size cannot be read', () => {
		// Wrong way round is recoverable with the rotate button; corrupted is not.
		expect(needsRotation(6, { width: 3200, height: 4267 }, null)).toBe(false);
	});

	it('ignores a nonsense orientation rather than acting on it', () => {
		expect(needsRotation(0, { width: 100, height: 200 }, stored)).toBe(false);
		expect(needsRotation(99, { width: 100, height: 200 }, stored)).toBe(false);
	});
});
