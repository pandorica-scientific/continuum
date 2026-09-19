// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Reading an amount out of the register's search box.
 *
 * The Filters panel has always had Min and Max, which is the same question
 * asked properly — but it is a panel you have to open, fill in two fields of
 * and then empty again, and "what was that twelve hundred crown thing" is a
 * search, not a configuration. So the search box answers it too.
 *
 * Deliberately a very small language, because it shares a box with free text
 * and anything clever here would swallow a counterparty's name:
 *
 *   1100          exactly that much, either direction
 *   100-200       between the two, inclusive
 *   100..200      the same, for anyone who writes ranges that way
 *   >1000         more than
 *   <=50          at most
 *
 * Anything else is text, including a bare word, a date and an account number.
 * A term that IS an amount stays text as well — the caller matches either, so
 * typing an invoice number that looks like a sum still finds the invoice.
 */

import { parseAmountToMinor } from '$lib/money';

export interface AmountSearch {
	/** Inclusive lower bound in minor units of the currency asked for, if any. */
	minMinor: bigint | null;
	/** Inclusive upper bound, if any. */
	maxMinor: bigint | null;
}

/** Parsed, or null when the piece is not a number this currency can hold. */
function amount(raw: string, currency: string): bigint | null {
	const text = raw.trim();
	if (!text) return null;
	// Reject anything that is not digits and separators before handing it over:
	// `parseAmountToMinor` is lenient by design (it reads what a bank printed),
	// and a search box needs the opposite — "Albert 5" must stay text.
	if (!/^[\d][\d\s'.,]*$/.test(text)) return null;
	try {
		const minor = parseAmountToMinor(text, currency);
		// A magnitude: which direction it went is the direction filter's job,
		// exactly as it is for the Min and Max fields.
		return minor < 0n ? -minor : minor;
	} catch {
		return null;
	}
}

/**
 * The bounds a search term asks for, or null when it asks for none.
 *
 * `currency` is the household's base currency, because that is what the stored
 * bounds are compared in — the same contract the Min and Max fields carry.
 */
export function parseAmountSearch(term: string, currency: string): AmountSearch | null {
	const text = term.trim();
	if (!text) return null;

	// An open bound. `>=` and `<=` before `>` and `<`, or the longer form is
	// read as the shorter one with a stray `=` left over.
	const open = /^(>=|<=|>|<)\s*(.+)$/.exec(text);
	if (open) {
		const value = amount(open[2], currency);
		if (value === null) return null;
		switch (open[1]) {
			case '>=':
				return { minMinor: value, maxMinor: null };
			case '<=':
				return { minMinor: null, maxMinor: value };
			case '>':
				// Strictly more than, in whole minor units: the ledger has no
				// finer amount, so "more than 1000" is "at least 1000.01".
				return { minMinor: value + 1n, maxMinor: null };
			default:
				return { minMinor: null, maxMinor: value - 1n };
		}
	}

	// A range. `..` first, then a hyphen — and the hyphen only between two
	// numbers, so a negative amount or a dashed reference is not mistaken for
	// one. A thousands separator is never a hyphen in any locale this formats
	// for, so splitting on it is safe.
	const range = /^(.+?)\s*(?:\.\.|-)\s*(.+)$/.exec(text);
	if (range) {
		const low = amount(range[1], currency);
		const high = amount(range[2], currency);
		if (low === null || high === null) return null;
		// Written backwards is still a range, and reading it as one is kinder
		// than returning nothing for an obvious typo.
		return low <= high ? { minMinor: low, maxMinor: high } : { minMinor: high, maxMinor: low };
	}

	const exact = amount(text, currency);
	if (exact === null) return null;
	return { minMinor: exact, maxMinor: exact };
}
