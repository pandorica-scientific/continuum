// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * From a chosen grid to a statement — or to a precise question.
 *
 * Column roles come from the header dictionary FIRST and from value shape
 * second, deliberately: a numeric-looking account number is indistinguishable
 * from money by shape alone, and offering it to the arithmetic is how an
 * account number becomes a transaction.
 *
 * Where the file does not settle something, this returns the open question
 * rather than a guess, for the single-question resolver to ask about.
 */
import { escapeRegExp } from '$lib/regex';
import { isCurrencyCode, minorDigits } from '$lib/money';
import type { ParsedRow, ParsedStatement } from '../types';
import {
	applyDateOrder,
	isDateLike,
	parseAmount,
	resolveDateOrder,
	resolvePeriod,
	resolveDecimalMark,
	type DateOrder,
	type DecimalMark
} from './determinacy';
import type { RawCell } from './grid';
import { droppedMovements, transactionRows, type GridChoice, type Region } from './regions';
import { normalise, roleOfHeader, type ColumnRole } from './vocabulary';

interface OpenQuestion {
	dimension:
		'dateOrder' | 'decimalMark' | 'dateColumn' | 'amountColumn' | 'currency' | 'excludedRow';
	reason: string;
	candidates?: string[];
}

interface TabularReading {
	statement?: ParsedStatement;
	questions: OpenQuestion[];
	/** How each column was read, for the mapping wizard to show. */
	roles: (ColumnRole | undefined)[];
	dateOrder?: DateOrder;
	decimalMark?: DecimalMark;
	/**
	 * The money columns exactly as the file displayed them. The proof engine
	 * needs these, not the parsed values — a uniform scale error is invisible
	 * once the text has become a number.
	 */
	amountTexts?: string[];
}

