// SPDX-License-Identifier: AGPL-3.0-or-later
import { parseAmountToMinor } from '$lib/money';
import type { ParsedRow, ParsedStatement, PdfLine } from '../types';

// RB prints its dates two ways and has shipped both within three months: the
// January 2025 template writes "3.1.2025", March 2025 onwards "1. 3. 2025".
// Requiring the spaces read ZERO movements out of the January statement while
// still reporting success — the balances parsed, so the file imported empty,
// recorded its content hash, and the corrected re-import would then have been
// refused as a duplicate. The separator's whitespace is not evidence of
// anything; treat it as optional everywhere a date is read.
const DATE = /^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})$/;

function rbDate(raw: string): string | null {
	const m = raw.trim().match(DATE);
	if (!m) return null;
	return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

const AMOUNT = /^([-+]?[\d\s  ]+\.\d{2}) ([A-Z]{3})$/;

// The page header and the summary block RB repeats on every page. A movement's
// detail can never continue past one of these, so they close its window.
const PAGE_FURNITURE =
	/Výpis z běžného účtu|Číslo účtu:|Název účtu:|Pořadové č\. výpisu|poř\. č\.|Počáteční zůstatek|Konečný zůstatek|Příjmy celkem|Výdaje celkem|Poplatky celkem|Pohledávky po splatnosti|IBAN:|BIC:|za období|^Datum$|Kategorie transakce/;

function isPageFurniture(line: PdfLine): boolean {
	return PAGE_FURNITURE.test(line.cells.join(' '));
}

/**
 * Raiffeisenbank PDF statement ("Výpis z běžného účtu"). A movement's first
 * line is
 *   date | category | type | [VS] | amount "−1 000.00 CZK"
 * followed by its detail lines until the next dated movement line:
 *   valuta date | counter-account | [message]
 *   transaction code | [counterparty name] | [note]
 *   [merchant; city; country]
 * The detail lines come in no fixed number and no fixed order — a card payment
 * can push its "PK:" marker onto a line of its own — so each is found by shape
 * within the movement's own span, never at a counted offset.
 */
export function parseRbLines(lines: PdfLine[]): ParsedStatement {
	let accountNumber: string | undefined;
	let currency = 'CZK';
	let openingBalanceMinor: bigint | undefined;
	let closingBalanceMinor: bigint | undefined;
	let statedCreditTotalMinor: bigint | undefined;
	let statedDebitTotalMinor: bigint | undefined;
	let periodStart: string | undefined;
	let periodEnd: string | undefined;

	const flat = lines.map((l) => ({ ...l, text: l.cells.join(' ') }));

	for (const line of flat) {
		const acct = line.text.match(/Číslo účtu:\s*([\d-]+\/\d{4})\s*([A-Z]{3})?/);
		if (acct) {
			accountNumber = acct[1];
			if (acct[2]) currency = acct[2];
		}
		// Same two templates, same tolerance: January heads the page "poř. č. 1 za
		// období 1.1.2025 - 31.1.2025" — no colon and no spaces in the dates.
		const period = line.text.match(
			/za období:?\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})\s*-\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/
		);
		if (period) {
			periodStart = `${period[3]}-${period[2].padStart(2, '0')}-${period[1].padStart(2, '0')}`;
			periodEnd = `${period[6]}-${period[5].padStart(2, '0')}-${period[4].padStart(2, '0')}`;
		}
		const opening = line.text.match(/Počáteční zůstatek:\s*([-\d\s  ]+\.\d{2})/);
		if (opening) openingBalanceMinor = parseAmountToMinor(opening[1], currency);
		const closing = line.text.match(/Konečný zůstatek:\s*([-\d\s  ]+\.\d{2})/);
		if (closing) closingBalanceMinor = parseAmountToMinor(closing[1], currency);
		// Independent corroboration: two omitted movements that offset each other
		// leave opening/closing intact but cannot leave both of these intact.
		const credits = line.text.match(/Příjmy celkem:\s*([-\d\s  ]+\.\d{2})/);
		if (credits) statedCreditTotalMinor = parseAmountToMinor(credits[1], currency);
		const debits = line.text.match(/Výdaje celkem:\s*([-\d\s  ]+\.\d{2})/);
		if (debits) statedDebitTotalMinor = parseAmountToMinor(debits[1], currency);
	}

	// Collect movement start indices first, the way the ČS adapter does, so a
	// movement can own every line up to the next one. RB prints no fixed number
	// of continuation lines: the transaction code lands on the second, third or
	// fourth, and the merchant line after it. Reading them at a fixed stride
	// (code at i+2, merchant within i+3) lost the bank reference on a quarter
	// of a real statement's movements and the counterparty on nearly half —
	// rows that then match no counterparty rule and sit in review forever.
	const rows: ParsedRow[] = [];
	const starts: number[] = [];
	for (let i = 0; i < lines.length; i++) {
		const cells = lines[i].cells;
		if (cells.length < 3) continue;
		if (!rbDate(cells[0])) continue;
		// The amount is the last cell, "−1 000.00 CZK".
		if (!AMOUNT.test(cells[cells.length - 1])) continue;
		// Continuation lines (valuta date + KS/PK markers or the foreign
		// "original amount") also start with a date — a real movement's second
		// cell is a category name, never a symbol marker, number or account.
		if (/^(KS:|VS:|SS:|PK:)/.test(cells[1]) || /^[\d-]+(\/\d{4})?$/.test(cells[1])) continue;
		starts.push(i);
	}

	for (let s = 0; s < starts.length; s++) {
		const i = starts[s];
		const cells = lines[i].cells;
		const bookedAt = rbDate(cells[0])!;
		const amountMatch = cells[cells.length - 1].match(AMOUNT)!;
		// A movement owns the lines up to the next one — but the gap to the next
		// movement is not always its own detail. At a page break it spans the
		// footer and the following page's header, and after the last movement it
		// runs to the end of the file. The finders below are first-match-by-shape,
		// so an unstopped window let a footer's print date become a movement's
		// valuta date and a statement or contract number become its bankRef —
		// and bankRef decides the dedup fingerprint, so a statement whose page
		// breaks fell differently would import the same movement twice.
		const end = Math.min(s + 1 < starts.length ? starts[s + 1] : lines.length, i + 8);
		const detail: PdfLine[] = [];
		for (let j = i + 1; j < end; j++) {
			if (isPageFurniture(lines[j])) break;
			detail.push(lines[j]);
		}

		const rowCurrency = amountMatch[2];
		const kind = cells[1];
		const type = cells[2] && !cells[2].match(AMOUNT) ? cells[2] : undefined;
		// A VS cell is a bare number between the type and the amount.
		const vs =
			cells.length >= 5 && /^\d+$/.test(cells[cells.length - 2])
				? cells[cells.length - 2]
				: undefined;

		let counterpartyAccount: string | undefined;
		let counterparty: string | undefined;
		let bankRef: string | undefined;
		let merchant: string | undefined;
		let valueDate: string | undefined;
		let originalAmountMinor: bigint | undefined;
		let originalCurrency: string | undefined;

		// Valuta line: valuta date + counter-account, and for FX card payments
		// the original amount in the foreign currency as its last cell.
		const valuta = detail.find((l) => l.cells.length >= 1 && rbDate(l.cells[0]))?.cells;
		if (valuta) {
			valueDate = rbDate(valuta[0]) ?? undefined;
			const acc = valuta.find((c) => /^[\d-]+\/\d{4}$/.test(c));
			if (acc) counterpartyAccount = acc;
			const original = valuta[valuta.length - 1]?.match(AMOUNT);
			if (original && original[2] !== rowCurrency) {
				originalAmountMinor = parseAmountToMinor(original[1].replace('−', '-'), original[2]);
				originalCurrency = original[2];
			}
		}
		// Code line: 9-11 digit transaction code, optional counterparty name.
		const codeLine = detail.find((l) => /^\d{9,11}$/.test(l.cells[0] ?? ''))?.cells;
		if (codeLine) {
			bankRef = codeLine[0];
			const name = codeLine.slice(1).find((c) => !c.startsWith('PK:') && !c.startsWith('KS:'));
			if (name) counterparty = name;
		}
		// Optional merchant line: "ZOOPLUS; MUNCHEN; DEU".
		const merchantLine = detail.find((l) => /^[^|]+; .+; [A-Z]{3}$/.test(l.cells.join(' ')));
		if (merchantLine) merchant = merchantLine.cells.join(' ').split(';')[0].trim();

		rows.push({
			bookedAt,
			valueDate,
			amountMinor: parseAmountToMinor(amountMatch[1].replace('−', '-'), rowCurrency),
			currency: rowCurrency,
			originalAmountMinor,
			originalCurrency,
			counterparty: merchant ?? counterparty,
			counterpartyAccount,
			variableSymbol: vs,
			description: [kind, type].filter(Boolean).join(' · ') || undefined,
			bankRef
		});
	}

	return {
		bank: 'rb',
		// An adapter ran because the file identified this bank, so the issuer
		// is evidence here rather than a guess. Readers that cannot tell leave
		// it undefined; only this field may decide an account.
		issuer: 'rb',
		format: 'pdf',
		accountNumber,
		currency,
		periodStart,
		periodEnd,
		openingBalanceMinor,
		closingBalanceMinor,
		statedCreditTotalMinor,
		statedDebitTotalMinor,
		rows
	};
}
