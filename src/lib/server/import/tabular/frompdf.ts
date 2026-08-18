/**
 * A PDF has no columns — only glyphs at coordinates. This recovers a table.
 *
 * Cells are clustered by their left edge across the whole page, because a
 * column IS a set of cells that start at the same place. Reading each line's
 * cells positionally instead — cell 0 is the date, cell 3 is the amount — is
 * what makes a per-bank PDF parser per-bank, and what breaks it the moment a
 * row omits an optional field and every later cell shifts left.
 *
 * Two things the real corpus forces:
 *
 *  1. **Amounts span cells.** CaixaBank prints `-1 000,00 €` and the text layer
 *     emits `-1`, `000,00`, `€` as three items. A cell-wise reader sees `-1`.
 *     Joining is required — and is itself ambiguous, because "digits, gap,
 *     three digits" also describes two adjacent columns (`300,00 377,93`).
 *     The distinguishing fact is whether the left part already has a decimal.
 *  2. **Multi-line records defeat THIS reader — but not the problem.** This one
 *     works by deciding which lines start a movement, and Raiffeisenbank's three
 *     physical lines per movement, or Česká spořitelna's two to five, give that
 *     question no usable answer: their continuation lines carry dates and
 *     figures too.
 *
 *     That was once recorded here as a structural boundary. It is not one.
 *     `rhythm.ts` assembles those layouts correctly by asking what the page's
 *     record BEAT is and never classifying a line at all, and both readers are
 *     now offered as candidates for the proof engine to choose between. Neither
 *     dominates: this one reads a 140-row statement the other fragments, and the
 *     other reads four banks this one cannot.
 */
import { isDateLike } from './determinacy';
import { looksLikeSummary } from './vocabulary';
import type { PdfLine } from '../types';
import type { Grid, RawCell } from './grid';

/**
 * How close two cells must start to share a column, in PDF points.
 *
 * Fixed, not relative to the page width. A width-relative tolerance was tried
 * so the same code could read pixel coordinates from a photograph — and it
 * broke a statement that had been reading correctly, while another started
 * working, so the count of passing files stayed the same and hid it. It was
 * never needed: the OCR reader scales its coordinates back into PDF points
 * before handing them over, so both paths speak these units.
 */
const COLUMN_TOLERANCE = 12;
/** A gap wider than this between glyph runs means separate cells, not a number. */
const JOIN_TOLERANCE = 14;

const NUMBER_START = /^-?\(?\d/;
const GROUP_TAIL = /^\d{3}(?:[.,]\d{1,2})?\)?-?$/;
const HAS_DECIMAL = /[.,]\d{1,2}$/;
const CURRENCY_ONLY = /^[€$£¥]|^[A-Z]{3}$/;

/**
 * Rejoin a number the text layer split across items.
 *
 * Only joins when the left part is a number that does NOT already carry a
 * decimal — `-1` + `000,00` is one amount, while `300,00` + `377,93` is two
 * columns. Getting this backwards fused the amount and balance columns of four
 * of five rows when it was first written.
 */
export function joinSplitNumbers(
	cells: string[],
	xs: number[],
	xEnds: number[] = [],
	/** Widest gap that can still be inside one number, in the caller's units. */
	joinLimit = JOIN_TOLERANCE * 6
): { cells: string[]; xs: number[]; xEnds: number[] } {
	const outCells: string[] = [];
	const outXs: number[] = [];
	const outEnds: number[] = [];

	for (let i = 0; i < cells.length; i++) {
		let text = cells[i];
		const x = xs[i] ?? 0;
		let end = xEnds[i] ?? x;

		while (i + 1 < cells.length) {
			const next = cells[i + 1];
			const gap = (xs[i + 1] ?? 0) - x;
			const joinable =
				NUMBER_START.test(text) &&
				!HAS_DECIMAL.test(text) &&
				GROUP_TAIL.test(next) &&
				gap < joinLimit;
			if (!joinable) break;
			text += ` ${next}`;
			i++;
			end = xEnds[i] ?? end;
		}

		// A trailing currency mark belongs to the amount beside it.
		if (i + 1 < cells.length && CURRENCY_ONLY.test(cells[i + 1]) && NUMBER_START.test(text)) {
			text += ` ${cells[i + 1]}`;
			i++;
			end = xEnds[i] ?? end;
		}

		outCells.push(text);
		outXs.push(x);
		outEnds.push(end);
	}
	return { cells: outCells, xs: outXs, xEnds: outEnds };
}

