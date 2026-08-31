// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What both OCR paths need, in one place.
 *
 * Two readers recognise text on this machine and they want genuinely different
 * things from it: `import/ocr.ts` wants word BOXES, because a statement is a
 * table and geometry is what makes it one; `documents/extract/ocr.ts` wants a
 * page of PROSE and a confidence, because search does not care where a word
 * sat. Those two outputs stay apart.
 *
 * What must not stay apart is the answer to "can this machine read pixels at
 * all". It was answered twice and the two answers disagreed: one asked whether
 * `tessdata/` exists, which an empty directory satisfies, and the other asked
 * whether any `*.traineddata.gz` is actually in it. The weaker answer sat in
 * front of the import path, so a half-fetched install reported OCR available
 * and then failed several seconds later inside the worker, where the message
 * belongs to tesseract and not to us. One definition, the strict one, because a
 * language that is not on disk is not a language this box can read.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Where `npm run fetch:tessdata` puts the models. */
export const TESSDATA = resolve('tessdata');

/**
 * The languages this product vendors.
 *
 * English is always among them and is always included in a request: card
 * schemes, merchant names and SWIFT text are English inside every statement we
 * have, whatever language the rest of the page is in.
 *
 * Kept in step with `scripts/fetch-tessdata.mjs` by a test, because a code
 * naming a model nobody fetches fails inside the worker rather than here.
 */
export type OcrLanguage = 'eng' | 'ces' | 'pol' | 'deu' | 'spa';
export const OCR_LANGUAGES: OcrLanguage[] = ['eng', 'ces', 'pol', 'deu', 'spa'];

/**
 * The languages whose data is actually on disk.
 *
 * A language nobody vendored fails inside the worker, several seconds in, with
 * a message about a missing file. Rejecting it at the boundary is the whole
 * difference between a setting that cannot be saved and a job that cannot be
 * explained.
 */
export function availableLanguages(): OcrLanguage[] {
	if (!existsSync(TESSDATA)) return [];
	return OCR_LANGUAGES.filter((code) => existsSync(resolve(TESSDATA, `${code}.traineddata.gz`)));
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

/**
 * Can this machine read pixels?
 *
 * Model files, not the directory: an empty `tessdata/` is a half-finished
 * install, and reporting it as ready moves the failure from here — where the
 * message can name `npm run fetch:tessdata` — into the worker, seconds later.
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
 * One page to PNG bytes.
 *
 * Small, and shared anyway, because the pixmap dance is where the leak is: a
 * pixmap holds bytes outside the JS heap until `destroy` is called, and three
 * copies of this were three places to forget it. Colour is the caller's: the
 * statement reader wants RGB because it hands the same bytes to a recogniser
 * tuned on colour pages, extraction wants grey because it is a third of the
 * bytes for the same words.
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
 * Render every page of a PDF to a PNG.
 *
 * mupdf is WASM — no native addon, so the Alpine image needs no build tools and
 * a developer's machine behaves the same as the container.
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
