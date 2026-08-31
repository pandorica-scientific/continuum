// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * CAMT.053 — the ISO 20022 bank-to-customer statement.
 *
 * The strongest format we read. It states its own opening and closing balances,
 * the credit and debit totals, AND the number of entries in each direction, so
 * a CAMT statement can reach a full proof with no inference at all.
 *
 * Three details decide whether an implementation is right:
 *
 *  1. **Balance type codes.** `OPBD`/`PRCD` open the statement and `CLBD`
 *     closes it. `OPAV`/`CLAV` are AVAILABLE balances — reserved funds removed
 *     — and will never reconcile against booked movements. This is the same
 *     trap Česká spořitelna's PDF sets with "Disponibilní zůstatek", now
 *     written into a standard.
 *  2. **`<RvslInd>true</RvslInd>`** inverts an entry's direction, exactly as
 *     ABO's posting codes 3 and 4 and MT940's RD/RC marks do.
 *  3. **The currency is an attribute**, `<Amt Ccy="CZK">`, not an element.
 *
 * One file may carry several `<Stmt>` blocks — different accounts or periods —
 * so this returns them all. That is the case the pipeline's array shape exists
 * for.
 */
import { parseAmountToMinor } from '$lib/money';
import type { ParsedRow, ParsedStatement } from '../types';
import { at, childrenNamed, descendants, parseXml, textAt, type XmlNode } from './xml';

/** Balance codes that mean the ledger balance, not the available one. */
const OPENING_CODES = new Set(['OPBD', 'PRCD']);
const CLOSING_CODES = new Set(['CLBD']);

const balanceCode = (bal: XmlNode): string | undefined =>
	textAt(bal, 'Tp', 'CdOrPrtry', 'Cd') ?? textAt(bal, 'Tp', 'CdOrPrtry', 'Prtry');

/** `<Dt><Dt>2025-03-01</Dt></Dt>` or `<Dt><DtTm>…</DtTm></Dt>`. */
function isoDate(node: XmlNode | undefined): string | undefined {
	if (!node) return undefined;
	const plain = textAt(node, 'Dt') ?? node.text.trim();
	const stamp = textAt(node, 'DtTm');
	const raw = plain || stamp;
	const match = raw?.match(/^(\d{4}-\d{2}-\d{2})/);
	return match?.[1];
}

/** `<Amt Ccy="CZK">1234.56</Amt>` — currency lives in the attribute. */
function amount(node: XmlNode | undefined, fallbackCurrency: string) {
	if (!node) return undefined;
	const currency = node.attrs.Ccy || fallbackCurrency;
	const raw = node.text.trim();
	if (!raw) return undefined;
	return { currency, minor: parseAmountToMinor(raw, currency) };
}

/**
 * CRDT adds, DBIT removes — unless the entry is flagged a reversal, which
 * turns it around. A reversal read as an ordinary entry moves money the wrong
 * way and breaks the chain by twice the amount.
 */
function signOf(node: XmlNode): 1n | -1n {
	const indicator = textAt(node, 'CdtDbtInd') ?? 'DBIT';
	const reversed = (textAt(node, 'RvslInd') ?? '').toLowerCase() === 'true';
	const base: 1n | -1n = indicator.toUpperCase() === 'CRDT' ? 1n : -1n;
	return reversed ? ((base * -1n) as 1n | -1n) : base;
}

/** Counterparty is whichever side the account is not. */
function counterparty(entry: XmlNode, outgoing: boolean) {
	const details = descendants(entry, 'TxDtls')[0] ?? entry;
	const parties = at(details, 'RltdPties');
	const nameNode = outgoing ? 'Cdtr' : 'Dbtr';
	const acctNode = outgoing ? 'CdtrAcct' : 'DbtrAcct';
	return {
		name:
			textAt(parties, nameNode, 'Nm') ??
			textAt(parties, nameNode, 'Pty', 'Nm') ??
			textAt(entry, 'AddtlNtryInf'),
		account:
			textAt(parties, acctNode, 'Id', 'IBAN') ?? textAt(parties, acctNode, 'Id', 'Othr', 'Id')
	};
}

