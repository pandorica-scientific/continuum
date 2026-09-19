// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { parseAmountSearch } from '$lib/transactions/amount-search';

const search = (term: string) => parseAmountSearch(term, 'CZK');

describe('reading an amount out of the search box', () => {
	it('reads a bare number as that exact amount', () => {
		expect(search('1100')).toEqual({ minMinor: 110000n, maxMinor: 110000n });
	});

	it('reads the decimals a ledger actually holds', () => {
		expect(search('249.10')).toEqual({ minMinor: 24910n, maxMinor: 24910n });
		expect(search('249,10')).toEqual({ minMinor: 24910n, maxMinor: 24910n });
	});

	it('accepts the thousands separators this app prints', () => {
		// The register writes 103'055.29, so what it shows must be searchable by
		// copying it back in.
		expect(search("1'100")).toEqual({ minMinor: 110000n, maxMinor: 110000n });
		expect(search('1 100')).toEqual({ minMinor: 110000n, maxMinor: 110000n });
	});

	it('reads a range written either way', () => {
		const expected = { minMinor: 10000n, maxMinor: 20000n };
		expect(search('100-200')).toEqual(expected);
		expect(search('100..200')).toEqual(expected);
		expect(search('100 - 200')).toEqual(expected);
	});

	it('reads a range written backwards as the range it obviously means', () => {
		expect(search('200-100')).toEqual({ minMinor: 10000n, maxMinor: 20000n });
	});

	it('reads open bounds, with the longer operator winning', () => {
		expect(search('>=1000')).toEqual({ minMinor: 100000n, maxMinor: null });
		expect(search('<=50')).toEqual({ minMinor: null, maxMinor: 5000n });
	});

	it('treats a strict bound as one minor unit off, since nothing sits between', () => {
		// "more than 1000" cannot include 1000, and the ledger holds no amount
		// between 1000.00 and 1000.01.
		expect(search('>1000')).toEqual({ minMinor: 100001n, maxMinor: null });
		expect(search('<1000')).toEqual({ minMinor: null, maxMinor: 99999n });
	});

	it('leaves ordinary text alone', () => {
		expect(search('Albert')).toBeNull();
		expect(search('')).toBeNull();
		expect(search('   ')).toBeNull();
		expect(search('DR. MAX')).toBeNull();
	});

	it('does not read a number buried in a name as an amount', () => {
		// The real ledger holds "POKLADNA 4 2", "Ceska posta 14000" and
		// "KAUFLAND CZ 33". Searching for those must search for those.
		expect(search('KAUFLAND CZ 33')).toBeNull();
		expect(search('Ceska posta 14000')).toBeNull();
		expect(search('Albert 5')).toBeNull();
	});

	it('leaves an account number and a date as text', () => {
		// Both would otherwise be mangled by the range rule.
		expect(search('7770227/0100')).toBeNull();
		expect(search('2026-03-25')).toBeNull();
	});

	it('leaves a half-written range as text rather than half a bound', () => {
		expect(search('100-')).toBeNull();
		expect(search('-200')).toBeNull();
		expect(search('>')).toBeNull();
	});

	it('is a magnitude, so the direction filter still decides the sign', () => {
		// Same contract as the Min and Max fields: a search for 1100 finds the
		// payment out and the credit in, and "Money out" narrows it.
		const out = search('1100');
		expect(out?.minMinor).toBe(110000n);
		expect(out?.minMinor).toBeGreaterThan(0n);
	});

	it('uses the currency it is given for the number of minor units', () => {
		// A zero-decimal currency: 1100 yen is 1100 minor units, not 110000.
		expect(parseAmountSearch('1100', 'JPY')).toEqual({ minMinor: 1100n, maxMinor: 1100n });
	});
});