/**
 * Where a cell anchors: money to its RIGHT edge, everything else to its left.
 *
 * Statements right-align their figures, so an amount column shares an ending
 * position rather than a starting one. Anchoring money by its left edge splits
 * one column in two the moment the amounts differ in width — which they always
 * do — and the movements then read as two half-empty columns.
 */
const MONEYISH = /^-?\(?\d[\d\s.,'\u00A0]*\)?-?$/;
/** A cell holding a figure, with or without a currency mark. */
const MONEY_CELL = /\d[\d\s.,'\u00A0]*[.,]\d{2}(?!\d)|^-?\(?\d[\d\s'\u00A0]{0,12}\)?-?$/;
const anchorOf = (text: string, x: number, end: number): number =>
	MONEYISH.test(text.trim()) && end > x ? end : x;

/**
 * Column anchors shared by enough lines to be a column rather than a stray.
 *
 * Sizing this threshold from the record lines instead of the whole page was
 * tried — a statement is mostly not its table, so a page with 41 lines and 5
 * movements rejects the amount column as a stray. It read fewer statements,
 * not more, and is left here as a note rather than a change.
 *
 * Recurrence is counted over the RECORD lines, not the whole page. A statement
 * is mostly not its table: an mBank page has 41 lines and 5 movements, so the
 * amount and balance columns appear on 12% of lines and a whole-page threshold
 * rejects them as strays. Their cells then collapse into the nearest surviving
 * column — amount, balance and currency fused into one — and the table becomes
 * unreadable. Any statement with a long header and a quiet month has this
 * shape, so it is not an edge case.
 */
function findColumns(lines: { cells: string[]; xs: number[]; xEnds: number[] }[]): number[] {
	// Positions come from EVERY line, so the header's columns are represented —
	// they name the roles, and a table clustered only from its data rows leaves
	// the header landing between columns.
	//
	const tally = new Map<number, number>();
	for (const line of lines) {
		for (const [i, cell] of line.cells.entries()) {
			const anchor = anchorOf(cell, line.xs[i] ?? 0, line.xEnds[i] ?? 0);
			const key = Math.round(anchor / COLUMN_TOLERANCE) * COLUMN_TOLERANCE;
			tally.set(key, (tally.get(key) ?? 0) + 1);
		}
	}
	// A column must recur: a one-off indent is a wrapped description, not a field.
	const minimum = Math.max(2, Math.floor(lines.length * 0.15));
	return [...tally.entries()]
		.filter(([, count]) => count >= minimum)
		.map(([x]) => x)
		.sort((a, b) => a - b);
}

/**
 * Which column a cell belongs to: nearest anchor wins.
 *
 * Span-overlap assignment was tried instead, so that a left-aligned header and
 * its right-aligned figures would both land in the same column. It read fewer
 * statements, not more — a wide description cell overlaps several columns and
 * claims the wrong one. Nearest-anchor is cruder and measures better.
 */
const columnOf = (x: number, columns: number[]): number => {
	let best = 0;
	let distance = Infinity;
	for (const [index, column] of columns.entries()) {
		const d = Math.abs(x - column);
		if (d < distance) {
			distance = d;
			best = index;
		}
	}
	return best;
};

/**
 * Assemble physical lines into records.
 *
 * A statement does not print one movement per line. Raiffeisenbank uses three,
 * Česká spořitelna two to five, Komerční banka five — the amount sits on the
 * first line and the counter-account, symbols, exchange rate and reference
 * follow underneath. Treating each printed line as a row fragments the table
 * into pieces no region can hold, which is what kept four banks unreadable.
 *
 * The question is only ever "does this line START a movement", and two obvious
 * answers both fail on real statements:
 *
 *  - "it carries a date" — Komerční banka's continuation lines carry their own
 *    dates, and Raiffeisenbank's carry the valuta.
 *  - "it carries a date and a figure" — those same continuations repeat the
 *    amount (`zúčt. částka: 89,80 CZK`) and quote a constant symbol.
 *
 * What separates them is WHERE the figure sits. A statement right-aligns its
 * amount column, so every movement's amount ends at the same x; a figure quoted
 * inside a continuation does not. So the amount column is found first — as the
 * commonest right edge among money cells — and a line starts a movement when it
 * has a figure ending there.
 *
 * The vertical guard remains as a backstop: a line far below the last movement
 * is page furniture, not a continuation, which is what stopped a multi-page
 * statement absorbing each page's header into the movement above it.
 */
export function assembleRecords(
	lines: { cells: string[]; xs: number[]; xEnds: number[]; y: number }[],
	/**
	 * Which right-edge cluster holds the amounts. Undefined means "assume every
	 * dated line with a figure starts a movement", which is right for
	 * one-line-per-movement layouts.
	 */
	amountColumn?: number
): { cells: string[]; xs: number[]; xEnds: number[]; y: number }[] {
	if (lines.length === 0) return [];

	const startsMovement = (line: { cells: string[]; xs: number[]; xEnds: number[] }): boolean => {
		if (amountColumn === undefined) {
			return line.cells.some((c) => isDateLike(c)) && line.cells.some((c) => MONEY_CELL.test(c));
		}
		return line.cells.some(
			(cell, i) =>
				MONEY_CELL.test(cell) &&
				Math.round((line.xEnds[i] ?? line.xs[i] ?? 0) / COLUMN_TOLERANCE) === amountColumn
		);
	};

	// The page's own line pitch, so no vertical constant needs guessing.
	const gaps: number[] = [];
	for (let i = 1; i < lines.length; i++) {
		const gap = Math.abs(lines[i - 1].y - lines[i].y);
		if (gap > 0) gaps.push(gap);
	}
	gaps.sort((a, b) => a - b);
	const pitch = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 12;

	const records: typeof lines = [];
	for (const line of lines) {
		const previous = records[records.length - 1];
		const continues =
			previous !== undefined &&
			!startsMovement(line) &&
			startsMovement(previous) &&
			Math.abs(previous.y - line.y) <= pitch * 3 &&
			!looksLikeSummary(line.cells.join(' '));

		if (continues) {
			previous.cells.push(...line.cells);
			previous.xs.push(...line.xs);
			previous.xEnds.push(...line.xEnds);
			// The window measures the gap to the line just absorbed, not to the
			// one that opened the record. Leaving `y` at the record's start capped
			// every record at three pitches from its first line however many lines
			// it actually had — so a movement printed over four or five of them,
			// which is ordinary for the banks that keep hand-written parsers, lost
			// its tail to a record of its own.
			previous.y = line.y;
			continue;
		}
		records.push({
			cells: [...line.cells],
			xs: [...line.xs],
			xEnds: [...line.xEnds],
			y: line.y
		});
	}
	return records;
}

/**
 * The right-edge clusters money lands in, commonest first.
 *
 * Each is a hypothesis about which column holds the amounts. Choosing between
 * them by frequency alone picks the balance column as often as the amount one,
 * so they are not chosen here at all — every one becomes a candidate reading
 * and the arithmetic decides, exactly as it does for date order and decimal
 * mark. Heuristics propose; arithmetic disposes.
 */
function amountColumnHypotheses(
	lines: { cells: string[]; xs: number[]; xEnds: number[] }[]
): (number | undefined)[] {
	const endings = new Map<number, number>();
	for (const line of lines) {
		for (const [i, cell] of line.cells.entries()) {
			if (!MONEY_CELL.test(cell)) continue;
			const key = Math.round((line.xEnds[i] ?? line.xs[i] ?? 0) / COLUMN_TOLERANCE);
			endings.set(key, (endings.get(key) ?? 0) + 1);
		}
	}
	const ranked = [...endings.entries()]
		.filter(([, count]) => count >= 2)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 3)
		.map(([key]) => key);
	// `undefined` first: most statements print one line per movement, and that
	// reading should not be displaced by a speculative one.
	return [undefined, ...ranked];
}

