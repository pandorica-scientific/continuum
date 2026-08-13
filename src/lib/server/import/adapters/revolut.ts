import { parseAmountToMinor } from '$lib/money';
import { csvLines, splitCsvLine } from '../csv';
import type { ParsedRow, ParsedStatement } from '../types';

/**
 * Revolut account-statement CSV: comma-separated with a fixed header. There is
 * no bank-side reference, so the running Balance column joins the dedup
 * fingerprint to tell identical same-day payments apart.
 */
export function parseRevolut(text: string): ParsedStatement {
	const lines = csvLines(text.replace(/^\ufeff/, '')).filter((l) => l.trim());
	const header = splitCsvLine(lines[0], ',');
	const col = (name: string) => header.indexOf(name);
	const cType = col('Type');
	const cStarted = col('Started Date');
	const cCompleted = col('Completed Date');
	const cDescription = col('Description');
	const cAmount = col('Amount');
	const cFee = col('Fee');
	const cCurrency = col('Currency');
	const cState = col('State');
	const cBalance = col('Balance');
	if (cAmount === -1 || cCurrency === -1) throw new Error('Revolut: unexpected header');

	let currency = 'CZK';
	const rows: ParsedRow[] = [];
	for (const line of lines.slice(1)) {
		const cells = splitCsvLine(line, ',');
		if (cells.length < header.length) continue;
		if (cState !== -1 && cells[cState] !== 'COMPLETED') continue;
		currency = cells[cCurrency] || currency;
		const when = (cells[cCompleted] || cells[cStarted] || '').slice(0, 10);
		const amount = parseAmountToMinor(cells[cAmount], currency);
		const fee = cells[cFee] ? parseAmountToMinor(cells[cFee], currency) : 0n;
		rows.push({
			bookedAt: when,
			// Revolut reports fees separately; the balance moves by amount − fee.
			amountMinor: amount - fee,
			currency,
			counterparty: cells[cDescription]?.trim() || undefined,
			description: cells[cType]?.trim() || undefined,
			balanceAfterMinor: cells[cBalance] ? parseAmountToMinor(cells[cBalance], currency) : undefined
		});
	}

	const last = rows[rows.length - 1];
	return {
		bank: 'revolut',
		format: 'csv',
		currency,
		periodStart: rows[0]?.bookedAt,
		periodEnd: last?.bookedAt,
		closingBalanceMinor: last?.balanceAfterMinor,
		rows
	};
}
