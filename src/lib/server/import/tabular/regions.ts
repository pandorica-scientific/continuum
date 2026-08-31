// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Finding the transaction table inside a file that is not only a table.
 *
 * A statement is several things stacked: an address block, account metadata, a
 * turnover summary, the movements, a closing balance, a legal footer. Treating
 * the file as one rectangle finds the wrong rectangle — mBank's most common row
 * width is 2, its metadata key/value pairs, while its movements are width 8
 * two-thirds of the way down.
 *
 * Two findings from real exports shape this module:
 *
 *  1. **Dominant width is the wrong selector.** Regions must be found first and
 *     the transaction one chosen on its own evidence.
 *  2. **A footer row can have the transaction width.** mBank's closing balance
 *     is `;;;;;;#Saldo końcowe;106,59 PLN` — width 8, sitting under the
 *     movements. Any parser that files "rows matching the header width" imports
 *     a movement that does not exist.
 *
 * Metadata and summary regions are kept, not discarded: they hold the opening
 * balance and the stated totals, which is the evidence the proof engine needs.
 */
import { isDateLike } from './determinacy';
import type { Grid, RawCell } from './grid';
import { looksLikeFooter, looksLikeSummary, roleOfHeader } from './vocabulary';

type RegionRole = 'metadata' | 'summary' | 'transactions' | 'footer' | 'other';

export interface Region {
	/** Row indices into the grid, inclusive. */
	start: number;
	end: number;
	rows: RawCell[][];
	/** Populated width the region shares. */
	width: number;
	role: RegionRole;
	/** Index within `rows` of the header, when the region has one. */
	headerIndex?: number;
}

// Date recognition lives in determinacy.ts: a second copy here drifted, and
// this one still demanded a year — so a US column of bare MM/DD dates found
// no transaction table at all.
/**
 * A money-shaped token: digits, optionally grouped, with an optional decimal
 * tail, and a sign that may lead, trail, or be parentheses.
 *
 * The leading `\d+` matters. Requiring a group separator rejects UNGROUPED
 * integers, and Fio writes whole crowns plainly — `-20000`, `29760`. Three of
 * six real movements were dropped before this was widened, while a reduced
 * fixture using `240,00` passed happily.
 *
 * A currency mark is part of the amount, not a disqualification. CaixaBank
 * prints `-3,37 €` and the PDF reader deliberately keeps the symbol with the
 * figure — so a pattern that rejected any cell containing one meant no cell in
 * that statement was money, the region was not a table, and a page whose
 * columns had been recovered perfectly could not be read at all.
 */
