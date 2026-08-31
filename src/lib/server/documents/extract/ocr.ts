// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Recognising text in an image, behind a seam.
 *
 * The seam exists because the engine is expected to change: tesseract.js is
 * what ships, and a PP-OCRv6/ONNX adapter is deferred behind evidence rather
 * than ruled out (handoff §8). A second implementation of this interface is the
 * whole change when that evidence arrives, instead of a rewrite — and `engine`
 * and `engineVersion` are recorded per run on `document_text` so the confidence
 * distribution collected later can say which engine produced it.
 *
 * WORKER PER JOB: create → recognise → terminate. A pooled worker keeps its
 * language data resident, which is the wrong trade on a box whose web server is
 * the thing that must stay responsive.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Where `npm run fetch:tessdata` puts the models. */
const TESSDATA = resolve('tessdata');

/** One page of recognised text, and how sure the engine was of it. */
export interface OcrPage {
	text: string;
	/** 0–100, as tesseract reports it. Null when the engine offers none. */
	meanConfidence: number | null;
}

export interface OcrProvider {
	readonly engine: string;
	readonly engineVersion: string;
	recognise(image: Uint8Array, languages: string): Promise<OcrPage>;
}

/**
 * The languages whose data is actually on disk.
 *
 * A language nobody vendored fails inside the worker, several seconds in, with
 * a message about a missing file. Rejecting it at the boundary is the whole
 * difference between a setting that cannot be saved and a job that cannot be
 * explained.
 */
export function availableLanguages(): string[] {
	if (!existsSync(TESSDATA)) return [];
	return ['ces', 'deu', 'eng', 'pol', 'spa'].filter((code) =>
		existsSync(resolve(TESSDATA, `${code}.traineddata.gz`))
	);
}

/**
 * Narrow a `+`-joined language string to a set that is actually present.
 *
 * Takes the available list rather than reading the disk, so the rule can be
 * tested where no language data is installed — `tessdata/` is fetched at build
 * time and is not in the repository, so a test that reached for the disk would
 * assert a fact about one developer's machine.
 *
 * Returns null when nothing survives: a run with no language is not a run, and
 * the caller records that rather than recognising in a language it does not
 * have.
 */
export function narrowLanguages(requested: string, available: readonly string[]): string | null {
	const present = new Set(available);
	const kept = requested
		.split('+')
		.map((code) => code.trim())
		.filter((code) => present.has(code));
	return kept.length > 0 ? kept.join('+') : null;
}

/** The same, against what is vendored on this machine. */
export function usableLanguages(requested: string): string | null {
	return narrowLanguages(requested, availableLanguages());
}

export const ocrAvailable = (): boolean => availableLanguages().length > 0;

export function tesseractProvider(): OcrProvider {
	return {
		engine: 'tesseract.js',
		// The installed major line. Recorded per run so a distribution collected
		// across an upgrade can be read as two populations rather than one.
		engineVersion: '7',
		async recognise(image, languages) {
			const usable = usableLanguages(languages);
			if (!usable) {
				throw new Error(
					`No OCR language data for "${languages}". Run "npm run fetch:tessdata" once, or rebuild the image.`
				);
			}
			const { createWorker } = await import('tesseract.js');
			const worker = await createWorker(usable, 1, {
				langPath: TESSDATA,
				gzip: true,
				// The models are on disk; there is nowhere to cache them to and
				// nothing to fetch. The product never calls home.
				cacheMethod: 'none'
			});
			try {
				// tesseract.js takes a Node Buffer; the bytes are already in memory.
				const { data } = await worker.recognize(Buffer.from(image));
				return {
					text: data.text ?? '',
					meanConfidence: typeof data.confidence === 'number' ? data.confidence : null
				};
			} finally {
				await worker.terminate();
			}
		}
	};
}
