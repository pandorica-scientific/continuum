// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/**
 * Reading the words out of a filed document, so they can be searched.
 *
 * Routing is PER PAGE, not per file, and that is v1 rather than a refinement:
 * a born-digital contract with a scanned signature page is the ordinary case in
 * a household, and a whole-file decision gets it wrong in both directions — OCR
 * the lot and the typed pages come back worse than they went in; trust the text
 * layer and the signed page is blank.
 *
 * WHAT THIS NEVER DOES (handoff §4.3): no PDF rewriting, no field extraction
 * into metadata, no writes to a document's name, dates or amounts. Text goes
 * into chunks and nowhere else. Grabbing the invoice number "while we are in
 * there" is explicitly out of scope, and a reader who adds it here will have
 * quietly made extraction a thing that edits records.
 */
import { and, eq, max, sql } from 'drizzle-orm';
import { db, type Db } from '$lib/server/db';
import { document, documentText, documentTextChunk } from '$lib/server/db/schema';
import { hashBytes, readUpload } from '$lib/server/system/files';
import { getSetting } from '$lib/server/settings';
import { DEFAULT_LIMITS, MAX_CHUNK_BYTES, type ExtractionLimits } from './limits';
import { tesseractProvider, type OcrProvider } from './ocr';

/** A page with fewer folded characters than this was not really typed. */
const TEXT_LAYER_MIN_CHARS = 50;

/** Rendered at the DPI the statement reader measured as reliable. */
const RENDER_DPI = 300;

export interface ExtractedChunk {
	ordinal: number;
	pageNo: number | null;
	source: 'text_layer' | 'ocr' | 'plain';
	text: string;
}

export interface ExtractionRun {
	chunks: ExtractedChunk[];
	/** Null when nothing was recognised — a text-layer-only run reports none. */
	meanConfidence: number | null;
	/** Pages read by the END of this run, counting earlier slices. */
	pagesExtracted: number | null;
	complete: boolean;
}

/** Extensions this reads. Anything else gets no `document_text` row at all. */
const PDF = new Set(['pdf']);
const IMAGE = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif']);
const PLAIN = new Set(['txt', 'csv', 'md']);

export function isExtractable(ext: string): boolean {
	const e = ext.toLowerCase().replace(/^\./, '');
	return PDF.has(e) || IMAGE.has(e) || PLAIN.has(e);
}

/**
 * Cut plain text into chunks no index will choke on.
 *
 * PostgreSQL refuses a `tsvector` over about 1 MB, so the wall a 600-page scan
 * meets is the same wall a large CSV meets. Split on a line break where one is
 * near the boundary, so a chunk rarely ends mid-row.
 */
export function slicePlainText(text: string, maxBytes = MAX_CHUNK_BYTES): string[] {
	const slices: string[] = [];
	let rest = text;
	while (rest.length > maxBytes) {
		const window = rest.slice(0, maxBytes);
		const brk = window.lastIndexOf('\n');
		const cut = brk > maxBytes / 2 ? brk + 1 : maxBytes;
		slices.push(rest.slice(0, cut));
		rest = rest.slice(cut);
	}
	if (rest.length > 0) slices.push(rest);
	return slices;
}

/** Folded length, so a page of punctuation does not read as a text layer. */
function meaningfulLength(text: string): number {
	return text.replace(/[^\p{L}\p{N}]/gu, '').length;
}

async function ocrLanguages(handle: Db = db): Promise<string> {
	return getSetting('ocr.languages', 'ces+eng', handle);
}

/**
 * Read one file into chunks, starting after `fromPage` pages already read.
 *
 * Pure with respect to the database: it takes bytes and returns chunks, so the
 * routing can be tested without a row anywhere.
 */
