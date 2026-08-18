/**
 * Reading a statement from pixels.
 *
 * OCR here is ARBITRATION, not a fallback. A PDF's text layer fails in ways
 * that look like success — two unrelated documents in the sample set emit
 * ligatures as separate items (`con § fi § rmation`, `fl § at rent`), and
 * line reconstruction rounds baselines onto a grid, so staggered rows silently
 * merge or split. Nothing errors; the parse simply contains different words
 * than the page shows. Rendering the page gives a genuinely INDEPENDENT read of
 * the same pixels, and the balances decide which read to keep.
 *
 * Everything stays on the machine. Language data is fetched once at build time
 * (`npm run fetch:tessdata`) and read from disk; nothing is requested while
 * anyone is using the product.
 *
 * The output is deliberately `PdfLine[]` — the same shape the text layer
 * produces — so a scanned page and a digital one travel the identical road
 * afterwards: geometry, regions, determinacy, proof.
 *
 * ---
 *
 * STATUS: this has never read a statement. Measured twice, most recently across
 * 64 raster derivatives of the synthetic corpus — PNG at 300 dpi, JPEG at 150,
 * TIFF at 400 and scanned PDF at 200 — with every fix from the tabular and
 * rhythm work in place: **0 read, 64 refused.**
 *
 * The pipeline is not the problem. The table is found and most rows assemble;
 * the digits are wrong. On a clean 300 dpi render of a synthetic statement:
 *
 *     812.62    -> 612.62        -411.64   -> -41164   (the decimal is lost)
 *     89.80     -> 1350          28,873.01 -> 28,073.01
 *     29,775.01 -> 239,775.01    -86.11    -> -66.11
 *
 * Those are substitutions, not formatting, so no amount of post-processing
 * recovers them. Confidence is 63 on a page a person reads without effort.
 *
 * Four explanations were tested and none of them is it. Recorded so the next
 * attempt starts further along:
 *
 *   - NOT the language count. `eng` alone, `eng+pol` and all five score the
 *     same (0-1 of 10 figures exact).
 *   - NOT the `_fast` models. The full 10 MB `eng` traineddata scores the same,
 *     at the same confidence.
 *   - NOT the image. 2480x3509 at 300 dpi, 8-bit RGB, visibly crisp — the
 *     figures are legible even downscaled to a third.
 *   - NOT the missing DPI metadata. These PNGs carry no `pHYs` chunk, so
 *     Tesseract assumes 70 dpi; setting `user_defined_dpi` to 300 changes the
 *     output not at all.
 *
 * What remains untested is the WASM build against a native Tesseract on the
 * same page. If those differ, the answer is upstream of this file entirely.
 *
 * The half that matters holds: all 64 were REFUSED, none imported wrongly. The
 * proof gate does not care where a reading came from.
 *
 * Nothing in production sets `options.ocr`, and the upload dialog no longer
 * offers image formats, because a promise that always fails is worse than an
 * absent one. This is kept rather than deleted because it is structurally
 * sound and isolated; it is marked here so it cannot be mistaken for finished.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PdfLine } from './types';

/** Where `npm run fetch:tessdata` puts the models. */
const TESSDATA = resolve('tessdata');

/**
 * Language per statement language. English is always included: card schemes,
 * merchant names and SWIFT text are English inside every statement we have.
 */
export type OcrLanguage = 'eng' | 'ces' | 'pol' | 'deu' | 'spa';
export const OCR_LANGUAGES: OcrLanguage[] = ['eng', 'ces', 'pol', 'deu', 'spa'];

/** 300 dpi: measured as the point where a rendered page reconciles reliably. */
export const RENDER_DPI = 300;

export const ocrAvailable = (): boolean => existsSync(TESSDATA);

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
		const page = document.loadPage(index);
		const pixmap = page.toPixmap(
			mupdf.Matrix.scale(scale, scale),
			mupdf.ColorSpace.DeviceRGB,
			false,
			true
		);
		pages.push(pixmap.asPNG());
		pixmap.destroy?.();
	}
	return pages;
}

interface Word {
	text: string;
	x: number;
	/** Right edge — what a right-aligned money column actually shares. */
	end: number;
	y: number;
}

/**
 * Group recognised words into lines by vertical position.
 *
 * Word BOXES rather than tesseract's own text lines: its line breaking is a
 * layout decision made without knowing the document is a table, and a rigid
 * text-line reader discarded rows OCR had actually read correctly. Coordinates
 * survive that decision.
 */
function wordsToLines(words: Word[], page: number, tolerance: number, scale: number): PdfLine[] {
	const rows = new Map<number, Word[]>();
	for (const word of words) {
		const key = Math.round(word.y / tolerance);
		if (!rows.has(key)) rows.set(key, []);
		rows.get(key)!.push(word);
	}
	return [...rows.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([key, group]) => {
			const ordered = group.sort((a, b) => a.x - b.x);
			return {
				page,
				y: (key * tolerance) / scale,
				cells: ordered.map((w) => w.text),
				// Back to PDF points. The geometric reader clusters columns with a
				// tolerance in those units, and handing it 300 dpi pixels made every
				// column land on its own key — so nothing recurred, no columns were
				// found, and a perfectly good OCR read produced no table at all.
				xs: ordered.map((w) => w.x / scale),
				xEnds: ordered.map((w) => w.end / scale)
			};
		});
}

