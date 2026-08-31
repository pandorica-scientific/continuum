// SPDX-License-Identifier: AGPL-3.0-or-later
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
 * STATUS: reading works, and it was our own code that stopped it — twice.
 *
 * This was recorded here for a long time as "has never read a statement", over
 * two measurements: 15 refusals, then 64. Both were honest and both were
 * measured against the wrong thing. Rendering the same source PDF ourselves at
 * the same 300 dpi and recognising THAT gives every figure on the page exactly
 * right, so the recognition was never the problem and the raster fixtures those
 * sweeps used simply are not as clean as they are labelled.
 *
 * With that established, two defects in this file were in the way, and neither
 * looked like a defect from the outside because the recognised TEXT was already
 * perfect in both cases:
 *
 *   1. Words were handed on individually. A PDF's text layer emits phrases —
 *      "Cash withdrawal / Vector Mobile" is one item — and every reader
 *      downstream clusters cells into columns by their edges. Five words became
 *      five columns, and one description tore a table apart.
 *   2. The page was upside down. Tesseract reports pixel coordinates, where y
 *      grows downward; the readers were written for a text layer, where it grows
 *      upward. The footer became the first record, the movements came out
 *      reversed, and the column header — found by looking ABOVE the first
 *      movement — was looked for below it. Without a header the roles fall back
 *      to shape, and a `Debit | Credit` pair then reads as one amount column
 *      with half its rows empty.
 *
 * Measured after both: on the synthetic corpus rendered at 300 dpi, 8 of 20
 * statements are read EXACTLY, and every statement that is filed is exact —
 * nothing is imported wrongly. The rest are refused, which is the behaviour that
 * mattered all along.
 *
 * Reachable since the queue exists: `ingestFile` takes an `ocr` option and only
 * the queue passes it, because seconds per page is fine in the background and
 * never on a request.
 *
 * Whether this machine can recognise anything at all, which languages it has,
 * and how a PDF page becomes pixels are NOT decided here — they are the same
 * questions document extraction asks, and they used to be answered differently
 * in the two places. `$lib/server/ocr` answers them once. What stays here is
 * the only thing that is genuinely this reader's: turning recognised words back
 * into the line-and-cell model a statement is read from.
 */
import {
	RENDER_DPI,
	TESSDATA,
	missingLanguageDataMessage,
	ocrAvailable,
	renderPdfPages,
	type OcrLanguage
} from '$lib/server/ocr';
import type { PdfLine } from './types';

interface Word {
	text: string;
	x: number;
	/** Right edge — what a right-aligned money column actually shares. */
	end: number;
	/**
	 * Vertical position in PDF convention: UP is positive.
	 *
	 * Tesseract reports pixel coordinates, where y grows downward, and every
	 * reader downstream was written against a PDF's text layer, where it grows
	 * upward. Handing them raw pixel rows turned each page upside down: the
	 * footer became the first record, the movements came out in reverse, and the
	 * column header — which is found by looking ABOVE the first movement — was
	 * looked for below it and never found. Without a header the roles fall back
	 * to shape, and a Debit/Credit pair then reads as one amount column with
	 * half its rows empty.
	 *
	 * Negating is enough: only relative position matters, and no consumer cares
	 * where the origin is.
	 */
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
	// Words are joined into CELLS before anything geometric sees them.
	//
	// A PDF's text layer hands over phrases — "Cash withdrawal / Vector Mobile"
	// arrives as one item — and every reader downstream is built for that: they
	// cluster cells into columns by their edges. Tesseract hands over words, so
	// the same line arrived as five separate cells at five different x
	// positions, and the column clustering dutifully made five columns out of
	// one description. The recognition was perfect and the table was still
	// unreadable, which is why this looked for a long time like an OCR problem.
	//
	// The split is the gap: the space between two words of one phrase is far
	// smaller than the gap between two columns, and the page states its own
	// scale for both. The median gap across the page IS the space width, since
	// most gaps on a page are spaces.
	const allGaps: number[] = [];
	for (const group of rows.values()) {
		const ordered = [...group].sort((a, b) => a.x - b.x);
		for (let i = 1; i < ordered.length; i++) allGaps.push(ordered[i].x - ordered[i - 1].end);
	}
	const positive = allGaps.filter((gap) => gap > 0).sort((a, b) => a - b);
	const medianGap = positive.length ? positive[Math.floor(positive.length / 2)] : 0;
	// Three spaces is not a space. Below that a gap is word spacing; above it,
	// the layout meant something by it.
	const columnGap = Math.max(medianGap * 3, tolerance);

	const joinWords = (ordered: Word[]): Word[] => {
		const cells: Word[] = [];
		for (const word of ordered) {
			const open = cells[cells.length - 1];
			if (open && word.x - open.end <= columnGap) {
				open.text = `${open.text} ${word.text}`;
				open.end = word.end;
			} else cells.push({ ...word });
		}
		return cells;
	};

	return (
		[...rows.entries()]
			// Reading order, which in PDF convention is descending y.
			.sort((a, b) => b[0] - a[0])
			.map(([key, group]) => {
				const ordered = joinWords(group.sort((a, b) => a.x - b.x));
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
			})
	);
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
		throw new Error(missingLanguageDataMessage('Reading scanned statements'));
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
							words.push({ text, x: word.bbox.x0, end: word.bbox.x1, y: -word.bbox.y0 });
						}
					}
				}
			}
			// A line's height is ~40px at 300 dpi; half of that separates rows without
			// splitting a row whose glyphs sit at slightly different tops. Derived
			// from the dpi actually rendered at rather than fixed at the value 300
			// gives, because the caller chooses the dpi — and at 150 a fixed 20px is
			// a whole line, which merges every pair of movements into one.
			lines.push(...wordsToLines(words, index + 1, Math.max(6, dpi / 15), dpi / 72));
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
		throw new Error(missingLanguageDataMessage('Reading statements from photographs'));
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
						if (text) words.push({ text, x: word.bbox.x0, end: word.bbox.x1, y: -word.bbox.y0 });
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
