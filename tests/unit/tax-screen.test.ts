// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Section order is the redesign's whole argument: the band answers "how much,
// overall", the chart "what is the shape", the matrix "which year, which
// country". Each is more specific than the one above it, and the person filter
// sits between the band and the chart because it governs everything below it
// and nothing above.
import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import Page from '../../src/routes/(app)/tax/+page.svelte';

vi.mock('$app/state', () => ({
	page: { data: {}, url: new URL('http://localhost/tax') }
}));

const data = {
	baseCurrency: 'EUR',
	currencies: ['EUR', 'CZK'],
	displayCurrencies: ['EUR', 'CZK'],
	people: [
		{ id: 'p1', name: 'Robert' },
		{ id: 'p2', name: 'Jana' }
	],
	taxDocs: [],
	prefillTotals: {},
	prefs: { mode: 'stack' as const, currency: 'EUR', person: 'both' },
	countries: [{ code: 'CZ', name: 'Czechia', token: '--series-health-soft' }],
	flaggedThreshold: '0',
	blendedRatePct: 15,
	years: [
		{
			year: 2025,
			grossMinor: '10000000',
			taxMinor: '1500000',
			ratePct: 15,
			byCountry: [
				{
					country: 'CZ',
					grossMinor: '10000000',
					taxMinor: '1500000',
					ratePct: 15,
					native: [{ currency: 'CZK', grossMinor: '250000000', taxMinor: '37500000' }]
				}
			]
		}
	],
	statements: []
};

// The page also receives the layout's own data (theme, modules, version …),
// which nothing on this screen reads. Casting keeps the fixture to the fields
// under test rather than restating a layout contract that is not the subject.
const props = { data, form: null } as unknown as Record<string, unknown>;

describe('the tax screen', () => {
	it('puts the person control between the band and the chart', () => {
		const { body } = render(Page, { props: props as never });
		expect(body.indexOf('Earned since')).toBeLessThan(body.indexOf('Jana'));
		expect(body.indexOf('Jana')).toBeLessThan(body.indexOf('Tax year'));
	});

	it('puts the chart above the matrix', () => {
		const { body } = render(Page, { props: props as never });
		expect(body.indexOf('Tax year')).toBeLessThan(body.indexOf('Year total'));
	});

	it('offers Both alongside each filer', () => {
		const { body } = render(Page, { props: props as never });
		expect(body).toContain('Both');
		expect(body).toContain('Robert');
		expect(body).toContain('Jana');
	});

	it('hides the person control in a one-filer household', () => {
		// A single pill is a label pretending to be a choice.
		const { body } = render(Page, {
			props: { ...props, data: { ...data, people: [{ id: 'p1', name: 'Robert' }] } } as never
		});
		expect(body).not.toContain('Both');
	});

	it('puts Add statement in the header, not in a toolbar below it', () => {
		const { body } = render(Page, { props: props as never });
		expect(body).toContain('Add statement');
		expect(body.indexOf('Add statement')).toBeLessThan(body.indexOf('Earned since'));
	});

	it('keeps the band household-wide even when a filer is selected', () => {
		// The band sits ABOVE the control, so it must not answer to it.
		const filtered = { ...data, prefs: { ...data.prefs, person: 'p2' } };
		const { body } = render(Page, { props: { ...props, data: filtered } as never });
		expect(body).toContain('Earned since 2025');
	});

	it('says so plainly when nothing has been filed', () => {
		const empty = { ...data, years: [], statements: [] };
		const { body } = render(Page, { props: { ...props, data: empty } as never });
		expect(body).toContain('No statements yet');
	});
});
