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
import type { Grid, RawCell } from './grid';
import { looksLikeFooter, looksLikeSummary, roleOfHeader } from './vocabulary';

export type RegionRole = 'metadata' | 'summary' | 'transactions' | 'footer' | 'other';

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

const DATE_LIKE =
	/^\s*(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\s?[./-]\s?\d{1,2}\s?[./-]\s?\d{2,4}\.?)(?:[T\s]+\d{1,2}:\d{2}(?::\d{2})?)?\s*$/;
/**
 * A money-shaped token: digits, optionally grouped, with an optional decimal
 * tail, and a sign that may lead, trail, or be parentheses.
 *
 * The leading `\d+` matters. Requiring a group separator rejects UNGROUPED
 * integers, and Fio writes whole crowns plainly — `-20000`, `29760`. Three of
 * six real movements were dropped before this was widened, while a reduced
 * fixture using `240,00` passed happily.
 */
const AMOUNT_LIKE = /^-?\(?\s*\d+(?:[.,\s'\u00A0\u202F]\d{3})*(?:[.,]\d{1,2})?\s*\)?-?$/;

const populatedWidth = (row: RawCell[]): number => {
	let last = -1;
	for (let i = 0; i < row.length; i++) if (row[i].text) last = i;
	return last + 1;
};

const isBlank = (row: RawCell[]) => row.every((c) => !c.text);
const rowText = (row: RawCell[]) => row.map((c) => c.text).join(' ');

const hasDate = (row: RawCell[]) => row.some((c) => DATE_LIKE.test(c.text));
const hasAmount = (row: RawCell[]) =>
	row.some((c) => c.text.length > 0 && AMOUNT_LIKE.test(c.text) && /\d/.test(c.text));

/**
 * Split into runs of consecutive non-blank rows that share a populated width.
 * A blank row or a change of width ends a region — both are how statements
 * separate one block from the next.
 */
function split(grid: Grid): Omit<Region, 'role' | 'headerIndex'>[] {
	const regions: Omit<Region, 'role' | 'headerIndex'>[] = [];
	let current: RawCell[][] = [];
	let start = 0;
	let width = -1;

	const flush = (end: number) => {
		if (current.length) regions.push({ start, end, rows: current, width });
		current = [];
	};

	for (const [index, row] of grid.rows.entries()) {
		if (isBlank(row)) {
			flush(index - 1);
			width = -1;
			continue;
		}
		const w = populatedWidth(row);
		if (w !== width) {
			flush(index - 1);
			start = index;
			width = w;
		}
		current.push(row);
	}
	flush(grid.rows.length - 1);
	return regions;
}

/**
 * A header is a row of labels: it names roles we recognise, and it carries no
 * date, because a date means it is already data.
 */
function findHeader(rows: RawCell[][]): number | undefined {
	for (let i = 0; i < Math.min(rows.length, 3); i++) {
		const row = rows[i];
		if (hasDate(row)) return undefined;
		const named = row.filter((c) => c.text && roleOfHeader(c.text)).length;
		const texty = row.filter((c) => c.text && !AMOUNT_LIKE.test(c.text)).length;
		if (named >= 2 || (named >= 1 && texty >= row.filter((c) => c.text).length - 1)) return i;
	}
	return undefined;
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

/** Rows a transaction region contained but did not file, for reporting. */
export function excludedRows(region: Region): RawCell[][] {
	const body =
		region.headerIndex === undefined ? region.rows : region.rows.slice(region.headerIndex + 1);
	const kept = new Set(transactionRows(region));
	return body.filter((row) => !kept.has(row));
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
