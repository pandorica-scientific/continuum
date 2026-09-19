// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What a statement actually said about a row, for the rows whose displayed name
 * says nothing.
 *
 * Czech statements label a payment by its *method* — "okamžitá" (instant),
 * "QR Platba" (paid from a QR code), "Odchozí okamžitá úhrada" — and name the
 * payee nowhere at all. The row then reaches the review queue as "QR Platba",
 * which identifies the keypress rather than the money. The only thing that
 * identifies it is the destination account number and the variable symbol, both
 * of which the parser already stores and no screen was showing.
 *
 * This cannot be fixed in the parser: the name is not in the document. So it is
 * surfaced instead — the facts, verbatim, behind an (i) beside the name.
 */

export interface RowFacts {
	counterparty?: string | null;
	counterpartyAccount?: string | null;
	variableSymbol?: string | null;
	constantSymbol?: string | null;
	specificSymbol?: string | null;
	description?: string | null;
	bankRef?: string | null;
	originalAmountMinor?: bigint | null;
	originalCurrency?: string | null;
}

export interface DetailFact {
	label: string;
	value: string;
}

const clean = (value: string | null | undefined): string | null => {
	const text = (value ?? '').trim();
	return text.length > 0 ? text : null;
};

/**
 * The facts worth showing, in the order they identify a payment.
 *
 * The account number leads because it is the one thing that is the same every
 * month for the same payee — it is what turns "a thousand crowns to somebody"
 * into "the same recipient as last March". A fact already legible in the
 * displayed name is left out rather than repeated; the panel exists to add to
 * that line, not to restate it.
 */
export function identifyingDetail(facts: RowFacts, displayed?: string | null): DetailFact[] {
	const shown = clean(displayed);
	const out: DetailFact[] = [];
	const push = (label: string, value: string | null) => {
		if (!value) return;
		// A description that IS the displayed name adds nothing. Compared after
		// folding case and spacing, since the two reach here by different routes.
		if (shown && value.toLowerCase() === shown.toLowerCase()) return;
		out.push({ label, value });
	};

	push('To account', clean(facts.counterpartyAccount));
	push('Variable symbol', clean(facts.variableSymbol));
	push('Constant symbol', clean(facts.constantSymbol));
	push('Specific symbol', clean(facts.specificSymbol));
	push('On the statement', clean(facts.description));
	push('Bank reference', clean(facts.bankRef));

	// A card payment abroad: the row's own amount is in the account's currency,
	// and this is what the card was actually charged.
	const original = facts.originalAmountMinor;
	const currency = clean(facts.originalCurrency);
	if (original !== null && original !== undefined && currency) {
		out.push({ label: 'Charged', value: `${formatOriginal(original)} ${currency}` });
	}
	return out;
}

/**
 * Minor units to a plain decimal, without the money formatter.
 *
 * This module is pure and knows no currency table, and the figure here is
 * evidence rather than an amount to reason about — it is shown beside its own
 * code, so two decimals is enough for every currency that has them.
 */
function formatOriginal(minor: bigint): string {
	const negative = minor < 0n;
	const digits = (negative ? -minor : minor).toString().padStart(3, '0');
	const whole = digits.slice(0, -2);
	const fraction = digits.slice(-2);
	return `${negative ? '-' : ''}${whole}.${fraction}`;
}
