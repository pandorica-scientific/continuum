// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Building a pattern out of data.
 *
 * Several readers construct a regular expression from a value they were handed
 * — a currency symbol, a mark to count, a term to search for — and every one of
 * them has to escape it first. A pattern assembled from unescaped data does not
 * usually throw: it silently matches the wrong thing, or matches nothing, which
 * is the failure mode that survives a test suite.
 */

/**
 * Escape every character a regular expression treats as syntax.
 *
 * The full set, not a hand-picked few. `statement.ts` escaped `$` alone while
 * reading currency symbols, which was correct for the symbols it happened to
 * carry and one backslash away from a pattern that means something else
 * entirely — the kind of thing static analysis finds and review does not.
 *
 * `$&` in the replacement is the matched character itself, so each one is
 * passed through with a backslash in front of it.
 */
export function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
