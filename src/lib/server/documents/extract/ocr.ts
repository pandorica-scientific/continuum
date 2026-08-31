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
 *
 * Where the models are, which of them are on disk, and whether this machine can
 * recognise anything at all live in `$lib/server/ocr`: the statement reader asks
 * the same questions, and while both files answered them there was one answer
 * each and they disagreed.
 */
import { TESSDATA, missingLanguageDataMessage, usableLanguages } from '$lib/server/ocr';

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

export function tesseractProvider(): OcrProvider {
	return {
		engine: 'tesseract.js',
		// The installed major line. Recorded per run so a distribution collected
		// across an upgrade can be read as two populations rather than one.
		engineVersion: '7',
		async recognise(image, languages) {
			const usable = usableLanguages(languages);
			if (!usable) throw new Error(missingLanguageDataMessage(`Recognising "${languages}"`));

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
