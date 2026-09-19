// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { DOCUMENT_ACCEPT, UPLOAD_EXTENSIONS, mergePicked } from '$lib/uploads';
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

describe('gathering files across several visits to the picker', () => {
	const file = (name: string, size = 10, lastModified = 1) => ({ name, size, lastModified });

	it('keeps what was already there when more are added', () => {
		// The whole point: a file input replaces its selection, so adding one
		// document and then another used to throw the first away.
		expect(mergePicked([file('return.pdf')], [file('employer.pdf')])).toEqual([
			file('return.pdf'),
			file('employer.pdf')
		]);
	});

	it('keeps arrival order, because the answers beside each file are paired by position', () => {
		const out = mergePicked([file('a.pdf')], [file('b.pdf'), file('c.pdf')]);
		expect(out.map((f) => f.name)).toEqual(['a.pdf', 'b.pdf', 'c.pdf']);
	});

	it('counts the same file picked twice as one', () => {
		expect(mergePicked([file('return.pdf')], [file('return.pdf')])).toHaveLength(1);
	});

	it('tells apart two files that merely share a name', () => {
		// A scan and a re-scan both called scan.pdf are two documents.
		const out = mergePicked([file('scan.pdf', 10, 1)], [file('scan.pdf', 10, 2)]);
		expect(out).toHaveLength(2);
	});

	it('tells apart two files that share a name and time but not a size', () => {
		const out = mergePicked([file('scan.pdf', 10, 1)], [file('scan.pdf', 20, 1)]);
		expect(out).toHaveLength(2);
	});

	it('is a no-op for an empty pick, so a cancelled dialog loses nothing', () => {
		const held = [file('a.pdf'), file('b.pdf')];
		expect(mergePicked(held, [])).toEqual(held);
	});

	it('starts from nothing', () => {
		expect(mergePicked([], [file('a.pdf')])).toEqual([file('a.pdf')]);
		expect(mergePicked([], [])).toEqual([]);
	});

	it('does not mutate what it was given', () => {
		const held = [file('a.pdf')];
		mergePicked(held, [file('b.pdf')]);
		expect(held).toHaveLength(1);
	});
});