/**
 * Read a PDF's pages as an image, returning the same line model the text layer
 * produces.
 *
 * `languages` should name the statement's own language plus English; a worker
 * is created per call and terminated, because a statement is read once and a
 * pooled worker holding a language model open is memory a self-hosted box
 * would rather spend elsewhere.
 */
export async function ocrPdf(
	data: Uint8Array,
	languages: OcrLanguage[] = ['eng'],
	options: { dpi?: number; maxPages?: number } = {}
): Promise<PdfLine[]> {
	if (!ocrAvailable()) {
		throw new Error(
			'Reading scanned statements needs the OCR language data. Run "npm run fetch:tessdata" once, or rebuild the image.'
		);
	}

	const { createWorker } = await import('tesseract.js');
	const dpi = options.dpi ?? RENDER_DPI;
	const pages = await renderPdfPages(data, dpi, options.maxPages ?? 20);
	const worker = await createWorker(languages.join('+'), 1, {
		langPath: TESSDATA,
		gzip: true,
		// The models are on disk; there is nowhere to cache them to and nothing
		// to fetch.
		cacheMethod: 'none'
	});

	try {
		const lines: PdfLine[] = [];
		for (const [index, image] of pages.entries()) {
			// tesseract.js takes a Node Buffer; the PNG bytes are already in memory.
			const { data: result } = await worker.recognize(Buffer.from(image), {}, { blocks: true });
			const words: Word[] = [];
			for (const block of result.blocks ?? []) {
				for (const paragraph of block.paragraphs ?? []) {
					for (const line of paragraph.lines ?? []) {
						for (const word of line.words ?? []) {
							const text = word.text?.trim();
							if (!text) continue;
							words.push({ text, x: word.bbox.x0, end: word.bbox.x1, y: word.bbox.y0 });
						}
					}
				}
			}
			// A line's height at 300 dpi is ~40px; half of that separates rows
			// without splitting a row whose glyphs sit at slightly different tops.
			lines.push(...wordsToLines(words, index + 1, 20, dpi / 72));
		}
		return lines;
	} finally {
		await worker.terminate();
	}
}

/**
 * Read a photograph or scan of a statement.
 *
 * The same road as a PDF from here on: word boxes, geometry, regions, proof.
 * No rasterisation is needed because the pixels already are the page, and no
 * DPI is assumed — the geometric reader sizes its tolerances from the spread
 * of the coordinates it is given.
 */
export async function ocrImage(
	image: Uint8Array,
	languages: OcrLanguage[] = ['eng']
): Promise<PdfLine[]> {
	if (!ocrAvailable()) {
		throw new Error(
			'Reading statements from photographs needs the OCR language data. Run "npm run fetch:tessdata" once, or rebuild the image.'
		);
	}
	const { createWorker } = await import('tesseract.js');
	const worker = await createWorker(languages.join('+'), 1, {
		langPath: TESSDATA,
		gzip: true,
		cacheMethod: 'none'
	});
	try {
		const { data } = await worker.recognize(Buffer.from(image), {}, { blocks: true });
		const words: Word[] = [];
		for (const block of data.blocks ?? []) {
			for (const paragraph of block.paragraphs ?? []) {
				for (const line of paragraph.lines ?? []) {
					for (const word of line.words ?? []) {
						const text = word.text?.trim();
						if (text) words.push({ text, x: word.bbox.x0, end: word.bbox.x1, y: word.bbox.y0 });
					}
				}
			}
		}
		// A photograph has no known DPI, so rows are grouped from the words'
		// own median height rather than a pixel constant.
		const heights = (data.blocks ?? []).flatMap((b) =>
			(b.paragraphs ?? []).flatMap((p) => (p.lines ?? []).map((l) => l.bbox.y1 - l.bbox.y0))
		);
		const median = heights.length
			? heights.sort((a, b) => a - b)[Math.floor(heights.length / 2)]
			: 20;

		// Normalise to PDF points, the units the geometric reader works in.
		//
		// A photograph carries no DPI, so the page's own width supplies the
		// scale: whatever it was captured at, a statement is about 595 points
		// across. Leaving pixels alone made a page read at 300 dpi four times too
		// wide, and a tolerance sized for points then put every cell in its own
		// column — the identical failure that made this reader find no table.
		const xs = words.map((w) => w.x);
		const span = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
		const scale = span > 0 ? span / 500 : 1;
		return wordsToLines(words, 1, Math.max(6, median * 0.6), scale);
	} finally {
		await worker.terminate();
	}
}

/** Which languages to try, from what the text layer (if any) suggests. */
export function languagesFor(sampleText: string): OcrLanguage[] {
	const hints: [OcrLanguage, RegExp][] = [
		['ces', /[ěščřžůťďň]|zůstatek|výpis|částka/i],
		['pol', /[ąćęłńśźż]|saldo|rachunku|operacji/i],
		['deu', /[äöüß]|kontostand|buchung|betrag/i],
		['spa', /saldo inicial|importe|cuenta|fecha/i]
	];
	const found = hints
		.filter(([, pattern]) => pattern.test(sampleText))
		.map(([language]) => language);
	// English always: card schemes and merchant names are English everywhere.
	return ['eng', ...found];
}
