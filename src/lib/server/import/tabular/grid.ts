/**
 * A file's cells, losslessly.
 *
 * The first representation is a grid of TEXT, never typed values. This is the
 * single most important rule in the tabular path, and it is not theoretical:
 * SheetJS turns `000123` into `123` and a 26-digit Polish NRB into a float, and
 * once the leading zeros are gone nothing later can restore them. The fields
 * that suffer are exactly the ones the ledger matches on — counter-account,
 * bank reference, variable symbol.
 *
 * So: keep what was displayed, keep what the library thought separately, and
 * let a later stage decide what anything means.
 */
import iconv from 'iconv-lite';
import * as XLSX from 'xlsx';
import { splitCsvLine } from '../csv';

/** Encodings real exports from our sampled banks actually use. */
const ENCODINGS = ['utf-8', 'win1250', 'win1252', 'iso-8859-2'] as const;
const DELIMITERS = [';', ',', '\t', '|'] as const;

export interface RawCell {
	/** What the file displays. Authoritative for every identifier-like field. */
	text: string;
	/** What the spreadsheet library made of it, kept only as a hint. */
	typed?: string | number | boolean | null;
	/** The cell's number format, where the source has one. */
	numberFormat?: string;
}

export interface Grid {
	source: 'delimited' | 'xlsx';
	/** Sheet name, for workbooks. */
	sheet?: string;
	encoding?: string;
	delimiter?: string;
	rows: RawCell[][];
}

const cell = (text: string): RawCell => ({ text: text.trim() });

export interface DecodeCandidate {
	encoding: string;
	text: string;
	replacements: number;
	diacritics: number;
}

/**
 * Decode under each candidate encoding and rank them. Fewer replacement
 * characters wins; ties break toward the decoding that produced more of the
 * diacritics Czech, Polish, German and Spanish statements genuinely contain —
 * a mojibake decode has none.
 */
export function decodeCandidates(buffer: Uint8Array): DecodeCandidate[] {
	return ENCODINGS.map((encoding) => {
		const text =
			encoding === 'utf-8'
				? new TextDecoder('utf-8', { fatal: false }).decode(buffer)
				: iconv.decode(Buffer.from(buffer), encoding);
		return {
			encoding,
			text: text.replace(/^\uFEFF/, ''),
			replacements: (text.match(/�/g) ?? []).length,
			diacritics: (text.match(/[ěščřžýáíéúůňťďóąćęłńśźżöüäßñ]/gi) ?? []).length
		};
	}).sort((a, b) => a.replacements - b.replacements || b.diacritics - a.diacritics);
}

export interface DelimiterCandidate {
	delimiter: string;
	/** The most common column count among rows that actually split. */
	columns: number;
	/** How many rows have that count. */
	rows: number;
}

/**
 * Rank delimiters by how many rows share a stable column count.
 *
 * Single-column rows are NOT evidence against a delimiter — they are the
 * statement's preamble, and Fio prints eight of them before its header while
 * mBank prints thirty. Counting them as the dominant shape hides the real
 * table completely, which is exactly what happened on the first run of the
 * exploratory probe.
 */
export function delimiterCandidates(lines: string[]): DelimiterCandidate[] {
	return DELIMITERS.map((delimiter) => {
		const counts = lines.map((line) => splitCsvLine(line, delimiter).length).filter((n) => n > 1);
		const tally = new Map<number, number>();
		for (const count of counts) tally.set(count, (tally.get(count) ?? 0) + 1);
		const [columns, rows] = [...tally.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0] ?? [
			0, 0
		];
		return { delimiter, columns, rows };
	})
		.filter((c) => c.columns > 1 && c.rows >= 2)
		.sort((a, b) => b.rows - a.rows || b.columns - a.columns);
}

/** Build a grid from already-decoded text under one delimiter. */
export function gridFromText(text: string, delimiter: string, encoding?: string): Grid {
	const rows = text
		.split(/\r?\n/)
		.map((line) => splitCsvLine(line, delimiter).map((c) => cell(c.replace(/^"|"$/g, ''))));
	// Trailing blank lines are file punctuation, not rows.
	while (rows.length > 0 && rows[rows.length - 1].every((c) => !c.text)) rows.pop();
	return { source: 'delimited', encoding, delimiter, rows };
}

/**
 * Every plausible reading of a delimited file: the best encodings crossed with
 * the plausible delimiters. Later stages choose between them on evidence, so
 * this deliberately does not guess.
 */
export function candidateGrids(buffer: Uint8Array): Grid[] {
	const encodings = decodeCandidates(buffer).slice(0, 2);
	const grids: Grid[] = [];
	for (const candidate of encodings) {
		const lines = candidate.text.split(/\r?\n/);
		for (const delimiter of delimiterCandidates(lines).slice(0, 3)) {
			grids.push(gridFromText(candidate.text, delimiter.delimiter, candidate.encoding));
		}
	}
	return grids;
}

/**
 * One grid per worksheet, read as displayed text.
 *
 * `raw: false` asks SheetJS for the FORMATTED value — what the user sees —
 * rather than its own coercion, which is the whole point. The typed value is
 * kept alongside as a hint for later stages that want it.
 */
export function gridsFromWorkbook(buffer: Uint8Array): Grid[] {
	const workbook = XLSX.read(buffer, {
		type: 'array',
		cellDates: false,
		cellNF: true,
		cellText: true,
		sheetStubs: true,
		// Formulas are never recalculated and macros never run: an uploaded
		// workbook is untrusted input, not a program we agreed to execute.
		bookVBA: false
	});

	return workbook.SheetNames.map((sheet) => {
		const worksheet = workbook.Sheets[sheet];
		const displayed = XLSX.utils.sheet_to_json<string[]>(worksheet, {
			header: 1,
			raw: false,
			defval: '',
			blankrows: true
		});
		const typed = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
			header: 1,
			raw: true,
			defval: '',
			blankrows: true
		});

		const rows: RawCell[][] = displayed.map((row, r) =>
			row.map((text, c) => {
				const raw = typed[r]?.[c];
				const address = XLSX.utils.encode_cell({ r, c });
				const meta = worksheet[address] as { z?: string } | undefined;
				return {
					text: String(text ?? '').trim(),
					typed: raw as string | number | boolean | null,
					numberFormat: meta?.z
				};
			})
		);
		return { source: 'xlsx' as const, sheet, rows };
	});
}

/** Fields whose displayed text is authoritative — never the typed value. */
export const IDENTIFIER_ROLES = new Set([
	'counterpartyAccount',
	'reference',
	'variableSymbol',
	'constantSymbol',
	'specificSymbol'
]);
