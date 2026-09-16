// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Finding the transaction table inside a file that is not only a table.
 *
 * A statement stacks several things — address, metadata, a turnover summary,
 * the movements, a footer — so regions must be found first and the
 * transaction one chosen on its own evidence, not by dominant row width: a
 * footer row (e.g. a closing balance) can share the movement width.
 *
 * Metadata and summary regions are kept, not discarded: they hold the
 * evidence the proof engine needs.
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

// Date recognition lives in determinacy.ts: a second copy here drifted out of
// sync (no year required), so keep one definition.
/**
 * A money-shaped token: digits, optionally grouped, with an optional decimal
 * tail, and a sign that may lead, trail, or be parentheses.
 *
 * Ungrouped integers must match too — some banks write whole units plainly
 * (`-20000`). A currency mark beside the figure is part of the amount, not a
 * disqualification, and a leading `+` must be accepted as a valid credit sign.
 */
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
		// Two movements are one block regardless of shape overlap: a
		// geometry-recovered statement populates only the columns each movement
		// uses, so adjacent movements can shape-differ despite being one table.
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
 * Splitting on shape is wrong for headers: a header populates every column
 * the table has, while the first data row often populates only the columns it
 * uses and so can shape-overlap its own header least — leaving the header in
 * a region of its own, with no names for the table to fall back on.
 *
 * So a lone row that looks like a header is folded into the block beneath it,
 * using the same `findHeader` judgement used elsewhere.
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
			// A header is ALL labels — `findHeader` alone would also accept a
			// summary line like "Balance carried forward £3,521.59".
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
 * The BEST-matching row wins, not the first plausible one — a metadata line
 * naming one recognised role (e.g. "IBAN") can otherwise outrank the real
 * header below it.
 */
function findHeader(rows: RawCell[][]): number | undefined {
	let best: { index: number; named: number } | undefined;

	for (let i = 0; i < Math.min(rows.length, 3); i++) {
		const row = rows[i];
		// A row carrying a date is data, not a header — but only THIS row, so the
		// search continues rather than stopping (a page number can look
		// date-like and must not end the scan early).
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
 * The exclusion is semantic, never positional: a closing-balance row can have
 * the same width as a movement and sit right below them. A row is a movement
 * only when it carries a date AND an amount and does not name a balance.
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
 * happens to contain a summary word is deleted along with actual summary
 * rows — silently, since the chain still closes on what remains. A row
 * carrying both a date and an amount is movement-shaped, so dropping it is a
 * judgement the reader must not make without surfacing it.
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
 * Pick the reading that yields the most movement rows: delimiter and
 * encoding are decided by which combination produces an actual transaction
 * table, not by inspecting punctuation.
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
