import { parseAmountToMinor } from '$lib/money';
import { csvLines, splitCsvLine } from '../csv';
import type { ParsedRow, ParsedStatement } from '../types';

/**
 * Revolut account-statement CSV: comma-separated with a fixed header. There is
 * no bank-side reference, so the running Balance column joins the dedup
 * fingerprint to tell identical same-day payments apart.
 *
 * Fees are kept separate from the amount: the balance moves by amount − fee,
 * the counterparty sees the amount, and "what did Revolut charge me" stays
 * answerable. Started Date is the value date, Completed Date the booking date.
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

	// The statement's currency comes from the first completed row, not the
	// last — a stray row must not decide what account this file belongs to.
	let currency = '';
	const rows: ParsedRow[] = [];
	for (const line of lines.slice(1)) {
		const cells = splitCsvLine(line, ',');
		if (cells.length < header.length) continue;
		if (cState !== -1 && cells[cState] !== 'COMPLETED') continue;
		const rowCurrency = cells[cCurrency] || currency || 'CZK';
		if (!currency) currency = rowCurrency;
		const started = (cells[cStarted] || '').slice(0, 10);
		const completed = (cells[cCompleted] || started).slice(0, 10);
		const fee = cells[cFee] ? parseAmountToMinor(cells[cFee], rowCurrency) : 0n;
		rows.push({
			bookedAt: completed,
			valueDate: started || undefined,
			amountMinor: parseAmountToMinor(cells[cAmount], rowCurrency),
			feeMinor: fee !== 0n ? (fee < 0n ? -fee : fee) : undefined,
			currency: rowCurrency,
			counterparty: cells[cDescription]?.trim() || undefined,
			description: cells[cType]?.trim() || undefined,
			balanceAfterMinor: cells[cBalance]
				? parseAmountToMinor(cells[cBalance], rowCurrency)
				: undefined
		});
	}

	const last = rows[rows.length - 1];
	return {
		bank: 'revolut',
		// An adapter ran because the file identified this bank, so the issuer
		// is evidence here rather than a guess. Readers that cannot tell leave
		// it undefined; only this field may decide an account.
		issuer: 'revolut',
		format: 'csv',
		currency: currency || 'CZK',
		periodStart: rows[0]?.bookedAt,
		periodEnd: last?.bookedAt,
		closingBalanceMinor: last?.balanceAfterMinor,
		rows
	};
}
