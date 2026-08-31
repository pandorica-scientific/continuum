// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What each column role is called when a person is asked to choose it.
 *
 * The mapping wizard asks one question — "what is this column?" — and it has to
 * be answerable by someone holding their own bank statement, not by someone who
 * has read the parser. So these are the words a statement uses, not the words
 * the code uses.
 *
 * The order is the order they are offered in, and it is the order the columns
 * usually appear in: the two that decide whether a statement can be read at all
 * come first.
 */
export const ROLE_CHOICES: { value: string; label: string; hint?: string }[] = [
	{ value: 'bookingDate', label: 'Date', hint: 'when the bank booked it' },
	{ value: 'amount', label: 'Amount', hint: 'one column, negative for money out' },
	{ value: 'debit', label: 'Money out', hint: 'when in and out are separate columns' },
	{ value: 'credit', label: 'Money in', hint: 'when in and out are separate columns' },
	{ value: 'balance', label: 'Balance after', hint: 'the running balance' },
	{ value: 'valueDate', label: 'Value date' },
	{ value: 'counterparty', label: 'Who it was with' },
	{ value: 'description', label: 'Description' },
	{ value: 'counterpartyAccount', label: 'Their account number' },
	{ value: 'reference', label: 'Reference' },
	{ value: 'currency', label: 'Currency' },
	{ value: 'variableSymbol', label: 'Variable symbol' },
	{ value: 'constantSymbol', label: 'Constant symbol' },
	{ value: 'specificSymbol', label: 'Specific symbol' }
];

export const DATE_ORDER_CHOICES = [
	{ value: 'day-first', label: 'Day first — 31/12/2026' },
	{ value: 'month-first', label: 'Month first — 12/31/2026' },
	{ value: 'year-first', label: 'Year first — 2026-12-31' }
];

export const DECIMAL_CHOICES = [
	{ value: '.', label: 'Point — 1,234.56' },
	{ value: ',', label: 'Comma — 1.234,56' }
];
