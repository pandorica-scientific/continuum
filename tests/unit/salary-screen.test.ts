// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Page from '../../src/routes/(app)/salary/+page.svelte';
import Chart from '$lib/charts/SalaryYearChart.svelte';

vi.mock('$app/state', () => ({
	page: { data: {}, url: new URL('http://localhost/salary') }
}));

const year = (over: Record<string, unknown> = {}) => ({
	year: 2025,
	age: 40,
	grossAvgMinor: '7000000',
	netAvgMinor: '5000000',
	grossTotalMinor: '84000000',
	baseTotalMinor: '78000000',
	bonusTotalMinor: '6000000',
	netTotalMinor: '60000000',
	grossMonths: 12,
	netMonths: 12,
	netComplete: true,
	deltaPct: 5,
	baseDeltaPct: 2,
	...over
});

const years = [year({ year: 2024, deltaPct: null, baseDeltaPct: null }), year()];

const data = {
	openAdd: false,
	baseCurrency: 'CZK',
	people: [{ id: 'p1', name: 'Robert' }],
	household: years,
	history: [
		{
			id: 'p1',
			name: 'Robert',
			years,
			payslips: [
				{
					id: 'd1',
					periodMonth: '2025-06',
					base: '92 000',
					gross: '100 000',
					net: '71 400',
					bonus: '8 000',
					currency: 'CZK',
					file: 'a.pdf'
				},
				{
					// Evidenced only by a bank credit: net is known, gross is not.
					id: 'd2',
					periodMonth: '2025-05',
					base: null,
					gross: null,
					net: '62 000',
					bonus: null,
					currency: 'CZK',
					file: null
				}
			]
		}
	]
};

const props = { data } as unknown as Record<string, unknown>;

