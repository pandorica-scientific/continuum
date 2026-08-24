// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';
import { normaliseTaxView } from '$lib/tax';

const PEOPLE = ['p1', 'p2'];
const CURRENCIES = ['CZK', 'EUR'];
const BASE = 'EUR';

describe('normaliseTaxView', () => {
	it('accepts a whole valid preference', () => {
		expect(
			normaliseTaxView({ mode: 'rate', currency: 'CZK', person: 'p2' }, PEOPLE, CURRENCIES, BASE)
		).toEqual({ mode: 'rate', currency: 'CZK', person: 'p2' });
	});

	it('falls back rather than storing a mode that does not exist', () => {
		expect(
			normaliseTaxView({ mode: 'pie', currency: 'EUR', person: 'both' }, PEOPLE, CURRENCIES, BASE)
				.mode
		).toBe('stack');
	});

	it('refuses a currency the household cannot convert', () => {
		// The column is jsonb and stores whatever it is handed, so nothing posted
		// is trusted — the same reasoning as the overview layout endpoint.
		expect(
			normaliseTaxView({ mode: 'stack', currency: 'XYZ', person: 'both' }, PEOPLE, CURRENCIES, BASE)
				.currency
		).toBe('EUR');
	});

	it('refuses a person id that is not in the household', () => {
		expect(
			normaliseTaxView(
				{ mode: 'stack', currency: 'EUR', person: 'stranger' },
				PEOPLE,
				CURRENCIES,
				BASE
			).person
		).toBe('both');
	});

	it('keeps both, which is not a person id but is a valid selection', () => {
		expect(
			normaliseTaxView({ mode: 'stack', currency: 'EUR', person: 'both' }, PEOPLE, CURRENCIES, BASE)
				.person
		).toBe('both');
	});

	it('survives a body that is not an object at all', () => {
		expect(normaliseTaxView(null, PEOPLE, CURRENCIES, BASE)).toEqual({
			mode: 'stack',
			currency: 'EUR',
			person: 'both'
		});
		expect(normaliseTaxView('nonsense', PEOPLE, CURRENCIES, BASE).mode).toBe('stack');
	});

	it('falls back to the household currency, not the head of an alphabetical list', () => {
		// currencies[0] here is CZK. Falling back to it displayed a EUR
		// household's whole record in koruna — every figure multiplied by the
		// CZK rate, and nothing on screen saying so.
		expect(normaliseTaxView(null, PEOPLE, CURRENCIES, BASE).currency).toBe('EUR');
	});

	it('offers the household currency even before the rate table quotes it', () => {
		// The base currency has no rate of its own — it IS the rate — so it can
		// legitimately be absent from availableCurrencies().
		expect(normaliseTaxView({ currency: 'EUR' }, PEOPLE, ['CZK'], 'EUR').currency).toBe('EUR');
	});

	it('survives a household with no rates at all', () => {
		expect(normaliseTaxView(null, PEOPLE, [], BASE).currency).toBe('EUR');
	});
});