function parseStatement(stmt: XmlNode): ParsedStatement {
	const currency =
		textAt(stmt, 'Acct', 'Ccy') ??
		descendants(stmt, 'Amt').find((a) => a.attrs.Ccy)?.attrs.Ccy ??
		'EUR';

	const statement: ParsedStatement = {
		bank: 'camt053',
		format: 'camt053',
		accountNumber: textAt(stmt, 'Acct', 'Id', 'IBAN') ?? textAt(stmt, 'Acct', 'Id', 'Othr', 'Id'),
		currency,
		rows: []
	};

	for (const bal of childrenNamed(stmt, 'Bal')) {
		const code = balanceCode(bal);
		if (!code) continue;
		const value = amount(at(bal, 'Amt'), currency);
		if (!value) continue;
		// A balance carries its own direction: a negative balance is DBIT.
		const signedValue =
			(textAt(bal, 'CdtDbtInd') ?? 'CRDT').toUpperCase() === 'DBIT' ? -value.minor : value.minor;
		const date = isoDate(at(bal, 'Dt'));

		if (OPENING_CODES.has(code) && statement.openingBalanceMinor === undefined) {
			statement.openingBalanceMinor = signedValue;
			statement.periodStart = date;
		} else if (CLOSING_CODES.has(code)) {
			statement.closingBalanceMinor = signedValue;
			statement.periodEnd = date;
		}
		// OPAV/CLAV and every other code are deliberately ignored: an available
		// balance nets out reserved funds and cannot reconcile against bookings.
	}

	const summary = at(stmt, 'TxsSummry');
	if (summary) {
		const credits = amount(at(summary, 'TtlCdtNtries', 'Sum'), currency);
		const debits = amount(at(summary, 'TtlDbtNtries', 'Sum'), currency);
		if (credits) statement.statedCreditTotalMinor = credits.minor;
		if (debits) statement.statedDebitTotalMinor = debits.minor;
		const count = textAt(summary, 'TtlNtries', 'NbOfNtries');
		if (count && /^\d+$/.test(count)) statement.statedRowCount = Number(count);
	}

	for (const entry of childrenNamed(stmt, 'Ntry')) {
		const value = amount(at(entry, 'Amt'), currency);
		if (!value) continue;
		const sign = signOf(entry);
		const outgoing = sign < 0n;
		const party = counterparty(entry, outgoing);
		const booked = isoDate(at(entry, 'BookgDt'));
		const valued = isoDate(at(entry, 'ValDt'));
		if (!booked && !valued) continue;

		const details = descendants(entry, 'TxDtls')[0];
		const row: ParsedRow = {
			bookedAt: booked ?? valued!,
			valueDate: valued,
			amountMinor: sign * value.minor,
			currency: value.currency,
			counterparty: party.name,
			counterpartyAccount: party.account,
			bankRef:
				textAt(entry, 'AcctSvcrRef') ??
				textAt(details, 'Refs', 'AcctSvcrRef') ??
				textAt(details, 'Refs', 'EndToEndId'),
			description:
				textAt(details, 'RmtInf', 'Ustrd') ??
				textAt(entry, 'AddtlNtryInf') ??
				textAt(entry, 'BkTxCd', 'Prtry', 'Cd')
		};

		// Czech banks carry the payment symbols in structured remittance.
		const structured = at(details, 'RmtInf', 'Strd', 'CdtrRefInf');
		const reference = textAt(structured, 'Ref');
		if (reference && /^\d+$/.test(reference)) row.variableSymbol = reference;

		statement.rows.push(row);
	}

	return statement;
}

export function parseCamt053(source: string): ParsedStatement[] {
	const document = parseXml(source);
	const statements = descendants(document, 'Stmt');
	if (statements.length === 0) {
		throw new Error('That XML has no <Stmt> block, so it is not a CAMT.053 statement.');
	}
	return statements.map(parseStatement);
}