const AMOUNT_TOKEN = /-?\(?\d[\d\s.,'\u00A0\u202F]*\)?-?/g;
/**
 * A currency is a code or symbol sitting BESIDE an amount.
 *
 * Any three uppercase letters is not a currency — e.g. an abbreviation in an
 * address. Requiring adjacency to a number is what makes the token evidence
 * rather than coincidence.
 */
const SYMBOL_CURRENCY: Record<string, string> = {
	'£': 'GBP',
	'€': 'EUR',
	$: 'USD',
	'¥': 'JPY',
	zł: 'PLN',
	Kč: 'CZK',
	Ft: 'HUF'
};
const CURRENCY_NEAR_AMOUNT =
	/(?:^|[\s(])([A-Z]{3})\s*-?\(?\d|\d[\d\s.,'\u00A0]*\s*([A-Z]{3})(?=$|[\s).,])/;
const DATE_TOKEN = /\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}|\d{4}-\d{2}-\d{2}/g;
/**
 * The same pattern without `g`, for asking a single token.
 *
 * `RegExp.prototype.test` on a global regex resumes from `lastIndex`, so
 * testing a run of values with DATE_TOKEN itself would alternate true/false —
 * letting a date slip through as a figure (`31.01.2025` -> 1012025.00).
 */
const ONE_DATE_TOKEN = new RegExp(DATE_TOKEN.source);

const rowText = (row: RawCell[]) =>
	row
		.map((c) => c.text)
		.filter(Boolean)
		.join(' ');

/**
 * The value beside a label.
 *
 * Cell-wise when the row HAS cells: joining cells to text first can merge an
 * adjacent count and value into one figure that looks like a valid grouped
 * number but is wrong by an order of magnitude. Only a single-cell row falls
 * back to scanning the text.
 */
function labelledValue(row: RawCell[]): string | undefined {
	const cells = row.map((c) => c.text).filter(Boolean);
	if (cells.length > 1) {
		for (let i = cells.length - 1; i >= 0; i--) {
			const value = trailingAmount(cells[i]);
			if (value) return value;
		}
		return undefined;
	}
	return trailingAmount(cells[0] ?? '');
}

/** The last money-shaped token in one cell. */
function trailingAmount(text: string): string | undefined {
	const matches = [...text.matchAll(AMOUNT_TOKEN)]
		.map((m) => m[0].trim())
		.filter((t) => /\d/.test(t) && !ONE_DATE_TOKEN.test(t));
	return matches.at(-1);
}

/**
 * Facts the statement states about itself, gathered from the metadata and
 * summary regions the region pass deliberately kept.
 */
export interface Evidence {
	currency?: string;
	periodStart?: string;
	periodEnd?: string;
	openingBalance?: string;
	closingBalance?: string;
	creditTotal?: string;
	debitTotal?: string;
	rowCount?: number;
}

const OPENING = [
	'pocatecni',
	'saldo poczatkowe',
	'alter kontostand',
	'opening balance',
	'brought forward',
	'beginning balance',
	'saldo inicial'
];
const CLOSING = [
	'konecny',
	'koncovy',
	'saldo koncowe',
	'neuer kontostand',
	'closing balance',
	'carried forward',
	'ending balance',
	'saldo final'
];
const CREDITS = [
	'prijmy celkem',
	'celkem prislo',
	'suma prijmu',
	'uznania',
	'summe gutschriften',
	'total paid in',
	'total deposits',
	'total abonos'
];
const DEBITS = [
	'vydaje celkem',
	'celkem odeslo',
	'suma vydaju',
	'obciazenia',
	'summe lastschriften',
	'total paid out',
	'total withdrawals',
	'total cargos'
];
const COUNTS = ['anzahl buchungen', 'number of transactions', 'liczba operacji', 'pocet polozek'];

const mentions = (text: string, terms: string[]) => terms.some((t) => text.includes(t));

export function readEvidence(regions: Region[]): Evidence {
	const evidence: Evidence = {};
	for (const region of regions) {
		if (region.role === 'transactions') continue;
		for (const row of region.rows) {
			const text = rowText(row);
			if (!text) continue;
			const key = normalise(text);

			if (!evidence.currency) {
				// A labelled currency: "Währung: EUR", "Měna: CZK", "Currency: GBP".
				const labelled =
					/(?:wahrung|währung|currency|mena|měna|waluta|divisa|moneda|ccy)\s*[:\s]\s*([A-Z]{3})\b/i.exec(
						text
					);
				if (labelled && isCurrencyCode(labelled[1])) {
					evidence.currency = labelled[1].toUpperCase();
				}
			}
			if (!evidence.currency) {
				// Three capital letters beside a figure is a shape, not a fact — an
				// account number can look the same. Asking whether the code is an
				// actual currency separates them.
				const beside = CURRENCY_NEAR_AMOUNT.exec(text);
				const code = beside?.[1] ?? beside?.[2];
				if (code && isCurrencyCode(code)) evidence.currency = code.toUpperCase();
				else {
					for (const [symbol, code] of Object.entries(SYMBOL_CURRENCY)) {
						// The symbol must touch a figure, and may sit on EITHER side of
						// it — most of Europe puts the symbol after the amount, not
						// before it.
						const glyph = escapeRegExp(symbol);
						const before = `${glyph}\\s*-?\\(?\\d`;
						const after = `\\d[\\d\\s.,'\\u00A0]*\\s*${glyph}`;
						if (new RegExp(`${before}|${after}`).test(text)) {
							evidence.currency = code;
							break;
						}
					}
				}
			}
			if (!evidence.periodStart) {
				const dates = text.match(DATE_TOKEN);
				if (dates && dates.length >= 2 && /obdobi|okres|period|zeitraum|periodo/.test(key)) {
					evidence.periodStart = dates[0];
					evidence.periodEnd = dates[1];
				}
			}

			const value = labelledValue(row);
			if (!value) continue;
			// Opening before closing: several statements print both on one line,
			// and "Konečný" must not be captured by the opening test.
			if (!evidence.closingBalance && mentions(key, CLOSING)) evidence.closingBalance = value;
			else if (!evidence.openingBalance && mentions(key, OPENING)) evidence.openingBalance = value;
			if (!evidence.creditTotal && mentions(key, CREDITS)) evidence.creditTotal = value;
			if (!evidence.debitTotal && mentions(key, DEBITS)) evidence.debitTotal = value;
			if (!evidence.rowCount && mentions(key, COUNTS)) {
				const count = /(\d+)/.exec(text);
				if (count) evidence.rowCount = Number(count[1]);
			}
		}
	}
	return evidence;
}

const columnValues = (rows: RawCell[][], index: number) => rows.map((r) => r[index]?.text ?? '');

/**
 * The amount in a cell that may carry more than the amount.
 *
 * On a page recovered from geometry, a wrapped description can spill into the
 * money column, so demanding the whole cell parse as a number loses a movement
 * that is plainly there. The money-shaped token is taken instead, only when
 * exactly one is present — two figures in one cell means the columns are
 * wrong.
 */
function amountFromCell(text: string, decimal: DecimalMark, digits: number): bigint | null {
	const whole = parseAmount(text, decimal, digits);
	if (whole !== null) return whole;
	const tokens = text.match(AMOUNT_TOKEN) ?? [];
	const money = tokens.map((t) => t.trim()).filter((t) => /\d/.test(t));
	if (money.length !== 1) return null;
	return parseAmount(money[0], decimal, digits);
}

/**
 * Assign a role to every column: the header dictionary first, then shape for
 * whatever the header did not name.
 */
function assignRoles(region: Region, body: RawCell[][]): (ColumnRole | undefined)[] {
	const header = region.headerIndex === undefined ? undefined : region.rows[region.headerIndex];
	const width = Math.max(...body.map((r) => r.length), header?.length ?? 0);
	const roles: (ColumnRole | undefined)[] = [];

	for (let c = 0; c < width; c++) {
		roles[c] = header ? roleOfHeader(header[c]?.text ?? '') : undefined;
	}

	// Shape only fills gaps, and only for columns the dictionary left unnamed —
	// so a column the header called a reference is never reconsidered as money.
	const named = new Set(roles.filter(Boolean));
	for (let c = 0; c < width; c++) {
		if (roles[c]) continue;
		const values = columnValues(body, c).filter(Boolean);
		if (values.length === 0) continue;
		const dateLike = values.filter((v) => resolveDateOrder([v]).kind !== 'unavailable').length;
		if (dateLike >= values.length * 0.8 && !named.has('bookingDate')) {
			roles[c] = 'bookingDate';
			named.add('bookingDate');
			continue;
		}
	}

	// The amount column is the best-covered one, not the first one that parses.
	//
	// Coverage means coverage of the BODY (all rows), not of a column's own
	// non-empty cells — otherwise a nearly-empty column can pass the 80%
	// threshold trivially and block the real amount column from claiming the
	// role. Dates are explicitly excluded from the numeric test rather than
	// relied on to fail it, since a date can parse as a large number under some
	// decimal conventions. Taking the best-covered column, not the first, also
	// stops a sparse reference column beating a full one by sitting to its left.
	if (!named.has('amount')) {
		let best: { column: number; covered: number } | undefined;
		for (let c = 0; c < width; c++) {
			if (roles[c]) continue;
			const values = columnValues(body, c).filter(Boolean);
			const numeric = values.filter(holdsFigure);
			if (numeric.length < body.length * 0.8) continue;
			if (!best || numeric.length > best.covered) best = { column: c, covered: numeric.length };
		}
		if (best) {
			roles[best.column] = 'amount';
			named.add('amount');
		}
	}
	preferCompleteDateColumn(roles, body);
	keepOneAmountColumn(roles, body);
	repairNumericRoles(roles, body);
	pairAmountWithBalance(roles, body);
	return roles;
}

/**
 * One amount column: the one that is actually filled.
 *
 * A statement can print more than one column whose label says "amount" — a
 * foreign-currency original alongside the movement's own amount, say — and
 * the dictionary can recognise both as the same role. The movement's own
 * amount is on every movement; a qualifying column is not, so coverage
 * separates them without needing a word for what the other column is.
 */
function keepOneAmountColumn(roles: (ColumnRole | undefined)[], body: RawCell[][]): void {
	const claimed = roles.flatMap((role, at) => (role === 'amount' ? [at] : []));
	if (claimed.length < 2) return;

	// Counted as FIGURES, not as filled cells: a stacked header can put a label
	// over a description column rather than the amount it names, so both
	// candidates can be populated on every row while only one holds numbers.
	let best = claimed[0];
	let bestCovered = -1;
	for (const at of claimed) {
		const covered = columnValues(body, at).filter(holdsFigure).length;
		if (covered > bestCovered) [best, bestCovered] = [at, covered];
	}
	for (const at of claimed) if (at !== best) roles[at] = undefined;
}

/**
 * Amount and balance identify each other.
 *
 * If one column's consecutive differences ARE another column's values, the
 * first is a running balance and the second is the movement, and neither
 * needed a header to say so. This is the strongest signal a table can offer —
 * a coincidence would have to hold on every row at once — and it is what
 * makes a headerless ledger readable at all.
 *
 * Both row orders are tried (some banks list newest first), and both decimal
 * conventions, since the mark is not settled at this stage; a convention that
 * makes the chain close is evidence for that convention too.
 */
function pairAmountWithBalance(roles: (ColumnRole | undefined)[], body: RawCell[][]): void {
	if (roles.includes('balance') || body.length < 3) return;

	const numeric: number[] = [];
	for (let c = 0; c < roles.length; c++) {
		if (roles[c] && roles[c] !== 'amount') continue;
		const values = columnValues(body, c).filter(Boolean);
		if (values.length < body.length * 0.8) continue;
		const parsed = values.filter(
			(v) => parseAmount(v, '.') !== null || parseAmount(v, ',') !== null
		);
		if (parsed.length >= values.length * 0.8) numeric.push(c);
	}
	if (numeric.length < 2) return;

	const column = (index: number, mark: DecimalMark) =>
		body.map((row) => parseAmount(row[index]?.text ?? '', mark));

	for (const mark of ['.', ','] as const) {
		for (const balance of numeric) {
			const balances = column(balance, mark);
			if (balances.some((v) => v === null)) continue;
			for (const amount of numeric) {
				if (amount === balance) continue;
				const amounts = column(amount, mark);
				if (amounts.some((v) => v === null)) continue;
				const steps = (order: 'as listed' | 'newest first') => {
					const b = order === 'as listed' ? balances : [...balances].reverse();
					const a = order === 'as listed' ? amounts : [...amounts].reverse();
					for (let i = 1; i < b.length; i++) if (b[i]! - b[i - 1]! !== a[i]!) return false;
					return true;
				};
				if (steps('as listed') || steps('newest first')) {
					roles[amount] = 'amount';
					roles[balance] = 'balance';
					return;
				}
			}
		}
	}
}

/**
 * Does this cell hold a figure, however the statement dresses it?
 *
 * `parseAmount` reads a bare number and nothing else, so an amount with its
 * currency printed beside every value (`-6 103.00 CZK`) is not a number to
 * it, and a shape test built directly on it would find a column of amounts
 * empty. `amountFromCell` already knows how to find the figure in a cell that
 * says more than the figure, so this asks through it instead.
 */
const holdsFigure = (value: string): boolean => {
	if (!value || isDateLike(value)) return false;
	// The cell must BE a figure, not merely contain one. `amountFromCell` digs
	// the single money-looking token out of a cell that says more than the
	// figure — right when reading a value, too generous when deciding what a
	// column is, since it would find e.g. the `1` in `REF-1`.
	//
	// A currency written beside the number is dressing that still leaves a
	// figure, so it is stripped first and the strict test applied to what
	// remains — but the label must be a real currency code, not merely three
	// letters, or a reference like `REF-1` would strip to `-1` and pass.
	let bare = value.trim().replace(/^(?:[€$£¥]|zł|Kč|Ft)\s*/, '');
	bare = bare.replace(/\s*(?:[€$£¥]|zł|Kč|Ft)$/, '');
	const leading = /^([A-Za-z]{3})\s*(?=[-+(]?\d)/.exec(bare);
	if (leading && isCurrencyCode(leading[1])) bare = bare.slice(leading[0].length);
	const trailing = /(?<=\d[\s)]?)\s*([A-Za-z]{3})$/.exec(bare);
	if (trailing && isCurrencyCode(trailing[1])) bare = bare.slice(0, -trailing[0].length);
	bare = bare.trim();
	return parseAmount(bare, '.') !== null || parseAmount(bare, ',') !== null;
};

const NUMERIC_ROLES: ColumnRole[] = ['amount', 'balance', 'debit', 'credit'];

/**
 * Move a numeric role onto the column that actually holds the numbers.
 *
 * Amounts are right-aligned and so are their headers, so a header word can
 * start further right than the values beneath it and land over the wrong
 * column, leaving the real column unprovably empty.
 *
 * Only ever moves a role to an unclaimed neighbour, and only when the named
 * column holds no numbers at all while the neighbour does.
 */
function repairNumericRoles(roles: (ColumnRole | undefined)[], body: RawCell[][]): void {
	const figures = (index: number): number =>
		body.map((r) => r[index]?.text ?? '').filter(holdsFigure).length;
	const numericColumn = (index: number): boolean => {
		const values = body.map((r) => r[index]?.text ?? '').filter(Boolean);
		if (values.length === 0) return false;
		return figures(index) >= values.length * 0.8;
	};

	for (const [index, role] of roles.entries()) {
		if (!role || !NUMERIC_ROLES.includes(role)) continue;
		if (numericColumn(index)) continue;
		// The nearest unclaimed column that actually holds figures, and among
		// equals the fullest. Not restricted to immediate neighbours: a stacked
		// header can land a label's midpoint several columns from the numbers it
		// names, so the role belongs on the column with the numbers, however far.
		let best: { at: number; covered: number; distance: number } | undefined;
		for (let at = 0; at < roles.length; at++) {
			if (at === index || roles[at]) continue;
			const covered = figures(at);
			if (covered === 0 || !numericColumn(at)) continue;
			const distance = Math.abs(at - index);
			if (!best || covered > best.covered || (covered === best.covered && distance < best.distance))
				best = { at, covered, distance };
		}
		if (best) {
			roles[best.at] = role;
			roles[index] = undefined;
		}
	}
}

const indexOfRole = (roles: (ColumnRole | undefined)[], role: ColumnRole) => roles.indexOf(role);

interface ReadOptions {
	/**
	 * Roles a confirmed profile supplies, resolved by header NAME upstream. When
	 * present these replace inference entirely — that is the whole value of
	 * remembering a layout — but they do not exempt the statement from proving
	 * itself.
	 */
	roles?: (ColumnRole | undefined)[];
	dateOrder?: DateOrder;
	decimalMark?: DecimalMark;
	currency?: string;
	/**
	 * Regions to read the statement's own facts from, when they are not in the
	 * same grid as its movements — a statement states its balances once, on
	 * the first page, then runs its table across the pages that follow.
	 */
	evidenceRegions?: Region[];
}

export function readTabular(
	choice: GridChoice,
	region: Region,
	options: ReadOptions = {}
): TabularReading {
	const body = transactionRows(region);
	const roles = options.roles ?? assignRoles(region, body);
	const questions: OpenQuestion[] = [];
	const evidence = readEvidence(options.evidenceRegions ?? choice.regions);

	const dateColumn = indexOfRole(roles, 'bookingDate');
	const valueDateColumn = indexOfRole(roles, 'valueDate');
	const amountColumn = indexOfRole(roles, 'amount');
	const debitColumn = indexOfRole(roles, 'debit');
	const creditColumn = indexOfRole(roles, 'credit');
	const balanceColumn = indexOfRole(roles, 'balance');
	const feeColumn = indexOfRole(roles, 'fee');

	// A movement-shaped row was filtered out as a summary line. Say so rather
	// than quietly filing a statement with a hole in it.
	const dropped = droppedMovements(region);
	if (dropped.length > 0) {
		questions.push({
			dimension: 'excludedRow',
			reason: `${dropped.length} row(s) carry a date and an amount but read as a summary line, so they were left out — check whether they are movements`
		});
	}

	if (dateColumn === -1) {
		questions.push({
			dimension: 'dateColumn',
			reason: 'no column holds a date for every movement'
		});
	}
	if (amountColumn === -1 && (debitColumn === -1 || creditColumn === -1)) {
		questions.push({
			dimension: 'amountColumn',
			reason: 'no column holds the amount, and there is no debit/credit pair either'
		});
	}
	if (questions.length > 0) return { questions, roles };

	// The period the statement claims, used to settle an otherwise ambiguous
	// date order. Read the same way the rows are: both orders tried, and it
	// speaks only if one survives (see `resolvePeriod`).
	const period =
		evidence.periodStart && evidence.periodEnd
			? resolvePeriod(evidence.periodStart, evidence.periodEnd)
			: undefined;

	const dateValues = columnValues(body, dateColumn).filter(Boolean);
	// A profile carries a date order a person already confirmed, so the file no
	// longer has to settle it on its own evidence.
	const order = options.dateOrder
		? ({ kind: 'determined', value: options.dateOrder, evidence: 'a confirmed layout' } as const)
		: resolveDateOrder(dateValues, period);
	if (order.kind !== 'determined') {
		questions.push({
			dimension: 'dateOrder',
			reason: order.kind === 'ambiguous' ? order.reason : order.reason,
			candidates: order.kind === 'ambiguous' ? order.candidates : undefined
		});
	}

	const amountValues = [
		...(amountColumn >= 0 ? columnValues(body, amountColumn) : []),
		...(debitColumn >= 0 ? columnValues(body, debitColumn) : []),
		...(creditColumn >= 0 ? columnValues(body, creditColumn) : []),
		...(balanceColumn >= 0 ? columnValues(body, balanceColumn) : [])
	].filter(Boolean);
	// The account first, the document second, a guess never — a fallback
	// default currency here would be a fabricated fact about someone's money.
	// A statement is imported INTO an account whose currency the user stated,
	// so `options.currency` is the authority and the page is corroboration.
	// Only a first import, for an account that does not exist yet, arrives
	// without one — and that is a question, since the answer becomes
	// permanent metadata every later import is checked against.
	const detectedCurrency = options.currency ?? evidence.currency;
	if (!detectedCurrency) {
		questions.push({
			dimension: 'currency',
			reason: 'nothing in this file names the currency, and no account was given to take it from'
		});
	}

	// Resolve the convention over EVERY number the statement shows, movements
	// and balances alike — some layouts have ungrouped movement amounts that
	// settle nothing on their own, while a stated balance elsewhere does.
	const mark = options.decimalMark
		? ({ kind: 'determined', value: options.decimalMark, evidence: 'a confirmed layout' } as const)
		: resolveDecimalMark(
				[
					...amountValues,
					evidence.openingBalance ?? '',
					evidence.closingBalance ?? '',
					evidence.creditTotal ?? '',
					evidence.debitTotal ?? ''
				],
				// The currency decides what three trailing digits mean.
				detectedCurrency ? minorDigits(detectedCurrency) : 2
			);
	// "Unavailable" means every reading agrees — integers with no separator —
	// which is settled, not open.
	const decimalMark: DecimalMark = mark.kind === 'determined' ? mark.value : '.';
	if (mark.kind === 'ambiguous') {
		questions.push({ dimension: 'decimalMark', reason: mark.reason, candidates: mark.candidates });
	}

	if (questions.length > 0) {
		return {
			questions,
			roles,
			dateOrder: order.kind === 'determined' ? order.value : undefined,
			decimalMark: mark.kind === 'determined' ? mark.value : undefined
		};
	}

	const dateOrder = (order as { value: DateOrder }).value;
	// The question raised above is in `questions`, so reaching here means one
	// was found.
	const currency = detectedCurrency as string;
	const digits = minorDigits(currency);
	const periodYear = period?.start ? Number(period.start.slice(0, 4)) : undefined;

	const rows: ParsedRow[] = [];
	let undatedRows = 0;
	let unpricedRows = 0;
	for (const row of body) {
		const bookedAt = applyDateOrder(row[dateColumn]?.text ?? '', dateOrder, periodYear);
		if (!bookedAt) {
			undatedRows++;
			continue;
		}

		let amountMinor: bigint | null = null;
		if (amountColumn >= 0) {
			const cell = row[amountColumn]?.text ?? '';

			// A figure in another currency is not a movement in this ledger — a
			// foreign original printed alongside a card payment, aligned to the
			// same edge as the account's own amounts, is the same money said
			// twice, not a second movement. It belongs to the movement above it,
			// as `ParsedRow`'s foreign-original field.
			const beside = CURRENCY_NEAR_AMOUNT.exec(cell);
			const stated = beside?.[1] ?? beside?.[2];
			if (stated && isCurrencyCode(stated) && stated.toUpperCase() !== currency) {
				const previous = rows[rows.length - 1];
				const original = amountFromCell(cell, decimalMark, minorDigits(stated.toUpperCase()));
				if (previous && original !== null && previous.originalAmountMinor === undefined) {
					previous.originalAmountMinor = original;
					previous.originalCurrency = stated.toUpperCase();
				}
				continue;
			}

			amountMinor = amountFromCell(cell, decimalMark, digits);
		} else {
			// A debit/credit pair: direction comes from WHICH column holds the
			// value, never from a sign.
			const debit = amountFromCell(row[debitColumn]?.text ?? '', decimalMark, digits);
			const credit = amountFromCell(row[creditColumn]?.text ?? '', decimalMark, digits);
			if (debit !== null && debit !== 0n) amountMinor = -abs(debit);
			else if (credit !== null) amountMinor = abs(credit);
		}
		if (amountMinor === null) {
			unpricedRows++;
			continue;
		}

		const text = (role: ColumnRole) => {
			const index = indexOfRole(roles, role);
			// The DISPLAYED text, always — a typed value has already lost the
			// leading zeros that make an account number an account number.
			return index >= 0 ? row[index]?.text || undefined : undefined;
		};

		const rowCurrency = text('currency');

		rows.push({
			bookedAt,
			valueDate:
				valueDateColumn >= 0
					? applyDateOrder(row[valueDateColumn]?.text ?? '', dateOrder, periodYear)
					: undefined,
			amountMinor,
			// A charge stated in its own column, kept apart from the movement:
			// the chain steps by `amount - fee`, so folding it into the amount
			// would lose the fee, and dropping it entirely would leave the chain
			// short by exactly the fee.
			...(() => {
				if (feeColumn < 0) return {};
				const charged = amountFromCell(row[feeColumn]?.text ?? '', decimalMark, digits);
				// Signed, as `ParsedRow.feeMinor` is: a charge is positive, a fee
				// handed back on a refund is negative, and the chain nets both the
				// same way. Taking the magnitude charged a refunded fee twice.
				return charged ? { feeMinor: charged } : {};
			})(),
			// The ledger entry is denominated in the ACCOUNT's currency, always.
			// A per-row currency column names the ORIGINAL of a foreign movement,
			// not the ledger currency — writing it into `currency` would mix minor
			// units from two different currencies. The amounts are already proven
			// to be in the ledger currency, since an unclosed running-balance
			// chain never reaches this point.
			currency,
			...(rowCurrency && rowCurrency !== currency ? { originalCurrency: rowCurrency } : {}),
			balanceAfterMinor:
				balanceColumn >= 0
					? (amountFromCell(row[balanceColumn]?.text ?? '', decimalMark, digits) ?? undefined)
					: undefined,
			counterparty: text('counterparty'),
			counterpartyAccount: text('counterpartyAccount'),
			variableSymbol: text('variableSymbol'),
			constantSymbol: text('constantSymbol'),
			specificSymbol: text('specificSymbol'),
			description: text('description'),
			bankRef: text('reference')
		});
	}

	// A row the reader could not turn into a movement is a QUESTION, never a
	// quiet omission.
	if (undatedRows > 0) {
		questions.push({
			dimension: 'dateColumn',
			reason:
				`${undatedRows} of ${body.length} rows have a date this layout cannot complete` +
				' — they carry no year, and the statement prints no period to take one from'
		});
	}
	if (unpricedRows > 0) {
		questions.push({
			dimension: 'amountColumn',
			reason: `${unpricedRows} of ${body.length} rows have no readable amount`
		});
	}
	if (questions.length > 0) return { questions, roles, dateOrder, decimalMark };

	// Where a balance column exists, the BALANCE decides each movement's
	// direction, not a sign read off the amount — some statements print an
	// unsigned amount beside a separate direction letter, and the balance is
	// more robust and self-checking. Adopted only if it makes the chain close.
	deriveSignsFromBalance(rows, parseAmount(evidence.openingBalance ?? '', decimalMark, digits));

	const parse = (value?: string) =>
		value === undefined ? undefined : (parseAmount(value, decimalMark, digits) ?? undefined);

	const statement: ParsedStatement = {
		bank: 'tabular',
		format: choice.grid.source === 'xlsx' ? 'xlsx' : 'csv',
		currency,
		periodStart: period?.start,
		periodEnd: period?.end,
		openingBalanceMinor: parse(evidence.openingBalance),
		closingBalanceMinor: parse(evidence.closingBalance),
		statedCreditTotalMinor: absOrUndefined(parse(evidence.creditTotal)),
		statedDebitTotalMinor: absOrUndefined(parse(evidence.debitTotal)),
		statedRowCount: evidence.rowCount,
		rows
	};

	return { statement, questions: [], roles, dateOrder, decimalMark, amountTexts: amountValues };
}

const abs = (v: bigint) => (v < 0n ? -v : v);
const absOrUndefined = (v?: bigint) => (v === undefined ? undefined : abs(v));

/**
 * Re-sign movements from the running balance, in place, when doing so makes
 * the chain close and leaving them alone does not.
 */
function deriveSignsFromBalance(rows: ParsedRow[], opening: bigint | null): void {
	if (rows.length < 2 || opening === null) return;
	if (rows.some((r) => r.balanceAfterMinor === undefined)) return;

	const closes = (candidate: ParsedRow[]) => {
		let running = opening;
		for (const row of candidate) {
			if (running + row.amountMinor !== row.balanceAfterMinor) return false;
			running = row.balanceAfterMinor!;
		}
		return true;
	};
	if (closes(rows)) return;

	let running = opening;
	const derived = rows.map((row) => {
		const movement = row.balanceAfterMinor! - running;
		running = row.balanceAfterMinor!;
		// Only the SIGN is taken from the balance; a magnitude that disagrees
		// means the columns are misread, which is not something to paper over.
		const signed = movement < 0n ? -abs(row.amountMinor) : abs(row.amountMinor);
		return { ...row, amountMinor: signed };
	});
	if (!closes(derived)) return;
	for (const [index, row] of derived.entries()) rows[index].amountMinor = row.amountMinor;
}

/**
 * The booking date is on every movement; a second date may not be.
 *
 * A statement printing both a booking date and a value date can have a
 * stacked header land both labels on the same column, leaving the true
 * booking-date column unnamed. Which is which is not a question of labels:
 * every movement has a booking date, so the column filled on every row is it.
 */
function preferCompleteDateColumn(roles: (ColumnRole | undefined)[], body: RawCell[][]): void {
	const booking = roles.indexOf('bookingDate');
	if (booking < 0 || body.length < 3) return;

	const dated = (column: number) =>
		columnValues(body, column).filter((value) => value && isDateLike(value)).length;

	const current = dated(booking);
	if (current === body.length) return;

	// The FULLEST column, not merely the last one that beat the incumbent — the
	// running best must move with the winner, or a fuller column further left
	// can lose to a sparser one that happens to sit further right.
	let better: number | undefined;
	let bestDated = current;
	for (let column = 0; column < roles.length; column++) {
		if (column === booking || (roles[column] && roles[column] !== 'valueDate')) continue;
		const count = dated(column);
		if (count > bestDated) {
			bestDated = count;
			better = column;
		}
	}
	if (better === undefined) return;

	// The fuller column takes the role; the one it replaces becomes the value
	// date, which is what a second date on a movement almost always is.
	roles[booking] = roles[booking] === 'bookingDate' ? 'valueDate' : roles[booking];
	roles[better] = 'bookingDate';
}