export async function extractFromBytes(
	bytes: Uint8Array,
	ext: string,
	options: {
		languages: string;
		limits?: ExtractionLimits;
		provider?: OcrProvider;
		/** Pages already read by earlier slices of this same file. */
		fromPage?: number;
	}
): Promise<ExtractionRun | null> {
	const limits = options.limits ?? DEFAULT_LIMITS;
	const provider = options.provider ?? tesseractProvider();
	const e = ext.toLowerCase().replace(/^\./, '');
	const fromPage = options.fromPage ?? 0;

	if (bytes.length > limits.maxFileBytes) {
		// Recorded as an incomplete run rather than skipped silently: the
		// inspector has to be able to say why nothing is searchable.
		return { chunks: [], meanConfidence: null, pagesExtracted: 0, complete: false };
	}

	if (PLAIN.has(e)) {
		const { decode } = await import('iconv-lite');
		const capped = bytes.length > limits.maxPlainBytes;
		const text = decode(Buffer.from(capped ? bytes.slice(0, limits.maxPlainBytes) : bytes), 'utf8');
		const slices = slicePlainText(text);
		return {
			chunks: slices.map((slice, i) => ({
				ordinal: fromPage + i,
				pageNo: null,
				source: 'plain' as const,
				text: slice
			})),
			meanConfidence: null,
			pagesExtracted: null,
			complete: !capped
		};
	}

	if (IMAGE.has(e)) {
		const page = await provider.recognise(bytes, options.languages);
		return {
			chunks: [{ ordinal: 0, pageNo: null, source: 'ocr', text: page.text }],
			meanConfidence: page.meanConfidence,
			pagesExtracted: 1,
			complete: true
		};
	}

	if (!PDF.has(e)) return null;

	const mupdf = await import('mupdf');
	const pdf = mupdf.Document.openDocument(bytes, 'application/pdf');
	const pageCount = pdf.countPages();
	const chunks: ExtractedChunk[] = [];
	const confidences: number[] = [];
	let ocrPages = 0;
	let page = fromPage;

	for (; page < pageCount; page++) {
		const loaded = pdf.loadPage(page);
		const layer = loaded.toStructuredText().asText();
		if (meaningfulLength(layer) >= TEXT_LAYER_MIN_CHARS) {
			// A typed page. Reading it as an image would be slower AND worse.
			chunks.push({ ordinal: page, pageNo: page + 1, source: 'text_layer', text: layer });
			continue;
		}
		if (ocrPages >= limits.maxOcrPagesPerRun) break;

		// A scanned page. Rasterised at the DPI the statement reader measured,
		// scaled down if the page is enormous — a poster-sized plan at 300 DPI is
		// a pixmap large enough to matter on a small box.
		const bounds = loaded.getBounds();
		const wide = Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1]);
		const scale = Math.min(RENDER_DPI / 72, limits.maxPageDim / Math.max(wide, 1));
		const pixmap = loaded.toPixmap(
			mupdf.Matrix.scale(scale, scale),
			mupdf.ColorSpace.DeviceGray,
			false,
			true
		);
		const png = pixmap.asPNG();
		pixmap.destroy?.();
		const read = await provider.recognise(png, options.languages);
		if (read.meanConfidence !== null) confidences.push(read.meanConfidence);
		chunks.push({ ordinal: page, pageNo: page + 1, source: 'ocr', text: read.text });
		ocrPages++;
	}

	return {
		chunks,
		meanConfidence:
			confidences.length > 0
				? confidences.reduce((sum, c) => sum + c, 0) / confidences.length
				: null,
		pagesExtracted: page,
		complete: page >= pageCount
	};
}

/**
 * Read a document's file and record what it says.
 *
 * The staleness guard is here rather than on the job row, and it compares what
 * was actually READ to what is on the document now: the file may be replaced
 * while these pages are being turned, and a run that finishes afterwards would
 * otherwise index a document that no longer exists. Both ends of the race are
 * closed — the enqueue side cancels a job still queued (`cancelQueuedExtraction`),
 * and this catches the run already in flight.
 */
