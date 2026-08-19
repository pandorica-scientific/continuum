// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
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
import { csvLines, splitCsvLine } from '../csv';
import { MAX_CELLS_PER_SHEET, MAX_SHEETS } from '../safety';

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
	/**
	 * Which reader assembled this grid, carried through to the ledger so a row
	 * can say how it was read. A PDF yields grids from two assemblers that work
	 * in entirely different ways, and which one won is worth knowing.
	 */
	origin?: string;
	/** Sheet name, for workbooks. */
	sheet?: string;
	encoding?: string;
	delimiter?: string;
	rows: RawCell[][];
}

const cell = (text: string): RawCell => ({ text: text.trim() });

interface DecodeCandidate {
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

interface DelimiterCandidate {
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

/**
 * Build a grid from already-decoded text under one delimiter.
 *
 * Records, not lines. A newline inside a quoted field belongs to the field —
 * a wrapped payment note, a two-line merchant address — and splitting the text
 * on every newline before parsing quotes cuts one movement into two rows that
 * neither carry a date nor an amount between them. `csvLines` has always known
 * this and the five adapters have always used it; the generic reader did not,
 * so every statement with a wrapped description fragmented, recovered a
 * fraction of its rows, and was refused for failing to reconcile. That is 60
 * files in the synthetic corpus, and their transactions were never anywhere
 * near the ledger.
 */
export function gridFromText(text: string, delimiter: string, encoding?: string): Grid {
	const rows = csvLines(text).map((line) =>
		splitCsvLine(line, delimiter).map((c) => cell(c.replace(/^"|"$/g, '')))
	);
	// Trailing blank lines are file punctuation, not rows.
	while (rows.length > 0 && rows[rows.length - 1].every((c) => !c.text)) rows.pop();
	return { source: 'delimited', origin: 'delimited', encoding, delimiter, rows };
}

/**
 * Every plausible reading of a delimited file: the best encodings crossed with
 * the plausible delimiters. Later stages choose between them on evidence, so
 * this deliberately does not guess.
 */
/**
 * A reading in which fields that look like one split number are rejoined.
 *
 * Delimited files are not always well formed. When the delimiter and the
 * decimal mark are the same character, `799,56` is indistinguishable from two
 * fields `799` and `56` by any reader that only looks at the text — and an
 * unquoted comma inside a description does the same thing for a different
 * reason.
 *
 * Only looking at the text is the mistake. The statement states its own
 * balances, so whether a particular set of joins was the right one is a
 * question the ARITHMETIC can answer, and that is the instrument used
 * everywhere else here: this is offered as an extra CANDIDATE beside the
 * unrepaired reading, and it survives only if it proves itself. A wrong join
 * produces a chain that does not close, and the proof gate refuses it exactly
 * as it refuses any other misreading.
 *
 * Nothing here tries to work out how many joins are needed. Guessing the
 * table's width from the rows is circular — on a file where every movement row
 * has split, the split rows ARE the majority, and the width they agree on is
 * the broken one. So every pair that could be a split number is joined, and the
 * balances decide whether that was right.
 *
 * One limit is worth knowing, because it decides when this can be settled at
 * all: dropping the cents from an amount AND from the balance beside it leaves
 * a chain that still closes. `6127 - 425 = 5702` exactly as
 * `6127.92 - 425.23 = 5702.69` does. What separates the two readings is a
 * BORROW across the decimal point — `6127.92 - 425.99 = 5701.93`, where the
 * truncated figures give 5702 and the broken chain breaks. Over a real
 * statement that occurs within the first few movements, which is why the
 * repaired reading wins on proof class there. Over a handful of rows that
 * happen not to borrow, both readings prove themselves, and the reading is
 * refused as genuinely undecided rather than guessed at.
 */
const SPLIT_LEFT = /^[-+(]?\s*\d[\d\s.'\u00A0]*$/;
/**
 * The right half of a split amount: the fractional digits alone.
 *
 * Exactly two, because that is what a comma-decimal currency prints and what
 * makes this ambiguity arise at all. Allowing a longer run would let two
 * genuinely separate numeric columns — a reference beside an amount — be welded
 * into one number that happens to parse.
 */
const SPLIT_RIGHT = /^\d{2}\)?-?$/;

function rejoinSplitNumbers(fields: string[]): string[] | null {
	const out: string[] = [];
	let joined = false;
	for (const field of fields) {
		const open = out[out.length - 1];
		if (open !== undefined && SPLIT_LEFT.test(open) && SPLIT_RIGHT.test(field.trim())) {
			out[out.length - 1] = `${open.trim()},${field.trim()}`;
			joined = true;
			continue;
		}
		out.push(field);
	}
	return joined ? out : null;
}

/** The rejoined reading of a delimited grid, when there is anything to rejoin. */
export function repairedGrids(grid: Grid): Grid[] {
	let changed = false;
	const rows: RawCell[][] = grid.rows.map((row) => {
		const rejoined = rejoinSplitNumbers(row.map((entry) => entry.text));
		if (!rejoined) return row;
		changed = true;
		return rejoined.map((text) => cell(text));
	});
	if (!changed) return [];
	return [{ ...grid, origin: `${grid.origin ?? 'delimited'}-rejoined`, rows }];
}

export function candidateGrids(buffer: Uint8Array): Grid[] {
	const encodings = decodeCandidates(buffer).slice(0, 2);
	const grids: Grid[] = [];
	for (const candidate of encodings) {
		const lines = csvLines(candidate.text);
		for (const delimiter of delimiterCandidates(lines).slice(0, 3)) {
			const grid = gridFromText(candidate.text, delimiter.delimiter, candidate.encoding);
			grids.push(grid, ...repairedGrids(grid));
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
/**
 * A label written once across several columns still names all of them.
 *
 * A spreadsheet merges cells to write one heading over a group — `Amount` above
 * a pair of `Debit` and `Credit` columns, or an account name spanning a block.
 * The file stores that value in the top-left cell only and leaves the rest
 * empty, so the row arrives as a label followed by blanks: the header detector
 * counts one named column where the sheet shows several, and every column but
 * the first loses its name.
 *
 * Only HORIZONTAL merges are spread, and that restriction is the whole safety
 * of this. A merge across columns is a label written wide; a merge DOWN rows is
 * one value that applies to a group of rows, and copying it into each of them
 * would manufacture data — a date repeated onto movements that never carried
 * one, which the reader would then happily file.
 */
function spreadMergedHeaders(worksheet: XLSX.WorkSheet, rows: string[][]): void {
	const merges = worksheet['!merges'];
	if (!merges) return;
	for (const range of merges) {
		if (range.s.r !== range.e.r) continue;
		const row = rows[range.s.r];
		const value = row?.[range.s.c];
		if (!row || !value) continue;
		for (let column = range.s.c + 1; column <= range.e.c; column++) {
			// Never over a value the sheet actually holds.
			if (!row[column]) row[column] = value;
		}
	}
}

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

	if (workbook.SheetNames.length > MAX_SHEETS) {
		throw new Error(
			`That workbook has ${workbook.SheetNames.length} sheets; the limit is ${MAX_SHEETS}. It has not been read.`
		);
	}

	return workbook.SheetNames.map((sheet) => {
		const worksheet = workbook.Sheets[sheet];
		// The declared extent, before any of it is turned into values. A sheet
		// whose range says a million rows costs a million rows of memory the
		// moment it is enumerated, however few of them hold anything.
		if (worksheet['!ref']) {
			const range = XLSX.utils.decode_range(worksheet['!ref']);
			const cells = (range.e.r - range.s.r + 1) * (range.e.c - range.s.c + 1);
			if (cells > MAX_CELLS_PER_SHEET) {
				throw new Error(
					`Sheet "${sheet}" declares ${cells.toLocaleString('en')} cells; the limit is ${MAX_CELLS_PER_SHEET.toLocaleString('en')}. It has not been read.`
				);
			}
		}
		const displayed = XLSX.utils.sheet_to_json<string[]>(worksheet, {
			header: 1,
			raw: false,
			defval: '',
			blankrows: true
		});
		spreadMergedHeaders(worksheet, displayed);
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
		return { source: 'xlsx' as const, origin: 'workbook', sheet, rows };
	});
}
