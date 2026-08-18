/**
 * How a transaction came to be in the ledger, said in words.
 *
 * The reader records a method per row because its readings are not equally
 * strong. A CAMT.053 export states its own structure and leaves nothing to
 * infer; a table recovered from the coordinates of glyphs on a page, or from
 * pixels, or from fields that had to be rejoined before they made sense, was
 * worked out — and every one of those was proved against the statement's own
 * balances before it was filed, but they are still worth being able to look at.
 *
 * Kept here rather than in a component so the register and any later evidence
 * panel name the same thing the same way.
 */
export const SOURCE_LABELS: Record<string, string> = {
	adapter: 'bank format',
	standard: 'published format',
	delimited: 'spreadsheet text',
	'delimited-rejoined': 'spreadsheet text, fields rejoined',
	workbook: 'spreadsheet',
	'pdf-geometry': 'PDF layout',
	'pdf-rhythm': 'PDF layout, by record rhythm',
	ocr: 'read from the page image'
};

/** What each proof class means to someone who did not write the engine. */
export const PROOF_LABELS: Record<string, string> = {
	P4: 'balances, totals and count all agree',
	P3: 'every movement sits on a running balance that closes',
	P2: 'opening and closing balances agree with the movements',
	P1: 'opening and closing balances agree',
	P0: 'nothing in the statement could be checked'
};

export const sourceLabel = (method: string | null): string | null =>
	method ? (SOURCE_LABELS[method] ?? method) : null;

/**
 * Readings worth a second look.
 *
 * Not "unreliable" — nothing reaches the ledger without proving itself. These
 * are the ones where the STRUCTURE was inferred rather than declared, so if a
 * figure ever looks wrong, this is where to start.
 */
export const INFERRED_SOURCES = [
	'pdf-geometry',
	'pdf-rhythm',
	'delimited-rejoined',
	'ocr'
] as const;