export async function extractDocumentText(
	documentId: string,
	handle: Db = db,
	options: { limits?: ExtractionLimits; provider?: OcrProvider } = {}
): Promise<'extracted' | 'stale' | 'unreadable' | 'missing'> {
	const [row] = await handle
		.select({
			storedName: document.storedName,
			ext: document.ext,
			contentHash: document.contentHash
		})
		.from(document)
		.where(eq(document.id, documentId))
		.limit(1);
	if (!row?.storedName) return 'missing';
	if (!isExtractable(row.ext)) return 'unreadable';

	const bytes = await readUpload(row.storedName);
	if (!bytes) return 'missing';
	// What was read, so the commit can refuse to write about a file that has
	// since been replaced. Cheap: the bytes are already in memory.
	const readName = row.storedName;
	const readHash = hashBytes(bytes);

	// Where an earlier slice stopped, so `Continue extracting` appends rather
	// than starting again with the same ordinals.
	const [previous] = await handle
		.select({ pagesExtracted: documentText.pagesExtracted })
		.from(documentText)
		.where(eq(documentText.documentId, documentId))
		.limit(1);

	const provider = options.provider ?? tesseractProvider();
	const languages = await ocrLanguages(handle);
	const run = await extractFromBytes(bytes, row.ext, {
		languages,
		limits: options.limits,
		provider,
		fromPage: previous?.pagesExtracted ?? 0
	});
	if (!run) return 'unreadable';

	let stale = false;
	await handle.transaction(async (tx) => {
		// The guard, inside the write: the file may have been replaced while the
		// pages were being read, which is exactly the window the enqueue-side
		// cancellation cannot cover. A document with no recorded hash is compared
		// on its stored name, which a replacement changes either way.
		const [current] = await tx
			.select({ storedName: document.storedName, contentHash: document.contentHash })
			.from(document)
			.where(eq(document.id, documentId))
			.limit(1);
		if (
			!current ||
			current.storedName !== readName ||
			(current.contentHash !== null && current.contentHash !== readHash)
		) {
			stale = true;
			return;
		}

		await tx
			.insert(documentText)
			.values({
				documentId,
				engine: provider.engine,
				engineVersion: provider.engineVersion,
				languages,
				meanConfidence: run.meanConfidence,
				complete: run.complete,
				pagesExtracted: run.pagesExtracted
			})
			.onConflictDoUpdate({
				target: documentText.documentId,
				set: {
					engine: provider.engine,
					engineVersion: provider.engineVersion,
					languages,
					meanConfidence: run.meanConfidence,
					complete: run.complete,
					pagesExtracted: run.pagesExtracted,
					extractedAt: new Date()
				}
			});

		if (run.chunks.length > 0) {
			await tx
				.insert(documentTextChunk)
				.values(run.chunks.map((chunk) => ({ documentId, ...chunk })))
				// A re-extraction rewrites the page it read rather than colliding
				// with the ordinal an earlier run left there.
				.onConflictDoUpdate({
					target: [documentTextChunk.documentId, documentTextChunk.ordinal],
					set: {
						text: sql`excluded.text`,
						pageNo: sql`excluded.page_no`,
						source: sql`excluded.source`
					}
				});
		}
	});
	return stale ? 'stale' : 'extracted';
}

/** Take the next slice of a file that stopped at a limit. */
export async function continueExtraction(
	documentId: string,
	handle: Db = db,
	options: { limits?: ExtractionLimits; provider?: OcrProvider } = {}
): Promise<'extracted' | 'stale' | 'unreadable' | 'missing'> {
	return extractDocumentText(documentId, handle, options);
}

/** How far a document has been read, for the inspector's copy. */
export async function extractionState(documentId: string, handle: Db = db) {
	const [row] = await handle
		.select()
		.from(documentText)
		.where(eq(documentText.documentId, documentId))
		.limit(1);
	if (!row) return null;
	const [{ last }] = await handle
		.select({ last: max(documentTextChunk.ordinal) })
		.from(documentTextChunk)
		.where(and(eq(documentTextChunk.documentId, documentId)));
	return { ...row, lastOrdinal: last };
}
