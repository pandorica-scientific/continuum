// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/**
 * How much work one extraction run may do.
 *
 * The single CPU worker is shared with statement imports, so a 600-page manual
 * cannot be allowed to hold it for an afternoon. It is read in slices instead,
 * and hitting a limit is RECORDED rather than silent: `complete=false` with
 * `pagesExtracted` is what lets the inspector say "Pages 1–100 are searchable"
 * and offer to continue, instead of quietly indexing a sixth of the file and
 * looking finished.
 *
 * Values are defaults, not constants: every one of them is a property of the
 * box this runs on rather than of the format, so they are overridable per call
 * and settable per household later without anything here changing shape.
 */
export interface ExtractionLimits {
	/** Beyond this, nothing is read at all — recorded, not attempted. */
	maxFileBytes: number;
	/** Longest edge of a rasterised page, in pixels, before it is scaled down. */
	maxPageDim: number;
	/** Pages OCR'd in one automatic run. The rest wait for the next slice. */
	maxOcrPagesPerRun: number;
	/** Bytes of a plain-text file read in one run. */
	maxPlainBytes: number;
}

export const DEFAULT_LIMITS: ExtractionLimits = {
	// A 100 MB scan is a scanner set to the wrong thing, not a document.
	maxFileBytes: 100 * 1024 * 1024,
	// 300 DPI on A4 is ~3500px on the long edge; this leaves room for A3.
	maxPageDim: 5000,
	// Roughly ten minutes of the worker at a second or two a page.
	maxOcrPagesPerRun: 100,
	maxPlainBytes: 5 * 1024 * 1024
};

/**
 * Longest slice of plain text that may become one chunk.
 *
 * PostgreSQL refuses a `tsvector` over about 1 MB, and a chunk is what the
 * index is built on — so the wall applies to a large CSV exactly as it does to
 * an OCR run. 100 KB leaves generous room for the expansion folding and
 * tokenising add.
 */
export const MAX_CHUNK_BYTES = 100_000;
