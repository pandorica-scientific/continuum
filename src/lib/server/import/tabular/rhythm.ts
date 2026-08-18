/**
 * Record assembly by RHYTHM, for statements that print one movement across
 * several physical lines.
 *
 * The assembler in `frompdf.ts` reads a table by asking of each line "does this
 * one start a movement?" — and every available answer is a property of the line
 * itself: it carries a date, it carries a figure, its figure ends where the
 * amount column ends. Komerční banka's continuation lines have all three, so
 * the question has no good answer, and four banks in the sample set were
 * recorded as a permanent limitation on that basis.
 *
 * They are not. This module asks a different question — "what is the page's
 * record BEAT?" — and never classifies a line at all:
 *
 * 1. Cells cluster into columns: left edge for text, right edge for figures,
 *    because a statement right-aligns its money so an amount column shares an
 *    ending rather than a beginning.
 * 2. Within one column, cells OF ONE TYPE recurring at REGULAR spacing are a
 *    run — a hypothesis that the table beats there. Type purity separates a
 *    date column from an address block starting at the same x; regularity cuts
 *    the run at the table's edge without knowing a word of any language.
 * 3. A run's cells are anchors, and content hangs BELOW its anchor. Every other
 *    cell falls into the band it lies in: descriptions, value dates, exchange
 *    rates, references, original amounts. Nothing is classified.
 * 4. A hypothesis is VALID when the table it implies has a money column with
 *    exactly one figure per record and a date column with a date in nearly
 *    every record. That is what tells a real rhythm from a coincidence.
 * 5. Among valid hypotheses the one accounting for the most cells wins, and the
 *    winning column is then fixed for the whole document.
 *
 * This does not replace `frompdf.ts`; it stands beside it. Both produce
 * candidate readings and the proof engine chooses, exactly as it chooses
 * between decodings and delimiters — because neither assembler dominates. On
 * one Raiffeisenbank statement this one yields 44 movements where the adapter
 * yields 43, and the 43 are the ones that reconcile.
 *
 * Two shapes it does not handle, both measured and both understood: a bank that
 * right-aligns a foreign-currency original to the SAME edge as the ledger
 * amount beats twice per movement; and a page printing several tables with
 * identical columns keeps only the largest, because one rhythm is assumed per
 * document.
 */
import { isDateLike } from './determinacy';
import { looksLikeSummary } from './vocabulary';
import type { Grid, RawCell } from './grid';
import type { PdfLine } from '../types';

export type Cell = {
	text: string;
	x: number;
	xEnd: number;
	y: number;
	page: number;
	kind: Kind;
	left: number;
	right: number;
};

export type Kind = 'date' | 'money' | 'int' | 'text';

/** A figure: a group-separated number with two decimals, or a bare integer. */
const MONEY = /\d[\d\s.,'\u00A0]*[.,]\d{2}(?!\d)|^-?\(?\d[\d\s'\u00A0]{0,12}\)?-?$/;
const INT = /^-?\d+$/;
/**
 * A figure has a decimal tail or a group separator. A bare run of digits does
 * not: Raiffeisenbank prints a ten-digit transaction reference in its own
 * column, and read as money it becomes the most regular "amount column" on the
 * page — every record has exactly one, so it passes every structural test.
 */
