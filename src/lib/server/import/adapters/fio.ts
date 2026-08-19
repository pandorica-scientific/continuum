// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { parseAmountToMinor } from '$lib/money';
import { csvLines, splitCsvLine } from '../csv';
import type { ParsedRow, ParsedStatement } from '../types';

function czDate(raw: string): string {
	const m = raw.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
	if (!m) throw new Error(`Fio: unparseable date "${raw}"`);
	return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/**
 * Fio banka CSV export from Internetbanking 2.0: quoted metadata lines, an
 * empty line, then a semicolon-separated table with a quoted header.
 */
export function parseFio(text: string): ParsedStatement {
	const lines = csvLines(text.replace(/^\ufeff/, ''));

	const accountMatch = lines[0]?.match(/z účtu\s+""?([\d-]+\/\d+)/);
	let currency = 'CZK';
	let openingBalanceMinor: bigint | undefined;
	let closingBalanceMinor: bigint | undefined;
	let statedCreditTotalMinor: bigint | undefined;
	let statedDebitTotalMinor: bigint | undefined;
	let periodStart: string | undefined;
	let periodEnd: string | undefined;

	let headerIndex = -1;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const period = line.match(/Období: (\d{2}\.\d{2}\.\d{4}) - (\d{2}\.\d{2}\.\d{4})/);
		if (period) {
			periodStart = czDate(period[1]);
			periodEnd = czDate(period[2]);
		}
		const opening = line.match(/Počáteční stav účtu[^:]*: ([-+\d\s,.]+) ([A-Z]{3})/);
		if (opening) {
			currency = opening[2];
			openingBalanceMinor = parseAmountToMinor(opening[1], currency);
		}
		const closing = line.match(/Koncový stav účtu[^:]*: ([-+\d\s,.]+) ([A-Z]{3})/);
		if (closing) {
			currency = closing[2];
			closingBalanceMinor = parseAmountToMinor(closing[1], currency);
		}
		// "Suma příjmů: +62652 CZK" / "Suma výdajů: -50050 CZK" — independent
		// corroboration Fio prints but we previously discarded. Fio never prints a
		// per-row running balance, so these are the only evidence beyond the two
		// endpoints that the row set is complete.
		const credits = line.match(/Suma příjmů:\s*([-+\d\s,.]+) ([A-Z]{3})/);
		if (credits) statedCreditTotalMinor = parseAmountToMinor(credits[1], credits[2]);
		const debits = line.match(/Suma výdajů:\s*([-+\d\s,.]+) ([A-Z]{3})/);
		if (debits) {
			const v = parseAmountToMinor(debits[1], debits[2]);
			statedDebitTotalMinor = v < 0n ? -v : v;
		}
		if (line.includes('"ID operace"') && line.includes('"Datum"')) {
			headerIndex = i;
			break;
		}
	}
	if (headerIndex === -1) throw new Error('Fio: transaction header not found');

	const header = splitCsvLine(lines[headerIndex], ';');
	const col = (name: string) => header.indexOf(name);
	const cId = col('ID operace');
	const cDate = col('Datum');
	const cAmount = col('Objem');
	const cCurrency = col('Měna');
	const cAccount = col('Protiúčet');
	const cAccountName = col('Název protiúčtu');
	const cBankCode = col('Kód banky');
	const cKs = col('KS');
	const cVs = col('VS');
	const cSs = col('SS');
	const cNote = col('Poznámka');
	const cMessage = col('Zpráva pro příjemce');
	const cType = col('Typ');

	const rows: ParsedRow[] = [];
	for (const line of lines.slice(headerIndex + 1)) {
		if (!line.trim()) continue;
		const cells = splitCsvLine(line, ';');
		// Fio drops trailing empty columns on some rows; require only the
		// columns the adapter actually reads.
		const lastNeeded = Math.max(cId, cDate, cAmount, cCurrency, cAccount, cVs, cType);
		if (cells.length <= lastNeeded) continue;
		const rowCurrency = cells[cCurrency]?.trim() || currency;
		const counterAccount = cells[cAccount]?.trim();
		const bankCode = cells[cBankCode]?.trim();
		rows.push({
			bookedAt: czDate(cells[cDate]),
			amountMinor: parseAmountToMinor(cells[cAmount], rowCurrency),
			currency: rowCurrency,
			counterparty: cells[cAccountName]?.trim() || cells[cNote]?.trim() || undefined,
			counterpartyAccount:
				counterAccount && bankCode ? `${counterAccount}/${bankCode}` : counterAccount || undefined,
			variableSymbol: cells[cVs]?.trim() || undefined,
			constantSymbol: cells[cKs]?.trim() || undefined,
			specificSymbol: cells[cSs]?.trim() || undefined,
			description:
				[cells[cType]?.trim(), cells[cMessage]?.trim()].filter(Boolean).join(' · ') || undefined,
			bankRef: cells[cId]?.trim() || undefined
		});
	}

	return {
		bank: 'fio',
		// An adapter ran because the file identified this bank, so the issuer
		// is evidence here rather than a guess. Readers that cannot tell leave
		// it undefined; only this field may decide an account.
		issuer: 'fio',
		format: 'csv',
		accountNumber: accountMatch?.[1],
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
