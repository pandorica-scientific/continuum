/**
 * MT940 — the SWIFT customer statement message.
 *
 * The other format worth writing once: nearly every European bank exports it
 * for accounting software, and like ABO it is a published specification rather
 * than a layout a bank can quietly restyle.
 *
 * Tags used here:
 *   :20:  transaction reference — also the marker that a new statement begins
 *   :25:  account identification (national number, IBAN, or bank/account)
 *   :28C: statement number / sequence
 *   :60F: opening balance   (:60M: when a statement is split across pages)
 *   :61:  statement line — one movement
 *   :86:  information to the account owner, attached to the :61: above it
 *   :62F: closing balance   (:62M: intermediate)
 *   :64:  closing available balance — NOT the ledger balance, so ignored
 *
 * The :61: line packs its fields with no separators:
 *
 *   2503010301 D N 1234,56 NTRF CUSTOMERREF//BANKREF
 *   └value─┘└e┘ │ │ └amt─┘ └id┘ └────references────┘
 *               │ └ optional funds code (3rd letter of the currency)
 *               └ debit/credit mark: D, C, and the reversals RD and RC
 *
 * The reversal marks are the trap, exactly as ABO's posting codes 3 and 4 are:
 * RD reverses a debit and therefore CREDITS the account. Treating RD as a
 * debit doubles the error — the money moves the wrong way and the balance
 * chain fails by twice the amount, which reads as a parsing bug somewhere else
 * entirely.
 */
import { parseAmountToMinor } from '$lib/money';
import type { ParsedRow, ParsedStatement } from '../types';

/** YYMMDD, pivoted like every other two-digit year in this codebase. */
function swiftDate(raw: string): string | undefined {
	if (!/^\d{6}$/.test(raw)) return undefined;
	const yy = Number(raw.slice(0, 2));
	const month = raw.slice(2, 4);
	const day = raw.slice(4, 6);
	if (Number(month) < 1 || Number(month) > 12) return undefined;
	return `${yy >= 70 ? 1900 + yy : 2000 + yy}-${month}-${day}`;
}

/**
 * The entry date carries only MMDD, so its year comes from the value date —
 * and a movement booked on 31 December but valued on 2 January belongs to the
 * previous year, which a naive copy of the value date's year gets wrong by
 * twelve months.
 */
function entryDate(mmdd: string, valueIso: string): string | undefined {
	if (!/^\d{4}$/.test(mmdd)) return undefined;
	const month = Number(mmdd.slice(0, 2));
	const day = mmdd.slice(2, 4);
	if (month < 1 || month > 12) return undefined;
	const valueYear = Number(valueIso.slice(0, 4));
	const valueMonth = Number(valueIso.slice(5, 7));
	// December entry against a January value date means the year before.
	const year = valueMonth === 1 && month === 12 ? valueYear - 1 : valueYear;
	return `${year}-${mmdd.slice(0, 2)}-${day}`;
}

interface Tag {
	tag: string;
	value: string;
}

/** Tags start a line as ":NN:" or ":NNa:"; their value runs to the next tag. */
function tokenise(text: string): Tag[] {
	const tags: Tag[] = [];
	let current: Tag | undefined;
	for (const line of text.split(/\r?\n/)) {
		const match = /^:(\d{2}[A-Z]?):(.*)$/.exec(line);
		if (match) {
			current = { tag: match[1], value: match[2] };
			tags.push(current);
		} else if (current) {
			current.value += `\n${line}`;
		}
	}
	return tags;
}

const BALANCE = /^([CD])(\d{6})([A-Z]{3})([\d.,]+)/;

function parseBalance(value: string): { iso?: string; currency: string; minor: bigint } | null {
	const m = BALANCE.exec(value.trim());
	if (!m) return null;
	const currency = m[3];
	const magnitude = parseAmountToMinor(m[4], currency);
	return {
		iso: swiftDate(m[2]),
		currency,
		minor: m[1] === 'D' ? -magnitude : magnitude
	};
}

