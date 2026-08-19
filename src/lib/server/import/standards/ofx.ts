// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/**
 * OFX and QFX — Open Financial Exchange.
 *
 * The third published statement format worth writing once, and the one most
 * likely to be what a North American bank offers: Quicken and its descendants
 * made QFX the default export for a generation of institutions that never
 * shipped CAMT or MT940.
 *
 * Two dialects share one file extension, and both are handled here:
 *
 *   OFX 1.x  SGML — tags are opened and never closed, and a value simply runs
 *            to the end of its line. `<TRNAMT>-404.25` is a complete element.
 *   OFX 2.x  XML — ordinary, well-formed, with closing tags.
 *
 * The SGML dialect is why this is not handed to an XML parser. Its files are
 * not XML and never were; feeding them to one produces an error that says
 * nothing useful to the person who exported the file.
 *
 * Reading both with one scanner is safe because the shape they share is a tag
 * followed by a value, and a closing tag in the XML dialect is simply a tag
 * whose value is empty. Nothing here depends on nesting.
 *
 * Signs are taken from `TRNAMT`, which carries its own, and never from
 * `TRNTYPE`. That is the trap this format sets: `TRNTYPE` is descriptive —
 * DEBIT, CREDIT, CHECK, FEE, INT, DIV — and banks disagree about which of them
 * imply a direction. The amount does not disagree with itself.
 */
import { parseAmountToMinor } from '$lib/money';
import type { ParsedRow, ParsedStatement } from '../types';

/** A tag and the value that follows it, in either dialect. */
interface Token {
	tag: string;
	value: string;
}

/**
 * Every `<TAG>value` pair in the file, in order.
 *
 * The value ends at the next tag or the end of the line, which is exactly the
 * SGML rule and is also true of the XML dialect once whitespace is trimmed.
 */
function tokenise(text: string): Token[] {
	const tokens: Token[] = [];
	const pattern = /<([A-Za-z0-9._]+)>([^<\r\n]*)/g;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(text)) !== null) {
		tokens.push({ tag: match[1].toUpperCase(), value: match[2].trim() });
	}
	return tokens;
}

/**
 * An OFX timestamp: `YYYYMMDD`, optionally with a time and a bracketed zone.
 *
 * The zone is discarded deliberately. A statement's booking date is the date
 * the bank printed, and shifting it into the reader's local zone moves
 * movements across midnight — which changes which month they fall in and, for
 * a statement that begins on the first, whether they belong to it at all.
 */
function ofxDate(raw: string): string | undefined {
	const match = /^(\d{4})(\d{2})(\d{2})/.exec(raw);
	return match ? `${match[1]}-${match[2]}-${match[3]}` : undefined;
}

const START = new Set(['STMTRS', 'CCSTMTRS']);

/**
 * Read every statement in an OFX or QFX file.
 *
 * A single file may carry several — one per account — in the same way a CAMT
 * export does, so this returns an array and the caller resolves each to its own
 * account.
 */
export function parseOfx(raw: string): ParsedStatement[] {
	const tokens = tokenise(raw);
	if (!tokens.some((token) => START.has(token.tag))) {
		throw new Error('No OFX statement found: the file carries no <STMTRS> or <CCSTMTRS> block.');
	}

	const statements: ParsedStatement[] = [];
	let current: ParsedStatement | undefined;
	let row: Partial<ParsedRow> & { type?: string } = {};
	let balanceKind: 'ledger' | 'available' | undefined;

	/**
	 * File the movement being read, if there is one.
	 *
	 * SGML gives no closing tag to wait for, so a transaction ends where the
	 * next one — or the end of the list — begins. That means the flush has to
	 * happen BEFORE the tag that ended it is processed: doing it afterwards
	 * resets the fields first and files an empty row, which reads as a file
	 * containing exactly one movement however many it has.
	 */
	const flush = () => {
		if (current && row.bookedAt && row.amountMinor !== undefined) {
			current.rows.push({
				bookedAt: row.bookedAt,
				valueDate: row.valueDate,
				amountMinor: row.amountMinor,
				currency: current.currency,
				counterparty: row.counterparty,
				description: row.description,
				bankRef: row.bankRef,
				variableSymbol: row.variableSymbol
			});
		}
		row = {};
	};

	for (const { tag, value } of tokens) {
		if (tag === 'STMTTRN' || tag === '/STMTTRN' || END.has(tag)) flush();
		if (START.has(tag)) {
			current = { bank: 'ofx', format: 'ofx', currency: 'EUR', rows: [] };
			statements.push(current);
			continue;
		}
		if (!current) continue;

		switch (tag) {
			case 'CURDEF':
				if (value) current.currency = value.toUpperCase();
				break;
			case 'ACCTID':
				if (value) current.accountNumber = value;
				break;
			case 'DTSTART':
				current.periodStart = ofxDate(value) ?? current.periodStart;
				break;
			case 'DTEND':
				current.periodEnd = ofxDate(value) ?? current.periodEnd;
				break;

			case 'TRNTYPE':
				row.type = value.toUpperCase();
				break;
			case 'DTPOSTED':
				row.bookedAt = ofxDate(value);
				break;
			case 'DTAVAIL':
				row.valueDate = ofxDate(value);
				break;
			case 'TRNAMT':
				// The amount carries its own sign. TRNTYPE is a description, and
				// banks disagree about which descriptions imply a direction.
				if (value) row.amountMinor = parseAmountToMinor(value, current.currency);
				break;
			case 'FITID':
				row.bankRef = value || undefined;
				break;
			case 'NAME':
				row.counterparty = value || undefined;
				break;
			case 'MEMO':
				row.description = value || undefined;
				break;
			case 'CHECKNUM':
				row.variableSymbol = value || undefined;
				break;

			// A balance block: LEDGERBAL is the account's balance, AVAILBAL is
			// what may be spent. Only the first is the ledger, and treating the
			// second as one makes every statement with a pending card hold
			// disagree with its own movements.
			case 'LEDGERBAL':
				balanceKind = 'ledger';
				break;
			case 'AVAILBAL':
				balanceKind = 'available';
				break;
			case 'BALAMT':
				if (balanceKind === 'ledger' && value) {
					current.closingBalanceMinor = parseAmountToMinor(value, current.currency);
				}
				break;
			case 'DTASOF':
				if (balanceKind === 'ledger') current.periodEnd ??= ofxDate(value);
				break;

			default:
				break;
		}
	}
	flush();

	for (const statement of statements) {
		if (statement.rows.length > 0) {
			statement.periodStart ??= statement.rows[0].bookedAt;
			statement.periodEnd ??= statement.rows[statement.rows.length - 1].bookedAt;
		}
		// The opening balance is NOT derived from the closing one.
		//
		// `closing - sum(movements)` was computed here so the endpoint check would
		// have something to test, on the reasoning that it could not manufacture
		// agreement because both sides come from the same movements. That is
		// exactly backwards: because both sides come from the same movements,
		// `opening + sum === closing` reduces to `closing === closing` and is true
		// whatever was read. An OFX export missing a transaction passed it, and
		// every OFX file was rated P1 on a check that could not fail.
		//
		// OFX prints no per-row balances, so with no stated opening figure there is
		// genuinely nothing in the file to check the movements against. Leaving the
		// endpoint evidence unavailable says so; the reading is then held rather
		// than filed, which is the honest answer for it.
	}

	return statements.filter((statement) => statement.rows.length > 0);
}

/** Tags that can only appear once a transaction is over. */
const END = new Set(['BANKTRANLIST', 'LEDGERBAL', 'AVAILBAL', 'STMTRS', 'CCSTMTRS', 'OFX']);