/**
 * Turn a page's line model into a grid the tabular engine can read.
 *
 * Pages are kept separate: a statement's columns can shift between pages, and
 * clustering across a shift produces a grid where no column means one thing.
 */
export function gridsFromPdfLines(lines: PdfLine[]): Grid[] {
	const byPage = new Map<number, PdfLine[]>();
	for (const line of lines) {
		if (!byPage.has(line.page)) byPage.set(line.page, []);
		byPage.get(line.page)!.push(line);
	}

	/** A page's grid plus the column positions it was built from. */
	const grids: { grid: Grid; columns: number[]; hypothesis: number | undefined }[] = [];
	for (const [, pageLines] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
		const withXs = pageLines.map((line) => ({
			cells: line.cells,
			xs: line.xs ?? line.cells.map((_, i) => i * 50),
			xEnds: line.xEnds ?? [],
			y: line.y
		}));
		for (const hypothesis of amountColumnHypotheses(withXs)) {
			const records = assembleRecords(withXs, hypothesis);
			const joined = records.map((line) => joinSplitNumbers(line.cells, line.xs, line.xEnds));
			const columns = findColumns(joined);
			if (columns.length < 3) continue;

			const rows: RawCell[][] = joined.map((line) => {
				const row: RawCell[] = Array.from({ length: columns.length }, () => ({ text: '' }));
				for (const [i, text] of line.cells.entries()) {
					const index = columnOf(anchorOf(text, line.xs[i] ?? 0, line.xEnds[i] ?? 0), columns);
					// Two runs landing in one column are one value split by styling.
					row[index] = { text: row[index].text ? `${row[index].text} ${text}` : text };
				}
				return row;
			});
			grids.push({
				// Columns are carried alongside so consecutive pages of one statement
				// can be recognised as the same table and joined.
				grid: { source: 'delimited', origin: 'pdf-geometry', rows },
				columns,
				hypothesis
			});
		}
	}
	// One set of joined pages per hypothesis: a statement must be assembled the
	// same way on every page.
	const byHypothesis = new Map<string, { grid: Grid; columns: number[] }[]>();
	for (const entry of grids) {
		const key = String(entry.hypothesis);
		if (!byHypothesis.has(key)) byHypothesis.set(key, []);
		byHypothesis.get(key)!.push(entry);
	}
	return [...byHypothesis.values()].flatMap((pages) => joinContinuedPages(pages));
}