const DECIMAL_TAIL = /[.,]\d{2}(?!\d)/;
const GROUPED = /\d[\s'\u00A0]\d{3}(?!\d)/;
/** A cell that is ONLY a figure, so it can anchor to its right edge. */
const BARE_MONEY =
	/^[-+(]?\s?\d[\d\s.,'\u00A0]*\)?\s?[-+]?\s?(?:[€$£¥]|[A-Z]{3})?$|^(?:[€$£¥]|[A-Z]{3})?\s?-?\d[\d\s.,'\u00A0]*$/;

/**
 * A date, with its components in range.
 *
 * The shared `isDateLike` has no range check, and on a dot-decimal statement
 * that is not cosmetic: `88.40` and `1.83` both parse as dates, so a UK
 * statement's "Paid out" column reads as a column of dates and the amount
 * column cannot be found at all. Both orders are allowed because the order is
 * not known yet — that is settled later, from the column as a whole.
 */

export const kindOf = (text: string): Kind => {
	const t = text.trim();
	if (isDateLike(t)) return 'date';
	if (BARE_MONEY.test(t) && MONEY.test(t) && (DECIMAL_TAIL.test(t) || GROUPED.test(t)))
		return 'money';
	if (INT.test(t)) return 'int';
	return 'text';
};

/**
 * One-dimensional clustering by chaining, with a width cap.
 *
 * Right edges of one amount column agree to a point or two; a bucket boundary
 * that happens to fall between them splits the column, so chaining is used
 * instead. The cap stops a dense page from chaining a whole margin together.
 */
function cluster(values: number[], tol: number): number[] {
	const sorted = [...values].sort((a, b) => a - b);
	const centres: number[] = [];
	let start = -Infinity;
	let previous = -Infinity;
	let members: number[] = [];
	const flush = () => {
		if (members.length) centres.push(members.reduce((a, b) => a + b, 0) / members.length);
		members = [];
	};
	for (const v of sorted) {
		if (v - previous > tol || v - start > 4 * tol) {
			flush();
			start = v;
		}
		members.push(v);
		previous = v;
	}
	flush();
	return centres;
}

const nearest = (v: number, centres: number[]): number => {
	let best = centres[0] ?? 0;
	for (const c of centres) if (Math.abs(c - v) < Math.abs(best - v)) best = c;
	return best;
};

const COLUMN_TOLERANCE = 6;

export function cellsOf(
	lines: { page: number; y: number; cells: string[]; xs?: number[]; xEnds?: number[] }[]
): Cell[] {
	const raw = lines.flatMap((line) =>
		line.cells.map((text, i) => ({
			text,
			x: line.xs?.[i] ?? 0,
			xEnd: line.xEnds?.[i] ?? line.xs?.[i] ?? 0,
			y: line.y,
			page: line.page,
			kind: kindOf(text)
		}))
	);
	const lefts = cluster(
		raw.map((c) => c.x),
		COLUMN_TOLERANCE
	);
	const rights = cluster(
		raw.map((c) => c.xEnd),
		COLUMN_TOLERANCE
	);
	return raw.map((c) => ({
		...c,
		left: nearest(c.x, lefts),
		right: nearest(c.xEnd, rights)
	}));
}

/** A regular, type-pure recurrence inside one column: the table's beat. */
export type Run = {
	label: string;
	anchors: number[];
};

const MIN_RUN = 3;
/** A jump this many times the run's own median spacing ends the run. */
const SPLIT_FACTOR = 2.5;

function runsFrom(label: string, ys: number[]): Run[] {
	const distinct = [...new Set(ys)].sort((a, b) => b - a);
	if (distinct.length < MIN_RUN) return [];
	const gaps: number[] = [];
	for (let i = 1; i < distinct.length; i++) gaps.push(distinct[i - 1] - distinct[i]);
	const sortedGaps = [...gaps].sort((a, b) => a - b);
	const median = sortedGaps[Math.floor(sortedGaps.length / 2)];
	const limit = Math.max(median * SPLIT_FACTOR, median + 8);

	const runs: Run[] = [];
	let current: number[] = [distinct[0]];
	for (let i = 1; i < distinct.length; i++) {
		if (distinct[i - 1] - distinct[i] > limit) {
			if (current.length >= MIN_RUN) runs.push({ label, anchors: current });
			current = [];
		}
		current.push(distinct[i]);
	}
	if (current.length >= MIN_RUN) runs.push({ label, anchors: current });
	return runs;
}

/**
 * Which column a cell belongs to, for the purpose of finding a beat.
 *
 * Figures anchor to their right edge and everything else to its left: a
 * statement right-aligns its money, so an amount column shares an ending rather
 * than a beginning.
 */
const labelOf = (cell: Cell): string =>
	cell.kind === 'money'
		? `R${cell.right.toFixed(0)}:money`
		: `L${cell.left.toFixed(0)}:${cell.kind}`;

export function hypotheses(cells: Cell[]): Run[] {
	const byColumn = new Map<string, number[]>();
	for (const c of cells) {
		const key = labelOf(c);
		if (!byColumn.has(key)) byColumn.set(key, []);
		byColumn.get(key)!.push(c.y);
	}
	return [...byColumn.entries()].flatMap(([label, ys]) => runsFrom(label, ys));
}

/** Every line the named column occupies, however few — no rhythm required. */
const anchorsFor = (label: string, cells: Cell[]): number[] =>
	[...new Set(cells.filter((cell) => labelOf(cell) === label).map((cell) => cell.y))].sort(
		(a, b) => b - a
	);

export type Band = { top: number; bottom: number; cells: Cell[] };

/**
 * Bands from anchors: content hangs BELOW the line that opens it.
 *
 * Splitting at the midpoint between anchors was the first rule tried, and it is
 * wrong wherever records differ in height: an mBank movement with four detail
 * lines has half of them fall past the midpoint into the movement below. A
 * record owns everything from its anchor down to the next one.
 *
 * A layout that centres its rows vertically — Nickel prints the row number
 * beside the MIDDLE of a wrapped description — is not handled by moving the
 * boundary but by choosing a different anchor column: its amount column sits at
 * the top of each row, and the same downward rule then reads it correctly. The
 * hypothesis whose anchors sit at the top of the row is the one that survives
 * validation, so no per-layout switch is needed.
 */
export function bandsOf(anchors: number[], cells: Cell[]): Band[] {
	const bands: Band[] = [];
	for (let i = 0; i < anchors.length; i++) {
		const top = anchors[i];
		const bottom = i + 1 < anchors.length ? anchors[i + 1] : -Infinity;
		bands.push({ top, bottom, cells: [] });
	}
	// The last band has no next anchor to stop it: it runs down while the page's
	// own line pitch continues, and stops at the first jump wider than any gap
	// inside the bands above. That is what keeps a closing-balance line out.
	const lineYs = [...new Set(cells.map((c) => c.y))].sort((a, b) => b - a);
	let intra = 0;
	for (let i = 0; i + 1 < anchors.length; i++) {
		const inside = lineYs.filter((y) => y <= anchors[i] && y > anchors[i + 1]);
		for (let j = 1; j < inside.length; j++) intra = Math.max(intra, inside[j - 1] - inside[j]);
	}
	let floor = anchors[anchors.length - 1];
	for (const y of lineYs.filter((v) => v < floor)) {
		if (floor - y > intra + 0.5) break;
		floor = y;
	}
	bands[bands.length - 1].bottom = floor - 0.5;

	for (const cell of cells) {
		const band = bands.find((b) => cell.y <= b.top && cell.y > b.bottom);
		if (band) band.cells.push(cell);
	}
	return bands.filter((b) => b.cells.length > 0);
}

/** What a table must look like for the rhythm to have been the real one. */
const EXACTLY_ONE_MIN = 0.85;
const DATED_MIN = 0.85;

export type Reading = {
	run: Run;
	bands: Band[];
	amountColumn: number;
	dateColumn: number;
	assigned: number;
	valid: boolean;
	why: string;
};

export function evaluate(run: Run, cells: Cell[]): Reading {
	const bands = bandsOf(run.anchors, cells);
	const assigned = bands.reduce((a, b) => a + b.cells.length, 0);

	let amountColumn = NaN;
	let bestExact = 0;
	for (const column of new Set(cells.filter((c) => c.kind === 'money').map((c) => c.right))) {
		const exact = bands.filter(
			(b) => b.cells.filter((c) => c.kind === 'money' && c.right === column).length === 1
		).length;
		if (exact / bands.length > bestExact) {
			bestExact = exact / bands.length;
			amountColumn = column;
		}
	}
	let dateColumn = NaN;
	let bestDated = 0;
	for (const column of new Set(cells.filter((c) => c.kind === 'date').map((c) => c.left))) {
		const dated = bands.filter(
			(b) => b.cells.filter((c) => c.kind === 'date' && c.left === column).length >= 1
		).length;
		if (dated / bands.length > bestDated) {
			bestDated = dated / bands.length;
			dateColumn = column;
		}
	}
	const valid = bestExact >= EXACTLY_ONE_MIN && bestDated >= DATED_MIN;
	return {
		run,
		bands,
		amountColumn,
		dateColumn,
		assigned,
		valid,
		why: `money@${amountColumn.toFixed(0)} exactly-one ${(bestExact * 100).toFixed(0)}%, date@${dateColumn.toFixed(0)} present ${(bestDated * 100).toFixed(0)}%`
	};
}

/**
 * The reading that accounts for the most of the page.
 *
 * Fewest records was tried as the rule and is wrong: a UK statement's "Paid
 * out" column beats regularly on seven of ten rows and implies a seven-record
 * table that passes validation by a hair. It explains less of the page than the
 * date column does, and coverage is what separates them.
 */
export function readPage(cells: Cell[]): Reading | undefined {
	const readings = hypotheses(cells)
		.map((run) => evaluate(run, cells))
		.filter((r) => r.valid);
	readings.sort((a, b) => b.assigned - a.assigned || a.bands.length - b.bands.length);
	return readings[0];
}

export type AssembledRecord = {
	page: number;
	y: number;
	cells: Cell[];
	amount?: string;
	dates: string[];
};

/**
 * One rhythm for the whole statement, chosen by the pages that show it best.
 *
 * A page is not always able to recognise its own table. Komerční banka's last
 * page carries two movements and then a recapitulation block and a
 * balance-by-date table, and the balance table is the most regular thing on it:
 * read alone, that page reports five movements that do not exist and loses the
 * two that do. The other three pages have no such doubt, and a statement is
 * assembled the same way on every page or not at all.
 */
function documentAnchor(cells: Cell[], pages: number[]): string | undefined {
	const score = new Map<string, number>();
	for (const page of pages) {
		const pageCells = cells.filter((c) => c.page === page);
		for (const run of hypotheses(pageCells)) {
			const reading = evaluate(run, pageCells);
			if (!reading.valid) continue;
			score.set(run.label, (score.get(run.label) ?? 0) + reading.assigned);
		}
	}
	return [...score.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/**
 * Records that do not look like the others are not records.
 *
 * The last page of a Komerční banka statement prints balances by date: rows
 * with a date and a figure right-aligned to the amount column, indistinguishable
 * from a movement by any local test. They are distinguishable by company — a
 * movement fills the same columns as the twenty-seven movements above it, and
 * these fill six columns none of those use. No vocabulary, no page geometry:
 * only the statement's own repetition.
 */
function keepTypicalShapes(records: AssembledRecord[]): AssembledRecord[] {
	if (records.length < 4) return records;
	const signature = (r: AssembledRecord) => new Set(r.cells.map((c) => c.left));
	const frequency = new Map<number, number>();
	for (const r of records)
		for (const column of signature(r)) frequency.set(column, (frequency.get(column) ?? 0) + 1);
	const core = [...frequency.entries()]
		.filter(([, n]) => n >= records.length * 0.6)
		.map(([column]) => column);
	if (core.length === 0) return records;
	return records.filter((r) => {
		const has = signature(r);
		return core.filter((column) => has.has(column)).length >= core.length * 0.5;
	});
}

export function assemble(cells: Cell[]): { records: AssembledRecord[]; readings: Reading[] } {
	const pages = [...new Set(cells.map((c) => c.page))].sort((a, b) => a - b);
	const anchor = documentAnchor(cells, pages);
	const records: AssembledRecord[] = [];
	const readings: Reading[] = [];
	for (const page of pages) {
		const pageCells = cells.filter((c) => c.page === page);
		const onAnchor = hypotheses(pageCells)
			.filter((run) => run.label === anchor)
			.map((run) => evaluate(run, pageCells))
			.sort((a, b) => b.assigned - a.assigned);
		const reading = onAnchor[0] ?? readPage(pageCells);
		if (!reading) continue;
		readings.push(reading);
		for (const band of reading.bands) {
			const ordered = [...band.cells].sort((a, b) => b.y - a.y || a.x - b.x);
			const amount = ordered.find(
				(c) => c.kind === 'money' && c.right === reading.amountColumn
			)?.text;
			const dates = ordered.filter((c) => c.kind === 'date' && c.left === reading.dateColumn);
			records.push({ page, y: band.top, cells: ordered, amount, dates: dates.map((d) => d.text) });
		}
	}
	// A page too short to have a rhythm of its own still belongs to the document.
	//
	// Three anchors are needed to establish a beat, so a final page carrying one
	// or two movements produces no run and contributed nothing — a nine-movement
	// statement whose last page held the ninth read as eight, and reconciled
	// against nothing. The rhythm is a property of the STATEMENT, though, and by
	// this point it is known: the same anchor column, applied to a thin page,
	// bands it correctly without needing to be rediscovered there.
	const template = readings[0];
	if (anchor && template) {
		for (const page of pages) {
			if (records.some((record) => record.page === page)) continue;
			const pageCells = cells.filter((cell) => cell.page === page);
			const anchors = anchorsFor(anchor, pageCells);
			if (anchors.length === 0 || anchors.length >= MIN_RUN) continue;
			for (const band of bandsOf(anchors, pageCells)) {
				const ordered = [...band.cells].sort((a, b) => b.y - a.y || a.x - b.x);
				const amount = ordered.find(
					(c) => c.kind === 'money' && c.right === template.amountColumn
				)?.text;
				const dates = ordered.filter((c) => c.kind === 'date' && c.left === template.dateColumn);
				records.push({
					page,
					y: band.top,
					cells: ordered,
					amount,
					dates: dates.map((d) => d.text)
				});
			}
		}
	}

	// A band with no figure in the amount column and no date is page furniture
	// that happened to sit inside the table's span — a repeated header, a
	// carried-forward balance. It is dropped here rather than never assembled.
	const dated = records.filter((r) => r.amount && r.dates.length > 0);
	return { records: keepTypicalShapes(dated), readings };
}

/**
 * The assembled records as a table, for the same reader every other format
 * goes through.
 *
 * One row per movement, one column per clustered edge. Cells that share a
 * column within a record are joined in reading order, which is how a
 * description wrapped over three lines becomes one description rather than
 * three rows carrying no amount between them.
 *
 * Money keeps its right edge and everything else its left, so a right-aligned
 * amount column and a left-aligned reference column that happen to overlap are
 * not merged into one.
 *
 * Returns nothing when the page has no rhythm to find — fewer than three
 * records is not a table, it is a coincidence — and the caller simply has one
 * candidate reading fewer.
 */
export function gridsFromRhythm(lines: PdfLine[]): Grid[] {
	const cells = cellsOf(lines);
	if (cells.length === 0) return [];
	const { records } = assemble(cells);
	if (records.length < MIN_RUN) return [];

	const columnOf = (cell: Cell) =>
		cell.kind === 'money' ? `R${cell.right.toFixed(0)}` : `L${cell.left.toFixed(0)}`;

	/**
	 * Where a cell goes when its record already has one in that column.
	 *
	 * Prose wraps and values do not. A description continued over three lines is
	 * one description, so those join; but a booking date and a value date in the
	 * same column are two facts, and joining them produces `09.12.2024
	 * 08.12.2024`, which is not a date at all — every row then failed the "has a
	 * date" test and a 28-record table read as three.
	 *
	 * So a repeated value takes the next slot in that column instead, and the
	 * reader sees a second date column it can name `valueDate`.
	 */
	const slotOf = (cell: Cell, seen: Map<string, number>) => {
		const key = columnOf(cell);
		if (cell.kind === 'text') return key;
		const next = (seen.get(key) ?? 0) + 1;
		seen.set(key, next);
		return next === 1 ? key : `${key}#${next}`;
	};

	// Columns in reading order, placed by where they sit on the page.
	const inReadingOrder = (record: AssembledRecord) =>
		[...record.cells].sort((a, b) => b.y - a.y || a.x - b.x);

	const placement = new Map<string, number>();
	for (const record of records) {
		const seen = new Map<string, number>();
		for (const cell of inReadingOrder(record)) {
			const key = slotOf(cell, seen);
			const at = cell.kind === 'money' ? cell.right : cell.left;
			const known = placement.get(key);
			// A repeated slot sorts just after the one it follows, never before.
			const position = key.includes('#') ? at + 0.001 * Number(key.split('#')[1]) : at;
			if (known === undefined || position < known) placement.set(key, position);
		}
	}
	const order = [...placement.entries()].sort((a, b) => a[1] - b[1]).map(([key]) => key);
	const index = new Map(order.map((key, at) => [key, at]));

	const movement = (record: AssembledRecord): RawCell[] => {
		const texts: string[] = new Array(order.length).fill('');
		const seen = new Map<string, number>();
		for (const cell of inReadingOrder(record)) {
			const at = index.get(slotOf(cell, seen));
			if (at === undefined) continue;
			texts[at] = texts[at] ? `${texts[at]} ${cell.text}` : cell.text;
		}
		return texts.map((text) => ({ text: text.trim() }));
	};

	// The page furniture is kept, not discarded.
	//
	// A statement prints its opening and closing balance outside the table, and
	// the assembler above deliberately drops every line that is not a movement.
	// Emitting only the movements therefore produced a table with no arithmetic
	// attached to it: four banks assembled perfectly and were then refused with
	// "nothing in the statement could be checked", because the figures that could
	// have checked them had been thrown away one step earlier.
	//
	// These lines populate different columns from the movements, so region
	// detection separates them into their own blocks and reads them for what
	// they are — metadata and summary — exactly as it does for a spreadsheet.
	const inARecord = new Set(records.flatMap((record) => record.cells));
	const leftovers = new Map<number, Cell[]>();
	for (const cell of cells) {
		if (inARecord.has(cell)) continue;
		const key = cell.page * 100000 - cell.y;
		if (!leftovers.has(key)) leftovers.set(key, []);
		leftovers.get(key)!.push(cell);
	}

	// The movements come first, in document order and unbroken; the furniture
	// follows after a blank line.
	//
	// A multi-page statement prints its furniture BETWEEN its pages, so leaving
	// the two interleaved cut one 28-movement table into four regions of 7, 12,
	// 7 and 2 — each then had to reconcile on its own against balances belonging
	// to the whole. Order matters to the reader only inasmuch as it separates
	// blocks, and the movements' own order is preserved.
	const ordered = [...records].sort((a, b) => a.page - b.page || b.y - a.y);
	const rows: RawCell[][] = ordered.map(movement);

	/**
	 * The column header is not furniture.
	 *
	 * The assembler keeps only lines that carry a movement, so the row of labels
	 * above the table is dropped with the page's letterhead — and without it the
	 * reader has no names to work from and must guess roles from shape. On a
	 * `Debit | Credit | Balance` layout it guesses one of the pair and reports
	 * that half the rows have no amount, which is true of the column it picked
	 * and false of the table.
	 *
	 * The header is found by geometry, not vocabulary: it is the line directly
	 * above the first movement whose cells sit over the movement columns. Labels
	 * are not aligned the way their values are — `Debit` is left-aligned over a
	 * right-aligned figure — so they are matched on the midpoint of each cell,
	 * which is the one position both alignments share.
	 */
	const midpoints = new Map<string, { total: number; count: number }>();
	for (const record of records) {
		const seen = new Map<string, number>();
		for (const cell of inReadingOrder(record)) {
			const key = slotOf(cell, seen);
			const at = midpoints.get(key) ?? { total: 0, count: 0 };
			at.total += (cell.x + cell.xEnd) / 2;
			at.count += 1;
			midpoints.set(key, at);
		}
	}
	const centre = new Map([...midpoints.entries()].map(([key, at]) => [key, at.total / at.count]));

	const firstMovement = ordered[0];

	/**
	 * A header is often written over several lines, not one.
	 *
	 * Taking only the nearest line above the movements is right for a statement
	 * that prints `Date | Description | Amount` on one row, and wrong for the two
	 * that stack their labels. Česká spořitelna writes four lines — `Popis`, then
	 * `Částka obratu cizí měny…`, then `Provedeno | Název protiúčtu…`, then
	 * `Zaúčtováno | Položka | … | Částka` — and the nearest one carries a single
	 * label. Raiffeisenbank writes three, and the nearest names the amount column
	 * `Kurz`, which is the exchange rate.
	 *
	 * In both cases the column that says `Částka` is two lines further up, so the
	 * amount column arrived unnamed, the roles fell back to shape, and the table
	 * could not be read at all — from an assembly that was perfectly correct.
	 *
	 * So the whole contiguous run is taken. It stops at a jump in the line pitch,
	 * which is where the header block ends and the page furniture above it
	 * begins, and at a line carrying a figure — ČS prints
	 * `Počáteční zůstatek: 114 820.44` directly above its header, and that is a
	 * balance, not a label.
	 */
	const carriesMoney = (line: Cell[]) => line.some((cell) => cell.kind === 'money');
	const isMovementLine = (line: Cell[]) =>
		line.some((cell) => cell.kind === 'date') && carriesMoney(line);

	const candidates = [...leftovers.entries()]
		.map(([key, line]) => ({ key, line }))
		.filter(({ line }) => line[0].page === firstMovement.page && line[0].y > firstMovement.y)
		.sort((a, b) => a.line[0].y - b.line[0].y);

	const headerLines: { key: number; line: Cell[] }[] = [];
	let previousY: number | undefined;
	for (const candidate of candidates) {
		const y = candidate.line[0].y;
		// A movement, a figure, or a stated balance: not a label, and the run ends
		// here. The third case needs its own test — mBank prints
		// `Saldo początkowe: 67,93` as ONE cell, so it reads as text rather than
		// as money, and swallowing it into the header both lost the opening
		// balance as evidence and put a figure among the column names.
		const text = candidate.line.map((cell) => cell.text).join(' ');
		if (isMovementLine(candidate.line) || carriesMoney(candidate.line) || looksLikeSummary(text)) {
			break;
		}
		if (previousY !== undefined) {
			const step = y - previousY;
			const first = headerLines[0].line[0].y - firstMovement.y;
			// The run keeps its own rhythm; a wider jump is the page above it.
			if (step > Math.max(first, 1) * 2.5) break;
		}
		headerLines.push(candidate);
		previousY = y;
		if (headerLines.length >= 6) break;
	}

	if (headerLines.length > 0) {
		const nearest = (cell: Cell) => {
			const mid = (cell.x + cell.xEnd) / 2;
			let best: string | undefined;
			let distance = Infinity;
			for (const [key, at] of centre) {
				const gap = Math.abs(at - mid);
				if (gap < distance) [best, distance] = [key, gap];
			}
			// A label further from every column than a column is wide is not a
			// label for any of them.
			return distance <= 60 ? best : undefined;
		};

		// Topmost line first, so a stacked header reads the way it is printed and
		// `roleOfHeader` still finds the term it knows in the joined text.
		const header: string[] = new Array(order.length).fill('');
		let placed = 0;
		let offered = 0;
		for (const { line } of [...headerLines].reverse()) {
			for (const cell of [...line].sort((a, b) => a.x - b.x)) {
				offered++;
				const slot = nearest(cell);
				const at = slot === undefined ? undefined : index.get(slot);
				if (at === undefined) continue;
				placed++;
				header[at] = header[at] ? `${header[at]} ${cell.text}` : cell.text;
			}
		}
		if (placed >= offered * 0.6) {
			rows.unshift(header.map((text) => ({ text: text.trim() })));
			for (const { key } of headerLines) leftovers.delete(key);
		}
	}

	const furniture = [...leftovers.entries()].sort((a, b) => a[0] - b[0]);
	if (furniture.length > 0) {
		rows.push(new Array(order.length).fill(null).map(() => ({ text: '' })));
		for (const [, line] of furniture) {
			const texts = [...line].sort((a, b) => a.x - b.x).map((cell) => cell.text.trim());
			rows.push(texts.map((text) => ({ text })));
		}
	}

	mergeSplitDateColumns(rows, records.length);
	return [{ source: 'delimited', origin: 'pdf-rhythm', rows }];
}

/**
 * Two date columns that never appear together are one date column.
 *
 * Clustering places a cell by its left edge, and a proportional font moves that
 * edge by a point or two between rows — enough, occasionally, for one
 * statement's booking dates to land in two adjacent slots. On a Komerční banka
 * statement 25 of 28 movements put their date in one column and three put it in
 * the next, so the date column had three holes in it and the reading was refused
 * for rows "carrying no year" that in fact carried a perfectly good date one
 * column to the left.
 *
 * The test is co-occurrence, not similarity. A record has one booking date, so
 * two slots that are never both filled within a record cannot be two different
 * dates — they are one column that drifted. Money columns are deliberately NOT
 * merged on this rule: a debit and a credit column are also never both filled,
 * and there the emptiness is the meaning.
 */
function mergeSplitDateColumns(rows: RawCell[][], movements: number): void {
	if (rows.length === 0 || movements < 3) return;
	const width = rows[0].length;
	const body = rows.slice(0, movements + 1);

	const dateRows: Set<number>[] = [];
	for (let column = 0; column < width; column++) {
		const filled = new Set<number>();
		let dates = 0;
		for (const [at, row] of body.entries()) {
			const text = row[column]?.text.trim();
			if (!text) continue;
			filled.add(at);
			if (isDateLike(text)) dates++;
		}
		// A date column, allowing for the header sitting in it.
		dateRows[column] = filled.size > 0 && dates >= filled.size - 1 ? filled : new Set();
	}

	for (let left = 0; left < width; left++) {
		if (dateRows[left].size === 0) continue;
		for (let right = left + 1; right < width; right++) {
			if (dateRows[right].size === 0) continue;
			const overlap = [...dateRows[right]].some((at) => dateRows[left].has(at));
			if (overlap) continue;
			for (const row of rows) {
				const moving = row[right]?.text.trim();
				if (moving && !row[left]?.text.trim()) {
					row[left] = { ...row[right] };
					row[right] = { text: '' };
				}
			}
			for (const at of dateRows[right]) dateRows[left].add(at);
			dateRows[right] = new Set();
		}
	}
}