describe('the salary screen', () => {
	it('puts Add payslip in the header', () => {
		const { body } = render(Page, { props: props as never });
		expect(body).toContain('Add payslip');
	});

	it('lays the years out as a table, not as one block per person', () => {
		// Two people used to mean two of everything, stacked, with no way to see
		// the household at all.
		const { body } = render(Page, { props: props as never });
		expect(body).toContain('After tax');
		expect(body).toContain('Avg month');
		expect(body).toContain('2025');
		expect(body).toContain('2024');
	});

	it('offers no person filter for a household of one', () => {
		const { body } = render(Page, { props: props as never });
		expect(body).not.toContain('>Both<');
	});

	it('offers Both and each person when there are two', () => {
		const two = {
			...data,
			people: [
				{ id: 'p1', name: 'Robert' },
				{ id: 'p2', name: 'Kseniya' }
			]
		};
		const { body } = render(Page, { props: { ...props, data: two } as never });
		expect(body).toContain('Both');
		expect(body).toContain('Kseniya');
	});

	it('keeps the payslips folded into their year rather than listing them all', () => {
		// They are a year's evidence, so they open with the year. A flat list of
		// every slip ever filed is what this replaced.
		const { body } = render(Page, { props: props as never });
		expect(body).not.toContain('2025-06');
	});

	it('keeps the upload form shut until it is asked for', () => {
		const { body } = render(Page, { props: props as never });
		expect(body).not.toContain('Payslip PDF');
	});

	it('opens the upload form when the quick-add menu asked for it', () => {
		const { body } = render(Page, {
			props: { ...props, data: { ...data, openAdd: true } } as never
		});
		expect(body).toContain('Payslip PDF');
		expect(body).toContain('role="dialog"');
	});

	it('opens with a summary band above the filter, the way Tax does', () => {
		const { body } = render(Page, { props: props as never });
		expect(body).toContain('Earned since');
		expect(body.indexOf('Earned since')).toBeLessThan(body.indexOf('After tax'));
	});

	it('shows household figures under Both and a person’s under their name', () => {
		// Unlike the Tax band this one answers to the filter: "what has Robert
		// earned" and "what has the household earned" are different questions.
		const two = {
			...data,
			people: [
				{ id: 'p1', name: 'Robert' },
				{ id: 'p2', name: 'Kseniya' }
			]
		};
		const { body } = render(Page, { props: { ...props, data: two } as never });
		// Default filter is Both, so the household figures show.
		expect(body).toContain('Average year');
		expect(body).not.toContain('Last increase');
	});

	it('lays an expanded month on the table’s own grid, not a grid of its own', () => {
		// Six children on a three-column grid wrapped every payslip onto two lines
		// and stretched the bonus across a whole fraction. The detail takes its
		// columns from the matrix so a figure sits under the column it belongs to.
		const source = readFileSync(resolve('src/routes/(app)/salary/+page.svelte'), 'utf8');
		expect(source).toContain('grid-template-columns: var(--row-cols)');
		expect(source).toContain('min-width: var(--row-min)');
		const matrix = readFileSync(resolve('src/lib/components/SalaryMatrix.svelte'), 'utf8');
		// The one definition, handed down as custom properties so the header, the
		// rows and the detail cannot drift — including the detail, which lives on
		// the page rather than in the matrix.
		expect(matrix).toContain('style:--row-cols={COLUMNS}');
		expect(matrix).toContain('style:--row-min={MIN_WIDTH}');
		// The page states no column template and no scroll width of its own.
		expect(source).not.toMatch(/grid-template-columns:\s*\d+px/);
		expect(source).not.toMatch(/min-width:\s*\d+px/);
	});

	it('keeps the correction explainer behind an ⓘ too, not under every open year', () => {
		const source = readFileSync(resolve('src/routes/(app)/salary/+page.svelte'), 'utf8');
		expect(source).toContain('How to correct a figure');
		// Its own toggle, and its own component: the upload dialog's explainer
		// answers a different question, and opening one to read the other would
		// be a small lie.
		expect(source).toContain('showSlipHint');
		const dialog = readFileSync(resolve('src/lib/components/PayslipDialog.svelte'), 'utf8');
		expect(dialog).toContain('showHint');
	});

	it('says so when nothing has been recorded at all', () => {
		const empty = {
			...data,
			household: [],
			history: [{ id: 'p1', name: 'Robert', years: [], payslips: [] }]
		};
		const { body } = render(Page, { props: { ...props, data: empty } as never });
		expect(body).toContain('Nothing recorded yet');
	});
});

describe('the salary chart', () => {
	const chartProps = {
		years,
		currency: 'CZK',
		mode: 'avg' as const,
		onchange: () => {}
	};

	it('offers all three modes', () => {
		const { body } = render(Chart, { props: chartProps });
		expect(body).toContain('Average month');
		expect(body).toContain('Yearly total');
		expect(body).toContain('Change');
	});

	it('shows the bonus key only when a bonus exists', () => {
		const { body } = render(Chart, { props: chartProps });
		expect(body).toContain('bonus');

		const noBonus = data.history[0].years.map((y) => ({ ...y, bonusTotalMinor: '0' }));
		const plain = render(Chart, { props: { ...chartProps, years: noBonus } });
		expect(plain.body).not.toContain('change, base only');
	});

	it('explains what the mode is measuring', () => {
		const { body } = render(Chart, { props: chartProps });
		expect(body).toContain('compares as a monthly rate');
	});

	it('warns about partial years in total mode', () => {
		const { body } = render(Chart, { props: { ...chartProps, mode: 'total' as const } });
		expect(body).toContain('a partial year is not a small one');
	});

	it('says why base is drawn apart in change mode', () => {
		const { body } = render(Chart, { props: { ...chartProps, mode: 'change' as const } });
		expect(body).toContain('does not read as a raise');
	});

	it('renders an empty state rather than an axis with nothing on it', () => {
		const { body } = render(Chart, { props: { ...chartProps, years: [] } });
		expect(body).toContain('Nothing recorded yet');
	});
});
