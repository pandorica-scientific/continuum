// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import TaxMatrix from '$lib/components/TaxMatrix.svelte';

const countries = [
	{ code: 'CZ', name: 'Czechia', token: '--series-health-soft' },
	{ code: 'PL', name: 'Poland', token: '--series-taxes-soft' }
];

const years = [
	{
		year: 2025,
		grossMinor: '21500000',
		taxMinor: '3225000',
		ratePct: 15,
		byCountry: [
			{ country: 'CZ', grossMinor: '21400000', taxMinor: '3210000', ratePct: 15 },
			{ country: 'PL', grossMinor: '8500', taxMinor: '0', ratePct: 0 }
		]
	},
	{
		year: 2024,
		grossMinor: '15800000',
		taxMinor: '2370000',
		ratePct: 15,
		byCountry: [{ country: 'CZ', grossMinor: '15800000', taxMinor: '2370000', ratePct: 15 }]
	}
];

const props = {
	years,
	countries,
	currency: 'EUR',
	flaggedThreshold: '1070000',
	openYear: 2025,
	onToggle: () => {}
};

describe('the tax matrix', () => {
	it('heads its columns with country names, not ISO codes', () => {
		// A header row is read once, and a name costs nothing.
		const { body } = render(TaxMatrix, { props });
		expect(body).toContain('Czechia');
		expect(body).toContain('Poland');
	});

	it('marks a year with no filing with a middot, not a dash and not a zero', () => {
		// No filing means "lived elsewhere that year", not "earned nothing".
		const { body } = render(TaxMatrix, { props });
		expect(body).toContain('·');
		expect(body).not.toContain('—</span>');
	});

	it('flags a filing far below the median', () => {
		const { body } = render(TaxMatrix, { props });
		expect(body).toContain('⚠');
	});

	it('does not flag anything when the threshold is zero', () => {
		const { body } = render(TaxMatrix, { props: { ...props, flaggedThreshold: '0' } });
		expect(body).not.toContain('⚠');
	});

	it('does not flag an ordinary filing', () => {
		const { body } = render(TaxMatrix, {
			props: { ...props, years: [years[1]], flaggedThreshold: '1000' }
		});
		expect(body).not.toContain('⚠');
	});

	it('shows newest first', () => {
		const { body } = render(TaxMatrix, { props });
		expect(body.indexOf('2025')).toBeLessThan(body.indexOf('2024'));
	});

	it('sums a lifetime total per jurisdiction in the All row', () => {
		const { body } = render(TaxMatrix, { props });
		expect(body).toContain('All');
		expect(body).toContain('2 years');
		expect(body).toContain('1 year<');
	});

	it('puts the All row above the years, not below them', () => {
		// It is the figure the screen is read for. Underneath a paged table it
		// was also the row you had to scroll past every year to reach.
		const { body } = render(TaxMatrix, { props });
		expect(body.indexOf('>All<')).toBeLessThan(body.indexOf('2025'));
	});

	it('puts the magnitude bar only in the total column', () => {
		// It is the one column where every row shares a currency, so the only one
		// where comparing bar lengths is honest.
		const { body } = render(TaxMatrix, { props });
		expect(body.match(/class="track/g)).toHaveLength(years.length);
	});

	it('marks the open year and only the open year', () => {
		const { body } = render(TaxMatrix, { props });
		expect(body.match(/aria-expanded="true"/g)).toHaveLength(1);
		expect(body.match(/aria-expanded="false"/g)).toHaveLength(1);
	});

	it('renders a column per jurisdiction even when a year is missing one', () => {
		// 2024 has no PL filing but still gets a PL cell, so the grid stays square
		// and the totals column keeps its place.
		const { body } = render(TaxMatrix, { props });
		const cells = body.match(/class="cell[^"]*"/g) ?? [];
		// Two years × (two jurisdictions + one total).
		expect(cells).toHaveLength(6);
	});

	it('survives an empty record without a summary of dashes', () => {
		const { body } = render(TaxMatrix, { props: { ...props, years: [] } });
		expect(body).not.toContain('All');
	});
});

// Nine years, so the table pages: newest first, five to a page.
const manyYears = Array.from({ length: 9 }, (_, i) => ({
	year: 2025 - i,
	grossMinor: String(20000000 - i * 1000000),
	taxMinor: String(3000000 - i * 100000),
	ratePct: 15,
	byCountry: [
		{
			country: 'CZ',
			grossMinor: String(20000000 - i * 1000000),
			taxMinor: String(3000000 - i * 100000),
			ratePct: 15
		}
	]
}));

describe('the tax matrix pages', () => {
	const paged = { ...props, years: manyYears, openYear: null };

	it('shows at most five year rows', () => {
		const { body } = render(TaxMatrix, { props: paged });
		expect(body.match(/aria-expanded="/g)).toHaveLength(5);
	});

	it('shows the newest five first', () => {
		const { body } = render(TaxMatrix, { props: paged });
		for (const y of [2025, 2024, 2023, 2022, 2021]) expect(body).toContain(String(y));
		expect(body).not.toContain('2020');
	});

	it('offers a pager naming the pages', () => {
		const { body } = render(TaxMatrix, { props: paged });
		expect(body).toContain('1 / 2');
	});

	it('offers 5, 25 and 50 rows a page, five selected', () => {
		const { body } = render(TaxMatrix, { props: paged });
		expect(body).toContain('Rows per page');
		expect(body).toContain('>50<');
		expect(body).toContain('aria-current="true"');
	});

	it('renders no pager at or below five years', () => {
		const { body } = render(TaxMatrix, { props: { ...paged, years: manyYears.slice(0, 5) } });
		expect(body).not.toContain('1 / 1');
	});

	it('keeps the All row over every year, not only the visible page', () => {
		// Nine years of filings, five on screen. A lifetime total that counted
		// only the page would change as you paged, which is not a lifetime total.
		const { body } = render(TaxMatrix, { props: paged });
		expect(body).toContain('9 years');
	});

	it('keeps the magnitude bar comparable across pages', () => {
		// The ceiling is the largest year in the whole record, not on the page,
		// so a bar means the same thing on page two as on page one.
		const { body } = render(TaxMatrix, { props: paged });
		const widths = [...body.matchAll(/width:\s*([\d.]+)%/g)].map((m) => Number(m[1]));
		expect(Math.max(...widths)).toBeCloseTo(100, 0);
	});
});
