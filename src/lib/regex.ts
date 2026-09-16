// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Several readers build a regular expression from data they were handed — a
 * currency symbol, a mark to count, a search term — and each has to escape it
 * first. An unescaped pattern usually doesn't throw; it silently matches the
 * wrong thing, which survives a test suite.
 */

/**
 * Escape every character a regular expression treats as syntax — the full
 * set, not a hand-picked few, since a partial escape can mean something
 * entirely different for input it wasn't tested against.
 */
export function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
