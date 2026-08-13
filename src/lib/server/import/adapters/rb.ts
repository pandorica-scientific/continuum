import { parseAmountToMinor } from '$lib/money';
import type { ParsedRow, ParsedStatement, PdfLine } from '../types';

const DATE = /^(\d{1,2})\. (\d{1,2})\. (\d{4})$/;

function rbDate(raw: string): string | null {
	const m = raw.trim().match(DATE);
	if (!m) return null;
	return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

const AMOUNT = /^([-+]?[\d\s  ]+\.\d{2}) ([A-Z]{3})$/;

/**
 * Raiffeisenbank PDF statement ("Výpis z běžného účtu"). Each movement spans
 * three stacked lines plus an optional merchant line:
 *   date | category | type | [VS] | amount "−1 000.00 CZK"
 *   valuta date | counter-account | [message]
 *   transaction code | [counterparty name] | [note]
 *   [merchant; city; country]
 */
export function parseRbLines(lines: PdfLine[]): ParsedStatement {
	let accountNumber: string | undefined;
	let currency = 'CZK';
	let openingBalanceMinor: bigint | undefined;
	let closingBalanceMinor: bigint | undefined;
	let periodStart: string | undefined;
	let periodEnd: string | undefined;

	const flat = lines.map((l) => ({ ...l, text: l.cells.join(' ') }));

	for (const line of flat) {
		const acct = line.text.match(/Číslo účtu:\s*([\d-]+\/\d{4})\s*([A-Z]{3})?/);
		if (acct) {
			accountNumber = acct[1];
			if (acct[2]) currency = acct[2];
		}
		const period = line.text.match(
			/za období:\s*(\d{1,2})\. (\d{1,2})\. (\d{4}) - (\d{1,2})\. (\d{1,2})\. (\d{4})/
		);
		if (period) {
			periodStart = `${period[3]}-${period[2].padStart(2, '0')}-${period[1].padStart(2, '0')}`;
			periodEnd = `${period[6]}-${period[5].padStart(2, '0')}-${period[4].padStart(2, '0')}`;
		}
		const opening = line.text.match(/Počáteční zůstatek:\s*([-\d\s  ]+\.\d{2})/);
		if (opening) openingBalanceMinor = parseAmountToMinor(opening[1], currency);
		const closing = line.text.match(/Konečný zůstatek:\s*([-\d\s  ]+\.\d{2})/);
		if (closing) closingBalanceMinor = parseAmountToMinor(closing[1], currency);
	}

	const rows: ParsedRow[] = [];
	for (let i = 0; i < lines.length; i++) {
		const cells = lines[i].cells;
		if (cells.length < 3) continue;
		const bookedAt = rbDate(cells[0]);
		if (!bookedAt) continue;
		// The amount is the last cell, "−1 000.00 CZK".
		const amountMatch = cells[cells.length - 1].match(AMOUNT);
		if (!amountMatch) continue;
		// Continuation lines (valuta date + KS/PK markers or the foreign
		// "original amount") also start with a date — a real movement's second
		// cell is a category name, never a symbol marker, number or account.
		if (/^(KS:|VS:|SS:|PK:)/.test(cells[1]) || /^[\d-]+(\/\d{4})?$/.test(cells[1])) continue;

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

		// Second line: valuta date + counter-account, and for FX card payments
		// the original amount in the foreign currency as its last cell.
		const second = lines[i + 1]?.cells ?? [];
		if (second.length >= 1 && rbDate(second[0])) {
			valueDate = rbDate(second[0]) ?? undefined;
			const acc = second.find((c) => /^[\d-]+\/\d{4}$/.test(c));
			if (acc) counterpartyAccount = acc;
			const original = second[second.length - 1]?.match(AMOUNT);
			if (original && original[2] !== rowCurrency) {
				originalAmountMinor = parseAmountToMinor(original[1].replace('−', '-'), original[2]);
				originalCurrency = original[2];
			}
		}
		// Third line: 10-digit transaction code, optional counterparty name.
		const third = lines[i + 2]?.cells ?? [];
		const codeLine = /^\d{9,11}$/.test(third[0] ?? '') ? third : second;
		if (/^\d{9,11}$/.test(codeLine[0] ?? '')) {
			bankRef = codeLine[0];
			const name = codeLine.slice(1).find((c) => !c.startsWith('PK:') && !c.startsWith('KS:'));
			if (name) counterparty = name;
		}
		// Optional merchant line: "ZOOPLUS; MUNCHEN; DEU".
		for (let j = i + 1; j <= i + 3 && j < lines.length; j++) {
			const text = lines[j].cells.join(' ');
			if (/^[^|]+; .+; [A-Z]{3}$/.test(text)) {
				merchant = text.split(';')[0].trim();
				break;
			}
		}

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
		format: 'pdf',
		accountNumber,
		currency,
		periodStart,
		periodEnd,
		openingBalanceMinor,
		closingBalanceMinor,
		rows
	};
}
