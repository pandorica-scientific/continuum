// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Shared OCR helpers. `import/ocr.ts` wants word boxes (statements are
 * tables); `documents/extract/ocr.ts` wants prose + confidence. Those outputs
 * stay separate, but "can this machine read pixels at all" must not be
 * answered twice — a language not on disk is not a language this box can read.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Where `npm run fetch:tessdata` puts the models. */
export const TESSDATA = resolve('tessdata');

/**
 * The languages this product vendors. English is always included: card
 * schemes, merchant names and SWIFT text are English in every statement,
 * whatever language the rest of the page is in.
 *
 * Kept in step with `scripts/fetch-tessdata.mjs` by a test.
 */
export type OcrLanguage = 'eng' | 'ces' | 'pol' | 'deu' | 'spa' | 'ukr';
export const OCR_LANGUAGES: OcrLanguage[] = ['eng', 'ces', 'pol', 'deu', 'spa', 'ukr'];

/** What a person picking languages in Settings reads, not what tesseract does. */
export const OCR_LANGUAGE_LABELS: Record<OcrLanguage, string> = {
	eng: 'English',
	ces: 'Czech',
	pol: 'Polish',
	deu: 'German',
	spa: 'Spanish',
	ukr: 'Ukrainian'
};

/**
 * The languages whose data is actually on disk. Rejecting a missing language
 * here, at the boundary, beats a worker failing on it minutes later.
 */
export function availableLanguages(): OcrLanguage[] {
	if (!existsSync(TESSDATA)) return [];
	return OCR_LANGUAGES.filter((code) => existsSync(resolve(TESSDATA, `${code}.traineddata.gz`)));
}

/**
 * Narrow a `+`-joined language string to a set that is actually present.
 *
 * Takes the available list rather than reading the disk, so it can be tested
 * without `tessdata/` installed. Returns null when nothing survives — a run
 * with no language is not a run.
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

/**
 * Can this machine read pixels? Checks model files, not just the directory —
 * an empty `tessdata/` is a half-finished install.
 */
export const ocrAvailable = (): boolean => availableLanguages().length > 0;

/** The message every caller gives when the models are missing. One wording. */
export function missingLanguageDataMessage(what: string): string {
	return `${what} needs the OCR language data. Run "npm run fetch:tessdata" once, or rebuild the image.`;
}

/** 300 dpi: measured as the point where a rendered page reconciles reliably. */
export const RENDER_DPI = 300;

type Mupdf = typeof import('mupdf');
type MupdfPage = import('mupdf').Page;

/**
 * One page to PNG bytes. Shared so the pixmap `destroy()` (bytes live outside
 * the JS heap until then) isn't duplicated per caller. Colour is the caller's
 * choice: RGB for the statement reader, grey (a third the bytes) for extraction.
 */
export function pageToPng(
	mupdf: Mupdf,
	page: MupdfPage,
	scale: number,
	colour: 'rgb' | 'grey' = 'rgb'
): Uint8Array {
	const pixmap = page.toPixmap(
		mupdf.Matrix.scale(scale, scale),
		colour === 'grey' ? mupdf.ColorSpace.DeviceGray : mupdf.ColorSpace.DeviceRGB,
		false,
		true
	);
	try {
		return pixmap.asPNG();
	} finally {
		pixmap.destroy();
	}
}

/**
 * Render every page of a PDF to a PNG. mupdf is WASM — no native addon, so
 * the Alpine image needs no build tools.
 */
export async function renderPdfPages(
	data: Uint8Array,
	dpi = RENDER_DPI,
	maxPages = 20
): Promise<Uint8Array[]> {
	const mupdf = await import('mupdf');
	const document = mupdf.Document.openDocument(data, 'application/pdf');
	const scale = dpi / 72;
	const pages: Uint8Array[] = [];

	const count = Math.min(document.countPages(), maxPages);
	for (let index = 0; index < count; index++) {
		pages.push(pageToPng(mupdf, document.loadPage(index), scale));
	}
	return pages;
}
