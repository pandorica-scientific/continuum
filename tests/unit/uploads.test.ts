// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { DOCUMENT_ACCEPT, UPLOAD_EXTENSIONS } from '$lib/uploads';
import { admitsImages, admitsPdf } from '$lib/scan/core/accept';

describe('what a document upload accepts', () => {
	it('offers both capture buttons', () => {
		// `UploadDropzone` decides from `accept` alone whether a camera or the
		// scanner could help. An `accept` that named nothing is why the Documents
		// screen had no scan button on a phone while every other upload site did,
		// so this is the assertion that keeps the two buttons reachable.
		expect(admitsPdf(DOCUMENT_ACCEPT)).toBe(true);
		expect(admitsImages(DOCUMENT_ACCEPT)).toBe(true);
	});

	it('takes what a phone actually produces', () => {
		// An iPhone photographs in HEIC and the scanner writes a PDF; either one
		// refused after the shutter is a dead end.
		for (const ext of ['.heic', '.heif', '.jpg', '.pdf', '.png']) {
			expect(UPLOAD_EXTENSIONS).toContain(ext);
		}
	});

	it('is extensions, each one once', () => {
		for (const ext of UPLOAD_EXTENSIONS) expect(ext).toMatch(/^\.[a-z0-9]+$/);
		expect(new Set(UPLOAD_EXTENSIONS).size).toBe(UPLOAD_EXTENSIONS.length);
		expect(DOCUMENT_ACCEPT.split(',')).toEqual([...UPLOAD_EXTENSIONS]);
	});
});
