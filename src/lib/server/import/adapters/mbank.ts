import { parseAmountToMinor } from '$lib/money';
import { csvLines, splitCsvLine } from '../csv';
import type { ParsedRow, ParsedStatement } from '../types';

/**
 * mBank (Polska) "elektroniczne zestawienie operacji" CSV: windows-1250
 * encoded (decoded before this adapter runs), semicolon-separated, metadata
 * lines prefixed with #, transactions between the `#Data księgowania` header
 * and the `#Saldo końcowe` footer. Rows carry a running balance.
 */
export function parseMbank(text: string): ParsedStatement {
	const lines = csvLines(text);

	let currency = 'PLN';
	let accountNumber: string | undefined;
	let openingBalanceMinor: bigint | undefined;
	let closingBalanceMinor: bigint | undefined;
	let statedCreditTotalMinor: bigint | undefined;
	let statedDebitTotalMinor: bigint | undefined;
	let creditCount: number | undefined;
	let debitCount: number | undefined;
	let periodStart: string | undefined;
	let periodEnd: string | undefined;

	let headerIndex = -1;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line.startsWith('#Waluta')) {
			// mBank prints the label on one line and the value on the next, but a
			// same-line `#Waluta;PLN` is just as common elsewhere. Either way the
			// value has to LOOK like a currency: this used to take whatever came
			// next verbatim, and a file whose next line was another label imported
			// with a currency of "#Numer rachunku" — a column heading, filed as
			// the denomination of someone's money.
			const candidate = [lines[i + 1]?.split(';')[0], line.split(/[;,]/)[1]]
				.map((value) => value?.trim().toUpperCase())
				.find((value) => value && /^[A-Z]{3}$/.test(value));
			if (candidate) currency = candidate;
		}
		if (line.startsWith('#Numer rachunku'))
			accountNumber = lines[i + 1]?.split(';')[0]?.trim() || undefined;
		if (line.startsWith('#Za okres:')) {
			const m = lines[i + 1]?.match(/(\d{2})\.(\d{2})\.(\d{4});(\d{2})\.(\d{2})\.(\d{4})/);
			if (m) {
				periodStart = `${m[3]}-${m[2]}-${m[1]}`;
				periodEnd = `${m[6]}-${m[5]}-${m[4]}`;
			}
		}
		const opening = line.match(/#Saldo początkowe;([-\d\s,.]+) ([A-Z]{3})/);
		if (opening) openingBalanceMinor = parseAmountToMinor(opening[1], opening[2]);
		// mBank is the only sampled bank printing a COUNT per direction as well as
		// a value: "Uznania;2;310,00 PLN". The count is the strongest single check
		// against a dropped row, and costs nothing to read.
		const credits = line.match(/Uznania;(\d+);([-\d\s,.]+) ([A-Z]{3})/);
		if (credits) {
			statedCreditTotalMinor = parseAmountToMinor(credits[2], credits[3]);
			creditCount = Number(credits[1]);
		}
		const debits = line.match(/Obciążenia;(\d+);([-\d\s,.]+) ([A-Z]{3})/);
		if (debits) {
			statedDebitTotalMinor = parseAmountToMinor(debits[2], debits[3]);
			debitCount = Number(debits[1]);
		}
		const closing = line.match(/#Saldo końcowe;([-\d\s,.]+) ([A-Z]{3})/);
		if (closing) closingBalanceMinor = parseAmountToMinor(closing[1], closing[2]);
		if (line.startsWith('#Data księgowania')) headerIndex = i;
	}
	if (headerIndex === -1) throw new Error('mBank: transaction header not found');

	const rows: ParsedRow[] = [];
	for (const line of lines.slice(headerIndex + 1)) {
		if (!line.trim() || line.startsWith('#') || line.startsWith(';')) continue;
		const cells = splitCsvLine(line, ';');
		// Data księgowania;Data operacji;Opis operacji;Tytuł;Nadawca/Odbiorca;Numer konta;Kwota;Saldo po operacji;
		if (cells.length < 8) continue;
		if (!/^\d{4}-\d{2}-\d{2}$/.test(cells[0])) continue;
		const title = cells[3]?.trim().replace(/\s+/g, ' ');
		const party = cells[4]?.trim().replace(/\s+/g, ' ').replace(/^"|"$/g, '');
		const accountRaw = cells[5]?.trim().replace(/^'+|'+$/g, '');
		rows.push({
			bookedAt: cells[0],
			valueDate: /^\d{4}-\d{2}-\d{2}$/.test(cells[1]) ? cells[1] : undefined,
			amountMinor: parseAmountToMinor(cells[6], currency),
			currency,
			counterparty: party && party !== '' ? party : title || undefined,
			counterpartyAccount: accountRaw || undefined,
			description: [cells[2]?.trim(), title].filter(Boolean).join(' · ') || undefined,
			balanceAfterMinor: cells[7] ? parseAmountToMinor(cells[7], currency) : undefined
		});
	}

	return {
		bank: 'mbank',
		format: 'csv',
		accountNumber,
		currency,
		periodStart,
		periodEnd,
		openingBalanceMinor,
		closingBalanceMinor,
		statedCreditTotalMinor,
		statedDebitTotalMinor,
		statedRowCount:
			creditCount !== undefined && debitCount !== undefined ? creditCount + debitCount : undefined,
		rows
	};
}
