// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Telling a portfolio statement from a bank statement.
 *
 * A holdings snapshot lists what you own; a bank statement lists money moving.
 * Both print balances, which is why the difference has to be stated rather than
 * assumed — Robinhood's monthly document shows an opening and closing balance
 * and not one transaction, because it says outright that the transactions live
 * in the mobile app.
 *
 * Feeding it to the ledger cannot work: the change between its two balances is
 * market movement, not booked movements, so it can never reconcile. Refusing it
 * with "no transactions found" would be true and useless. Naming what it is
 * lets us offer the thing the person actually wants.
 */
import { normalise } from './tabular/vocabulary';

const PORTFOLIO_TERMS = [
	'portfolio',
	'positions',
	'holdings',
	'assets held',
	'market value',
	'quantity',
	'shares',
	'cartera',
	'posiciones',
	'depotauszug',
	'bestand',
	'wertpapier',
	'cenne papiry',
	'portfolio positions'
];

const BALANCE_TERMS = [
	'opening balance',
	'closing balance',
	'saldo',
	'zustatek',
	'kontostand',
	'balance'
];

const DATE_AND_AMOUNT =
	/(?:\d{4}-\d{2}-\d{2}|\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4})[\s\S]{0,120}?[-(]?\d[\d\s.,']*[.,]\d{2}/;

interface HoldingsVerdict {
	isHoldings: boolean;
	/** Why, phrased for the person who uploaded it. */
	reason?: string;
}

/**
 * Decide from the document's own text.
 *
 * The test is deliberately conjunctive: portfolio vocabulary AND balances AND
 * almost no dated amounts. A bank statement full of share purchases mentions
 * "quantity" too, and must not be diverted.
 */
export function looksLikeHoldings(text: string): HoldingsVerdict {
	const key = normalise(text);
	const portfolio = PORTFOLIO_TERMS.filter((t) => key.includes(t));
	if (portfolio.length === 0) return { isHoldings: false };

	const hasBalances = BALANCE_TERMS.some((t) => key.includes(t));
	if (!hasBalances) return { isHoldings: false };

	// Count lines that carry a date AND a money amount — the shape of a movement.
	const movementish = text.split(/\r?\n/).filter((line) => DATE_AND_AMOUNT.test(line)).length;
	if (movementish >= 3) return { isHoldings: false };

	return {
		isHoldings: true,
		reason:
			'This looks like a portfolio statement: it lists what the account holds rather than money moving in and out, so there is nothing to file into the ledger.'
	};
}
