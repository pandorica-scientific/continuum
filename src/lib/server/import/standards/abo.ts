// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * ABO/GPC — the Czech interbank statement format.
 *
 * Fixed 128-character records defined by the Czech National Bank and exported
 * by essentially every Czech bank (ČS, KB, ČSOB, Moneta, Fio, Raiffeisenbank),
 * which is what makes it worth more than any per-bank PDF reader: one parser,
 * no bank-specific code, and a specification the bank cannot quietly change.
 *
 * Layout, from the published spec (ČS document 3-2267), 1-based columns:
 *
 *   074 statement header
 *     1-3    record type "074"        76-89   debit turnover
 *     4-19   client account            90     debit turnover sign
 *     20-39  client short name        91-104  credit turnover
 *     40-45  old balance date ddmmrr  105     credit turnover sign
 *     46-59  old balance             106-108  statement number
 *     60     old balance sign        109-114  booking date ddmmrr
 *     61-74  new balance             115-128  filler
 *     75     new balance sign
 *
 *   075 movement
 *     1-3    record type "075"        62-71   variable symbol
 *     4-19   client account           72-81   constant symbol (see below)
 *     20-35  counter-account          82-91   specific symbol
 *     36-48  document number          92-97   value date ddmmrr
 *     49-60  amount, in haléře        98-117  supplementary text
 *     61     posting code            118      change code
 *                                    119-122  data kind
 *                                    123-128  due date ddmmrr
 *
 * Three things bite anyone implementing this from the field layout alone, and
 * all three are handled below:
 *
 *  1. Amounts are ALREADY in minor units. There is no decimal to parse, so the
 *     separator ambiguity that dominates CSV simply does not exist here.
 *  2. The sign is the posting code, not the amount — and codes 3 and 4 are
 *     REVERSALS, which invert their base direction. Reading them as ordinary
 *     debits and credits puts the money the wrong way round.
 *  3. The counter-account's bank code hides inside the constant-symbol field,
 *     at positions 5-8 from the right. Without it the counter-account cannot be
 *     written in the "93531803/5500" form the rest of the app matches on.
 */
import type { ParsedRow, ParsedStatement } from '../types';

const RECORD_LENGTH_MIN = 100;

/** 1-based, inclusive — quoted straight from the spec table above. */
const at = (line: string, from: number, to: number) => line.slice(from - 1, to);

/** ddmmrr. Statements are recent, so 70+ reads as the nineteen-hundreds. */
function aboDate(raw: string): string | undefined {
	if (!/^\d{6}$/.test(raw)) return undefined;
	const day = raw.slice(0, 2);
	const month = raw.slice(2, 4);
	const yy = Number(raw.slice(4, 6));
	if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) {
		return undefined;
	}
	return `${yy >= 70 ? 1900 + yy : 2000 + yy}-${month}-${day}`;
}

/** Sign fields carry "+" or "-"; a "0" appears on turnover fields. */
const signed = (digits: string, sign: string): bigint => {
	const value = BigInt(digits.replace(/\D/g, '') || '0');
	return sign === '-' ? -value : value;
};

/**
 * Czech account numbers carry a weighted modulo-11 check on the prefix and on
 * the number independently. That is what lets us tell the plain 16-digit form
 * apart from the "vnitřní formát" permutation the spec allows — guessing wrong
 * scrambles every account number in the file, and the checksum decides it
 * without asking anyone.
 */
const PREFIX_WEIGHTS = [10, 5, 8, 4, 2, 1];
const NUMBER_WEIGHTS = [6, 3, 7, 9, 10, 5, 8, 4, 2, 1];

function mod11(digits: string, weights: number[]): boolean {
	if (digits.length !== weights.length) return false;
	let sum = 0;
	for (let i = 0; i < digits.length; i++) sum += Number(digits[i]) * weights[i];
	return sum % 11 === 0;
}

const plausibleAccount = (prefix: string, number: string) =>
	mod11(prefix, PREFIX_WEIGHTS) && mod11(number, NUMBER_WEIGHTS);

/**
 * "Vnitřní formát" permutes prefix and number as
 *   C0 C8 C9 C6 C1 C2 C3 C4 C5 C7 P1 P2 P3 P4 P5 P6
 * where P is the six-digit prefix and C the ten-digit number (C0 being its
 * last digit). Undoing it is a fixed gather.
 */
function fromInternalFormat(raw: string): { prefix: string; number: string } {
	const c = raw.slice(0, 10);
	const prefix = raw.slice(10, 16);
	// Positions within `c`, in the order the spec lays them out.
	const number = c[4] + c[5] + c[6] + c[7] + c[8] + c[3] + c[9] + c[1] + c[2] + c[0];
	return { prefix, number };
}

/** Render a 16-digit account field the way statements print it. */
function accountNumber(raw: string): string | undefined {
	const digits = raw.replace(/\D/g, '').padStart(16, '0');
	if (!/^\d{16}$/.test(digits) || /^0{16}$/.test(digits)) return undefined;

	const plain = { prefix: digits.slice(0, 6), number: digits.slice(6) };
	const internal = fromInternalFormat(digits);

	// Prefer whichever reading the checksum accepts; fall back to the plain one,
	// which is what the overwhelming majority of exporters write.
	const chosen = plausibleAccount(plain.prefix, plain.number)
		? plain
		: plausibleAccount(internal.prefix, internal.number)
			? internal
			: plain;

	const prefix = chosen.prefix.replace(/^0+/, '');
	const number = chosen.number.replace(/^0+/, '') || '0';
	return prefix ? `${prefix}-${number}` : number;
}

