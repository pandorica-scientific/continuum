// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
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
 *
 * ONE STATEMENT PER POCKET. Revolut writes every pocket into the same file and
 * tells them apart only by the Product column, and each pocket keeps its own
 * running balance. Read as a single statement, a file holding 1798 Current rows
 * and three Savings rows proved P0 — "the running balance does not follow from
 * the movements" — because one chain was being checked against two accounts'
 * balances, and the closing balance came from whichever pocket happened to be
 * written last. The Savings rows also carried dates two years earlier, so the
 * period read June 2024 for a July 2026 statement. Split by pocket, the same
 * file proves P3 on all 1798 rows.
 */
export function parseRevolut(text: string): ParsedStatement[] {
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

	const cProduct = col('Product');

	// Keyed by pocket, then by currency: a multi-currency pocket keeps a chain
	// per currency too, for the same reason. A file with neither column still
	// works — everything lands in one group, which is what it was before.
	const pockets = new Map<string, { currency: string; rows: ParsedRow[] }>();

	for (const line of lines.slice(1)) {
		const cells = splitCsvLine(line, ',');
		if (cells.length < header.length) continue;
		// A reverted payment never moved money and carries no balance, so it
		// belongs to no chain.
		if (cState !== -1 && cells[cState] !== 'COMPLETED') continue;

		const rowCurrency = cells[cCurrency] || 'CZK';
		const product = (cProduct === -1 ? '' : cells[cProduct]?.trim()) || 'Current';
		const key = `${product}\u0000${rowCurrency}`;
		const pocket = pockets.get(key) ?? { currency: rowCurrency, rows: [] };
		if (!pockets.has(key)) pockets.set(key, pocket);

		const started = (cells[cStarted] || '').slice(0, 10);
		const completed = (cells[cCompleted] || started).slice(0, 10);
		const fee = cells[cFee] ? parseAmountToMinor(cells[cFee], rowCurrency) : 0n;
		pocket.rows.push({
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

	return [...pockets.values()]
		.filter((pocket) => pocket.rows.length > 0)
		.map((pocket) => {
			const last = pocket.rows[pocket.rows.length - 1];
			return {
				bank: 'revolut',
				// An adapter ran because the file identified this bank, so the issuer
				// is evidence here rather than a guess. Readers that cannot tell leave
				// it undefined; only this field may decide an account.
				issuer: 'revolut',
				format: 'csv' as const,
				currency: pocket.currency,
				periodStart: pocket.rows[0]?.bookedAt,
				periodEnd: last?.bookedAt,
				closingBalanceMinor: last?.balanceAfterMinor,
				rows: pocket.rows
			};
		});
}