const STATEMENT_LINE = /^(\d{6})(\d{4})?(RC|RD|C|D)([A-Z])?([\d.,]+)([A-Z][A-Z0-9]{3})(.*)$/s;

/** D and RC take money out; C and RD put it in. */
const isOutgoing = (mark: string) => mark === 'D' || mark === 'RC';

/**
 * SWIFT files often arrive wrapped in blocks; the message we want is block 4.
 */
function unwrapSwiftBlocks(text: string): string {
	const start = text.indexOf('{4:');
	if (start === -1) return text;
	const end = text.indexOf('-}', start);
	return text.slice(start + 3, end === -1 ? undefined : end);
}

export function parseMt940(raw: string): ParsedStatement[] {
	const tags = tokenise(unwrapSwiftBlocks(raw));
	if (!tags.some((t) => t.tag === '20')) {
		throw new Error('No MT940 statement found: the file has no :20: reference tag.');
	}

	const statements: ParsedStatement[] = [];
	let current: ParsedStatement | undefined;
	let pendingRow: ParsedRow | undefined;

	const finishRow = () => {
		if (current && pendingRow) current.rows.push(pendingRow);
		pendingRow = undefined;
	};

	for (const { tag, value } of tags) {
		switch (tag) {
			case '20': {
				finishRow();
				current = { bank: 'mt940', format: 'mt940', currency: 'EUR', rows: [] };
				statements.push(current);
				break;
			}
			case '25': {
				if (current) current.accountNumber = value.trim().split(/\s+/)[0] || undefined;
				break;
			}
			case '60F':
			case '60M': {
				if (!current) break;
				const balance = parseBalance(value);
				if (!balance) break;
				current.currency = balance.currency;
				// :60M: is a page-continuation balance; only the F form opens the
				// statement, so it must not overwrite an opening already read.
				if (tag === '60F' || current.openingBalanceMinor === undefined) {
					current.openingBalanceMinor = balance.minor;
					current.periodStart = balance.iso;
				}
				break;
			}
			case '62F':
			case '62M': {
				if (!current) break;
				const balance = parseBalance(value);
				if (!balance) break;
				current.currency = balance.currency;
				current.closingBalanceMinor = balance.minor;
				current.periodEnd = balance.iso;
				break;
			}
			case '61': {
				finishRow();
				if (!current) break;
				const m = STATEMENT_LINE.exec(value.trim());
				if (!m) break;
				const [, valueRaw, entryRaw, mark, , amountRaw, , references] = m;
				const bookedIso = swiftDate(valueRaw);
				if (!bookedIso) break;

				const magnitude = parseAmountToMinor(amountRaw, current.currency);
				const [customerRef, bankRefRaw] = references.split('//');
				pendingRow = {
					// The entry date is when the bank booked it; the value date when
					// it counts. The ledger files by booking, as the statement lists.
					bookedAt: (entryRaw && entryDate(entryRaw, bookedIso)) || bookedIso,
					valueDate: bookedIso,
					amountMinor: isOutgoing(mark) ? -magnitude : magnitude,
					currency: current.currency,
					bankRef: bankRefRaw?.split('\n')[0].trim() || undefined,
					description: customerRef?.trim() || undefined
				};
				break;
			}
			case '86': {
				// Details belong to the movement immediately above. German banks
				// pack subfields as ?20?21…; flattening them to text keeps the
				// information without pretending to understand every bank's scheme.
				if (!pendingRow) break;
				const detail = value
					.replace(/\?\d{2}/g, ' ')
					.replace(/\s+/g, ' ')
					.trim();
				if (detail) {
					pendingRow.description = pendingRow.description
						? `${pendingRow.description} · ${detail}`
						: detail;
					pendingRow.counterparty = detail.slice(0, 70);
				}
				break;
			}
		}
	}
	finishRow();

	return statements.filter((s) => s.rows.length > 0 || s.openingBalanceMinor !== undefined);
}
