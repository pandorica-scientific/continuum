/**
 * From a chosen grid to a statement — or to a precise question.
 *
 * Column roles come from the header dictionary FIRST and from value shape
 * second. That order is not stylistic: Fio's `Protiúčet` holds `2600247495`,
 * ten digits with no leading zero, which is indistinguishable from money by
 * shape alone. Offering it to the arithmetic as an amount candidate is how an
 * account number becomes a transaction.
 *
 * Where the file does not settle something, this returns the open question
 * rather than a guess. That is what the single-question resolver asks about.
 */
import { minorDigits } from '$lib/money';
import type { ParsedRow, ParsedStatement } from '../types';
import {
	applyDateOrder,
	parseAmount,
	resolveDateOrder,
	resolveDecimalMark,
	type DateOrder,
	type DecimalMark
} from './determinacy';
import type { RawCell } from './grid';
import { transactionRows, type GridChoice, type Region } from './regions';
import { looksLikeSummary, normalise, roleOfHeader, type ColumnRole } from './vocabulary';

export interface OpenQuestion {
	dimension: 'dateOrder' | 'decimalMark' | 'dateColumn' | 'amountColumn';
	reason: string;
	candidates?: string[];
}

export interface TabularReading {
	statement?: ParsedStatement;
	questions: OpenQuestion[];
	/** How each column was read, for the mapping wizard to show. */
	roles: (ColumnRole | undefined)[];
	dateOrder?: DateOrder;
	decimalMark?: DecimalMark;
	/**
	 * The money columns exactly as the file displayed them.
	 *
	 * The proof engine needs these, not the parsed values: a uniform scale error
	 * is invisible once the text has become a number, and this is the only trace
	 * of how it was actually written.
	 */
	amountTexts?: string[];
}

const AMOUNT_TOKEN = /-?\(?\d[\d\s.,'\u00A0\u202F]*\)?-?/g;
const CURRENCY_TOKEN = /\b([A-Z]{3})\b/;
const DATE_TOKEN = /\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}|\d{4}-\d{2}-\d{2}/g;

const rowText = (row: RawCell[]) =>
	row
		.map((c) => c.text)
		.filter(Boolean)
		.join(' ');

/**
 * The value beside a label.
 *
 * Cell-wise when the row HAS cells: mBank writes `Uznania;2;310,00 PLN`, and
 * joining that to text yields `2 310,00`, which is a perfectly good
 * space-grouped number — the operation count and the value silently merge into
 * one figure ten times too large. Only a single-cell row (Fio prints its whole
 * preamble that way) falls back to scanning the text.
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
		.filter((t) => /\d/.test(t) && !DATE_TOKEN.test(t));
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
				const currency = CURRENCY_TOKEN.exec(text);
				if (currency) evidence.currency = currency[1];
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
		const numeric = values.filter(
			(v) => parseAmount(v, '.') !== null || parseAmount(v, ',') !== null
		);
		if (numeric.length >= values.length * 0.8 && !named.has('amount')) {
			roles[c] = 'amount';
			named.add('amount');
		}
	}
	return roles;
}

const indexOfRole = (roles: (ColumnRole | undefined)[], role: ColumnRole) => roles.indexOf(role);

export interface ReadOptions {
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
}

export function readTabular(
	choice: GridChoice,
	region: Region,
	options: ReadOptions = {}
): TabularReading {
	const body = transactionRows(region);
	const roles = options.roles ?? assignRoles(region, body);
	const questions: OpenQuestion[] = [];
	const evidence = readEvidence(choice.regions);

	const dateColumn = indexOfRole(roles, 'bookingDate');
	const valueDateColumn = indexOfRole(roles, 'valueDate');
	const amountColumn = indexOfRole(roles, 'amount');
	const debitColumn = indexOfRole(roles, 'debit');
	const creditColumn = indexOfRole(roles, 'credit');
	const balanceColumn = indexOfRole(roles, 'balance');

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
	// date order.
	const period =
		evidence.periodStart && evidence.periodEnd
			? {
					start: applyDateOrder(evidence.periodStart, 'day-first'),
					end: applyDateOrder(evidence.periodEnd, 'day-first')
				}
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
	// Resolve the convention over EVERY number the statement shows, movements and
	// balances alike. Fio's amounts are ungrouped integers that settle nothing,
	// while its balance line reads `382,38` — consulting only the columns picked
	// "." and turned that balance into 38 238,00.
	const mark = options.decimalMark
		? ({ kind: 'determined', value: options.decimalMark, evidence: 'a confirmed layout' } as const)
		: resolveDecimalMark([
				...amountValues,
				evidence.openingBalance ?? '',
				evidence.closingBalance ?? '',
				evidence.creditTotal ?? '',
				evidence.debitTotal ?? ''
			]);
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
	const currency = options.currency ?? evidence.currency ?? 'CZK';
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
			amountMinor = parseAmount(row[amountColumn]?.text ?? '', decimalMark, digits);
		} else {
			// A debit/credit pair: direction comes from WHICH column holds the
			// value, never from a sign.
			const debit = parseAmount(row[debitColumn]?.text ?? '', decimalMark, digits);
			const credit = parseAmount(row[creditColumn]?.text ?? '', decimalMark, digits);
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

		rows.push({
			bookedAt,
			valueDate:
				valueDateColumn >= 0
					? applyDateOrder(row[valueDateColumn]?.text ?? '', dateOrder, periodYear)
					: undefined,
			amountMinor,
			currency: text('currency') ?? currency,
			balanceAfterMinor:
				balanceColumn >= 0
					? (parseAmount(row[balanceColumn]?.text ?? '', decimalMark, digits) ?? undefined)
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
	// quiet omission. Dropping them silently produced a statement with no rows
	// at all — from a file whose every line was a perfectly good transaction
	// written as MM/DD with no year and no period to borrow one from.
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

/** True when a row names a balance rather than a movement. */
export const isSummaryRow = (row: RawCell[]) => looksLikeSummary(rowText(row));
