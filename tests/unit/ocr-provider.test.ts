// SPDX-License-Identifier: AGPL-3.0-or-later
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	OCR_LANGUAGES,
	availableLanguages,
	narrowLanguages,
	ocrAvailable,
	renderPdfPages,
	usableLanguages
} from '$lib/server/ocr';
import { tesseractProvider } from '$lib/server/documents/extract/ocr';

// `tessdata/` is fetched at build time and is not in the repository, so CI has
// none. The RULE is tested against a fixed list either way; the two cases that
// genuinely need the models on disk say so.
const VENDORED = ['ces', 'deu', 'eng', 'pol', 'spa'];
const installed = ocrAvailable();

/**
 * The seam, not tesseract.
 *
 * What matters here is that a language nobody vendored is refused at the
 * boundary rather than several seconds into a worker, and that the provider
 * states which engine and version produced a reading — the deferred ONNX
 * adapter is a second implementation of this interface, and a confidence
 * distribution that cannot name its engine says nothing.
 */
describe('the OCR provider seam', () => {
	it('names the engine and its version', () => {
		const provider = tesseractProvider();
		expect(provider.engine).toBe('tesseract.js');
		expect(provider.engineVersion).toMatch(/^\d/);
	});

	it('names exactly the languages the fetch script vendors', () => {
		// A code named here that nobody fetches fails inside the worker, seconds
		// in, with a message about a file path. The list and the script that fills
		// the directory are one fact, so they are checked against each other
		// rather than both being maintained by hand.
		const script = readFileSync(resolve('scripts/fetch-tessdata.mjs'), 'utf8');
		const declared = script.match(/const LANGUAGES = \[([^\]]*)\]/)?.[1] ?? '';
		const fetched = [...declared.matchAll(/'([a-z]{3})'/g)].map((m) => m[1]);
		expect([...OCR_LANGUAGES].sort()).toEqual(fetched.sort());
	});

	it('keeps only the languages that are present', () => {
		expect(narrowLanguages('ces+eng', VENDORED)).toBe('ces+eng');
		expect(narrowLanguages('ces+klingon', VENDORED)).toBe('ces');
		expect(narrowLanguages(' ces + eng ', VENDORED)).toBe('ces+eng');
	});

	it('refuses a request with no available language at all', () => {
		// Rejecting here is the difference between a setting that cannot be saved
		// and a job that fails inside a worker with a message about a file path.
		expect(narrowLanguages('klingon', VENDORED)).toBeNull();
		expect(narrowLanguages('ces+eng', [])).toBeNull();
	});

	it('says whether OCR can run at all, from the models rather than the directory', () => {
		// There were two answers to this and they disagreed: one asked whether
		// `tessdata/` exists, which an empty directory satisfies, and the statement
		// reader held that weaker one. A half-fetched install then reported OCR
		// available and failed seconds later inside the worker.
		expect(ocrAvailable()).toBe(availableLanguages().length > 0);
	});

	it('reads its own list off the disk when there is one', () => {
		// Only meaningful where `npm run fetch:tessdata` has run.
		if (!installed) return;
		expect(availableLanguages()).toContain('ces');
		expect(usableLanguages('ces+klingon')).toBe('ces');
	});

	it('refuses to recognise in a language it does not have', async () => {
		await expect(tesseractProvider().recognise(new Uint8Array(), 'klingon')).rejects.toThrow(
			/language data/i
		);
	});

	it('reads a real page through the real engine', async () => {
		// One end-to-end run, so the wiring is proved rather than assumed: the
		// language path, the gzip models, the Buffer conversion and the shape of
		// what tesseract.js hands back all only fail for real.
		const source = resolve('tests/fixtures/synthetic/pdf-text/statement-001.pdf');
		if (!ocrAvailable() || !existsSync(source)) return;
		const [page] = await renderPdfPages(new Uint8Array(readFileSync(source)), 300, 1);
		const read = await tesseractProvider().recognise(page, 'eng');
		expect(read.text).toMatch(/Cash withdrawal/);
		expect(read.meanConfidence).toBeGreaterThan(50);
	}, 120_000);
});
