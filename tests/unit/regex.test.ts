// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { escapeRegExp } from '$lib/regex';

/**
 * Patterns built out of data.
 *
 * The statement reader assembles a regular expression from a currency symbol.
 * A wrong escape fails silently, because a regex that matches the wrong thing
 * does not throw.
 */
describe('escapeRegExp', () => {
	it('escapes every character a pattern treats as syntax', () => {
		const pattern = new RegExp(escapeRegExp('.*+?^${}()|[]\\'));
		expect(pattern.test('.*+?^${}()|[]\\')).toBe(true);
		// The point: as syntax it would match almost anything instead.
		expect(pattern.test('anything else')).toBe(false);
	});

	it('leaves an ordinary currency symbol matchable', () => {
		for (const symbol of ['€', 'Kč', 'zł', 'Ft', '£', '$']) {
			expect(new RegExp(escapeRegExp(symbol)).test(`1 234 ${symbol}`)).toBe(true);
		}
	});

	it('makes a backslash match a backslash, not an escape', () => {
		// Regression: `$`-only escaping left this one through.
		expect(new RegExp(escapeRegExp('\\d')).test('\\d')).toBe(true);
		expect(new RegExp(escapeRegExp('\\d')).test('7')).toBe(false);
	});
});