// A leading `+` is how plenty of statements write a credit; rejecting it made
// those rows fail "does this row carry an amount" and vanish from the table.
const AMOUNT_LIKE =
	/^[€$£¥]?\s*[-+]?\(?\s*\d+(?:[.,\s'\u00A0\u202F]\d{3})*(?:[.,]\d{1,2})?\s*\)?[-+]?\s*(?:[€$£¥]|[A-Z]{3}|z\u0142|K\u010d|Ft)?$/;

const populatedWidth = (row: RawCell[]): number => {
	let last = -1;
	for (let i = 0; i < row.length; i++) if (row[i].text) last = i;
	return last + 1;
};

const isBlank = (row: RawCell[]) => row.every((c) => !c.text);
const rowText = (row: RawCell[]) => row.map((c) => c.text).join(' ');

const hasDate = (row: RawCell[]) => row.some((c) => isDateLike(c.text));
const hasAmount = (row: RawCell[]) =>
	row.some((c) => c.text.length > 0 && AMOUNT_LIKE.test(c.text) && /\d/.test(c.text));

const populatedColumns = (row: RawCell[]): Set<number> => {
	const filled = new Set<number>();
	row.forEach((cell, index) => {
		if (cell.text.trim()) filled.add(index);
	});
	return filled;
};

const shapeOverlap = (a: Set<number>, b: Set<number>): number => {
	if (a.size === 0 || b.size === 0) return 0;
	let shared = 0;
	for (const column of a) if (b.has(column)) shared++;
	return shared / (a.size + b.size - shared);
};

const SAME_SHAPE = 0.5;

/** A row that carries both a date and a figure is a movement. */
const isMovement = (row: RawCell[]) => hasDate(row) && hasAmount(row);

function split(grid: Grid): Omit<Region, 'role' | 'headerIndex'>[] {
	const regions: Omit<Region, 'role' | 'headerIndex'>[] = [];
	let current: RawCell[][] = [];
	let start = 0;
	let previous: Set<number> | undefined;
	let previousRow: RawCell[] | undefined;

	const flush = (end: number) => {
		if (current.length) {
			const width = current.reduce((widest, row) => Math.max(widest, populatedWidth(row)), 0);
			regions.push({ start, end, rows: current, width });
		}
		current = [];
	};

	for (const [index, row] of grid.rows.entries()) {
		if (isBlank(row)) {
			flush(index - 1);
			previous = undefined;
			previousRow = undefined;
			continue;
		}
		const shape = populatedColumns(row);
		// Two movements are one block, whatever columns each of them happens to
		// fill.
		//
		// Shape is the right test for telling a metadata block from a table, and
		// the wrong one for telling two movements apart. A statement recovered
		// from page geometry populates only the columns each movement uses — a
		// card payment fills nine, a transfer four — so on one real statement 58
		// of 103 adjacent pairs shared under half their columns, and a 104-movement
		// table became 23 regions of two to six rows, each then asked to prove
		// itself alone against balances printed once for all of them.
		const bothMovements = previousRow !== undefined && isMovement(previousRow) && isMovement(row);
		if (previous && !bothMovements && shapeOverlap(previous, shape) < SAME_SHAPE) {
			flush(index - 1);
			start = index;
		} else if (!previous) start = index;
		previous = shape;
		previousRow = row;
		current.push(row);
	}
	flush(grid.rows.length - 1);
	return rejoinHeaders(regions);
}

/**
 * A row of labels belongs to the table it names.
 *
 * Splitting on shape is right for blocks and wrong for headers: a header
 * populates every column the table HAS, while the rows below it populate only
 * the columns they use, so the very first data row often overlaps it least. A
 * UK statement whose first movement carries no "Paid out" value shares two
 * columns out of five with its own header — which reads as a change of block,
 * and the header ends up in a region of its own.
 *
 * The table then has no names to work from, roles fall back to shape, and a
 * `Paid out | Paid in` pair reads as one amount column with half its rows
 * empty. That is the same failure the OCR path had for the same reason, and it
 * is worth stating twice: losing the header is not a small loss, because
 * everything downstream depends on it.
 *
 * So a lone row that looks like a header is folded into the block beneath it.
 * `findHeader` decides what looks like one — the same judgement used to locate
 * a header inside a region — so there is one definition and not two.
 */
function rejoinHeaders(
	regions: Omit<Region, 'role' | 'headerIndex'>[]
): Omit<Region, 'role' | 'headerIndex'>[] {
	const out: Omit<Region, 'role' | 'headerIndex'>[] = [];
	for (let i = 0; i < regions.length; i++) {
		const region = regions[i];
		const next = regions[i + 1];
		const isLoneHeader =
			region.rows.length === 1 &&
			next !== undefined &&
			// Adjacent: a header does not skip a blank line to reach its table.
			next.start === region.end + 1 &&
			// A header is ALL labels. `findHeader` alone is too generous for a row
			// standing on its own: "Balance carried forward  £3,521.59" names a
			// role and carries no date, so it reads as a header — and folding that
			// into the table below buries the real header inside a summary block,
			// which is worse than leaving it where it was.
			!region.rows[0].some((cell) => cell.text && AMOUNT_LIKE.test(cell.text)) &&
			findHeader(region.rows) === 0;
		if (isLoneHeader) {
			out.push({
				start: region.start,
				end: next.end,
				rows: [...region.rows, ...next.rows],
				width: Math.max(region.width, next.width)
			});
			i++;
			continue;
		}
		out.push(region);
	}
	return out;
}

/**
 * A header is a row of labels: it names roles we recognise, and it carries no
 * date, because a date means it is already data.
 *
 * The BEST-matching row wins, not the first plausible one. CaixaBank's page
 * opens with `Account holder | IBAN ES73…`, and "IBAN" is a role we recognise,
 * so a first-match rule crowned that metadata line as the header — and the real
 * `Item | Date | Amount | Balance` row below it became data. The statement then
 * had no amount column and could not be read, from a grid that was perfect.
 */
function findHeader(rows: RawCell[][]): number | undefined {
	let best: { index: number; named: number } | undefined;

	for (let i = 0; i < Math.min(rows.length, 3); i++) {
		const row = rows[i];
		// A row carrying a date is data, not a header — but only THIS row, so the
		// search continues. Breaking here cost CaixaBank its header: its first
		// line ends with the page number "1/8", which is indistinguishable from
		// a two-component date, so the scan stopped before reaching
		// `Item | Date | Amount | Balance` one line below.
		if (hasDate(row)) continue;
		const named = row.filter((c) => c.text && roleOfHeader(c.text)).length;
		if (named === 0) continue;
		const texty = row.filter((c) => c.text && !AMOUNT_LIKE.test(c.text)).length;
		const plausible = named >= 2 || texty >= row.filter((c) => c.text).length - 1;
		if (plausible && (!best || named > best.named)) best = { index: i, named };
	}
	return best?.index;
}

function classify(region: Omit<Region, 'role' | 'headerIndex'>): Region {
	const headerIndex = findHeader(region.rows);
	const body = headerIndex === undefined ? region.rows : region.rows.slice(headerIndex + 1);
	const movementish = body.filter((row) => hasDate(row) && hasAmount(row));

	// Transactions FIRST. A closing-balance line sitting inside the movements
	// would otherwise recolour the whole block as a summary and lose every row.
	if (movementish.length >= 2 && region.width >= 3) {
		return { ...region, role: 'transactions', headerIndex };
	}

	const text = region.rows.map(rowText).join('\n');
	if (looksLikeSummary(text)) return { ...region, role: 'summary', headerIndex };
	if (looksLikeFooter(text)) return { ...region, role: 'footer', headerIndex };
	if (region.width <= 2) return { ...region, role: 'metadata', headerIndex };
	return { ...region, role: 'other', headerIndex };
}

export function detectRegions(grid: Grid): Region[] {
	return split(grid).map(classify);
}

/**
 * The movement rows of a transaction region, with its header and any summary
 * line removed.
 *
 * The exclusion is semantic, never positional: mBank's closing balance has the
 * same width as a movement and sits below them, so "everything after the
 * header" imports a transaction that does not exist. A row is a movement when
 * it carries a date AND an amount and does not name a balance.
 */
export function transactionRows(region: Region): RawCell[][] {
	const body =
		region.headerIndex === undefined ? region.rows : region.rows.slice(region.headerIndex + 1);
	return body.filter((row) => {
		if (looksLikeSummary(rowText(row))) return false;
		return hasDate(row) && hasAmount(row);
	});
}

/**
 * Rows that look exactly like movements and were dropped anyway.
 *
 * The summary test is a word match, so a real transaction whose description
 * happens to contain one of those words — a transfer labelled "total", a fee
 * named for a balance — is deleted with everything else. Reproduced on a
 * three-row statement: two rows stored, no questions asked, chain proof intact,
 * auto-imported. The chain closes because the surviving rows still step
 * correctly; nothing downstream can see the hole.
 *
 * A row carrying BOTH a booking date and an amount is movement-shaped, so
 * dropping it is a judgement the reader must not make in silence.
 */
export function droppedMovements(region: Region): RawCell[][] {
	const body =
		region.headerIndex === undefined ? region.rows : region.rows.slice(region.headerIndex + 1);
	return body.filter((row) => hasDate(row) && hasAmount(row) && looksLikeSummary(rowText(row)));
}

export interface GridChoice {
	grid: Grid;
	regions: Region[];
	transactions: Region[];
}

/**
 * Pick the reading that yields the most movement rows.
 *
 * Delimiter and encoding are not decided by inspecting punctuation but by
 * which combination produces an actual transaction table — the only outcome
 * that matters, and the one a wrong delimiter cannot fake.
 */
export function chooseGrid(grids: Grid[]): GridChoice | null {
	let best: GridChoice | null = null;
	let bestRows = -1;

	for (const grid of grids) {
		const regions = detectRegions(grid);
		const transactions = regions.filter((r) => r.role === 'transactions');
		const rows = transactions.reduce((n, r) => n + transactionRows(r).length, 0);
		// Prefer more movements; break ties toward the wider table, which means
		// fewer columns were merged by a delimiter that under-splits.
		const width = transactions.reduce((w, r) => Math.max(w, r.width), 0);
		const score = rows * 1000 + width;
		if (rows > 0 && score > bestRows) {
			bestRows = score;
			best = { grid, regions, transactions };
		}
	}
	return best;
}
