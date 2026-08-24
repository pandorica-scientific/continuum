// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import TaxSummaryBand from '$lib/components/TaxSummaryBand.svelte';

const years = [
	{
		year: 2024,
		grossMinor: '10000000',
		taxMinor: '1500000',
		ratePct: 15,
		byCountry: [{ country: 'CZ' }]
	},
	{
		year: 2025,
		grossMinor: '12000000',
		taxMinor: '2400000',
		ratePct: 20,
		byCountry: [{ country: 'CZ' }, { country: 'DE' }]
	}
];

describe('the tax summary band', () => {
	it('names the first year it has a record for', () => {
		const { body } = render(TaxSummaryBand, { props: { years, currency: 'EUR' } });
		expect(body).toContain('Earned since 2024');
	});

	it('counts distinct jurisdictions across the whole record, not per year', () => {
		// 2025 has two and 2024 has one; the band counts the union, not a maximum
		// and not a sum. Whitespace-collapsed because the template wraps.
		const { body } = render(TaxSummaryBand, { props: { years, currency: 'EUR' } });
		expect(body.replace(/\s+/g, ' ')).toContain('across 2 jurisdictions');
	});

	it('blends the rate by income rather than averaging the years', () => {
		// (1 500 000 + 2 400 000) / (10 000 000 + 12 000 000) = 17.72%.
		// The mean of 15 and 20 is 17.50, which is a different and wrong number.
		const { body } = render(TaxSummaryBand, { props: { years, currency: 'EUR' } });
		expect(body).toContain('17.72');
		expect(body).not.toContain('17.50');
	});

	it('says the figures are declared, not estimated', () => {
		const { body } = render(TaxSummaryBand, { props: { years, currency: 'EUR' } });
		expect(body).toContain('declared, not estimated');
	});

	it('shows the latest year and how it moved', () => {
		const { body } = render(TaxSummaryBand, { props: { years, currency: 'EUR' } });
		expect(body).toContain('Latest year · 2025');
		expect(body).toContain('on 2024');
	});

	it('says so plainly when there is only one year to compare against nothing', () => {
		const { body } = render(TaxSummaryBand, { props: { years: [years[0]], currency: 'EUR' } });
		expect(body).toContain('the first year on record');
	});

	it('renders nothing rather than a row of dashes when there are no filings', () => {
		const { body } = render(TaxSummaryBand, { props: { years: [], currency: 'EUR' } });
		expect(body).not.toContain('Earned since');
	});

	it('sums in minor units, so a large record does not drift', () => {
		// Values past Number.MAX_SAFE_INTEGER in minor units: summed as floats
		// these lose their last digits silently.
		const big = [
			{
				year: 2024,
				grossMinor: '9007199254740993',
				taxMinor: '0',
				ratePct: 0,
				byCountry: [{ country: 'CZ' }]
			},
			{
				year: 2025,
				grossMinor: '1',
				taxMinor: '0',
				ratePct: 0,
				byCountry: [{ country: 'CZ' }]
			}
		];
		const { body } = render(TaxSummaryBand, { props: { years: big, currency: 'EUR' } });
		// Exact to the last minor unit. Summed as floats this lands on …409.92.
		// Intl groups with a narrow no-break space, so compare on digits alone.
		expect(body.replace(/[\s\u00a0\u202f]/g, '')).toContain('90071992547409.94');
	});
});