/**
 * Join pages that are the same table continued.
 *
 * A statement runs across pages and its movements do not restart on each one.
 * Reading pages separately and keeping the best of them imported 20 movements
 * from an eight-page statement — and because that statement prints no opening
 * balance, the 20 formed a perfectly closing chain and would have been filed as
 * complete. A partial import that proves itself is the worst outcome this
 * system can produce.
 *
 * Pages join when they have the same number of columns in the same places. A
 * page whose columns differ is a different table and stays separate.
 */
/**
 * Drop the header a continued page repeats before its table resumes.
 *
 * Only the leading run, and only up to a few rows: anything further in is part
 * of the table itself.
 */
function dropLeadingFurniture(rows: RawCell[][]): RawCell[][] {
	let start = 0;
	while (start < rows.length && start < 6) {
		const cells = rows[start].map((c) => c.text);
		const isRecord = cells.some((c) => isDateLike(c)) && cells.some((c) => MONEY_CELL.test(c));
		if (isRecord) break;
		start++;
	}
	return rows.slice(start);
}

function joinContinuedPages(pages: { grid: Grid; columns: number[] }[]): Grid[] {
	const joined: { grid: Grid; columns: number[] }[] = [];
	for (const page of pages) {
		const previous = joined[joined.length - 1];
		const sameShape =
			previous &&
			previous.columns.length === page.columns.length &&
			previous.columns.every((x, i) => Math.abs(x - page.columns[i]) <= COLUMN_TOLERANCE);
		if (sameShape) {
			// A continued page repeats its header and address block before the
			// table resumes. Appending those verbatim leaves non-record rows
			// stranded mid-table, and region detection — which breaks on a change
			// of width — then cuts one statement into one region per page.
			previous.grid.rows.push(...dropLeadingFurniture(page.grid.rows));
			continue;
		}
		joined.push({ grid: { ...page.grid, rows: [...page.grid.rows] }, columns: page.columns });
	}
	return joined.map((p) => p.grid);
}