/**
 * The constant-symbol field packs two values: the constant symbol itself in the
 * rightmost four characters, and the counter-account's bank code in positions
 * 5-8 from the right.
 */
function splitConstantSymbol(field: string): { constantSymbol?: string; bankCode?: string } {
	const digits = field.replace(/\D/g, '').padStart(10, '0');
	const constantSymbol = digits.slice(-4).replace(/^0+/, '');
	const bankCode = digits.slice(-8, -4);
	return {
		constantSymbol: constantSymbol || undefined,
		bankCode: /^\d{4}$/.test(bankCode) && bankCode !== '0000' ? bankCode : undefined
	};
}

const trimField = (raw: string) => raw.trim() || undefined;
const symbol = (raw: string) => raw.replace(/\D/g, '').replace(/^0+/, '') || undefined;

/**
 * Posting codes: 1 debit, 2 credit, 3 reversal of a debit, 4 reversal of a
 * credit. A reversal moves money the other way from the code it reverses.
 */
function directionOf(code: string): -1n | 1n | null {
	switch (code) {
		case '1':
			return -1n;
		case '2':
			return 1n;
		case '3':
			return 1n;
		case '4':
			return -1n;
		default:
			return null;
	}
}

/**
 * Parse an ABO file. A single file may carry several 074 blocks — different
 * accounts, or several periods for one account — so this returns every
 * statement it finds, in file order.
 */
export function parseAbo(text: string): ParsedStatement[] {
	const lines = text.split(/\r?\n/).filter((l) => l.trim().length >= RECORD_LENGTH_MIN);
	const statements: ParsedStatement[] = [];
	let current: ParsedStatement | undefined;

	for (const line of lines) {
		const type = at(line, 1, 3);

		if (type === '074') {
			const openingSign = at(line, 60, 60);
			const closingSign = at(line, 75, 75);
			const debitSign = at(line, 90, 90);
			const creditSign = at(line, 105, 105);
			const openingDate = aboDate(at(line, 40, 45));
			const bookingDate = aboDate(at(line, 109, 114));

			current = {
				bank: 'abo',
				format: 'abo',
				accountNumber: accountNumber(at(line, 4, 19)),
				// ABO's Kč variant carries no currency field; the format is defined
				// in haléře and used domestically.
				currency: 'CZK',
				periodStart: openingDate,
				periodEnd: bookingDate,
				openingBalanceMinor: signed(at(line, 46, 59), openingSign),
				closingBalanceMinor: signed(at(line, 61, 74), closingSign),
				// Turnovers are magnitudes; the spec's sign character here marks a
				// reversal overhang rather than direction.
				statedDebitTotalMinor: abs(signed(at(line, 76, 89), debitSign)),
				statedCreditTotalMinor: abs(signed(at(line, 91, 104), creditSign)),
				rows: []
			};
			statements.push(current);
			continue;
		}

		if (type !== '075') continue;
		// A movement before any header means the file is truncated or reordered;
		// inventing a statement to hold it would hide that.
		if (!current) continue;

		const direction = directionOf(at(line, 61, 61));
		if (direction === null) continue;

		const magnitude = BigInt(at(line, 49, 60).replace(/\D/g, '') || '0');
		const { constantSymbol, bankCode } = splitConstantSymbol(at(line, 72, 81));
		const counterAccount = accountNumber(at(line, 20, 35));
		const valueDate = aboDate(at(line, 92, 97));
		const dueDate = aboDate(at(line, 123, 128));

		const row: ParsedRow = {
			// ABO gives a movement no booking date of its own: the statement's
			// booking date is the day it was posted, the valuta the day it counts
			// for interest. Prefer the valuta, which is what the statement lists
			// against, and fall back to the header's booking day.
			bookedAt: valueDate ?? dueDate ?? current.periodEnd ?? current.periodStart ?? '1970-01-01',
			valueDate,
			amountMinor: direction * magnitude,
			currency: current.currency,
			counterpartyAccount:
				counterAccount && bankCode ? `${counterAccount}/${bankCode}` : counterAccount,
			counterparty: trimField(at(line, 98, 117)),
			variableSymbol: symbol(at(line, 62, 71)),
			constantSymbol,
			specificSymbol: symbol(at(line, 82, 91)),
			bankRef: trimField(at(line, 36, 48))?.replace(/^0+/, '') || undefined
		};
		current.rows.push(row);
	}

	if (statements.length === 0) {
		throw new Error('No ABO statement records (074) found in that file.');
	}
	// Deliberately NOT setting statedRowCount: ABO does not print one, and
	// setting it from rows.length would make the completeness check compare the
	// rows against themselves — evidence that proves nothing while looking like
	// evidence that proves everything.
	return statements;
}

const abs = (v: bigint) => (v < 0n ? -v : v);
