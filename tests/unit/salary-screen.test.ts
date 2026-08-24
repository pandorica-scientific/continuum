// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
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

const data = {
	baseCurrency: 'CZK',
	people: [{ id: 'p1', name: 'Robert' }],
	history: [
		{
			id: 'p1',
			name: 'Robert',
			years: [year({ year: 2024, deltaPct: null, baseDeltaPct: null }), year()],
			payslips: [
				{
					id: 'd1',
					periodMonth: '2025-06',
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

const props = { data, form: null } as unknown as Record<string, unknown>;

describe('the salary screen', () => {
	it('names the person and counts what it has', () => {
		const { body } = render(Page, { props: props as never });
		expect(body).toContain('Robert');
		expect(body.replace(/\s+/g, ' ')).toContain('2 years · 2 payslips');
	});

	it('lists the payslips with their months', () => {
		const { body } = render(Page, { props: props as never });
		expect(body).toContain('2025-06');
		expect(body).toContain('2025-05');
	});

	it('links a payslip that has a file and not one that does not', () => {
		const { body } = render(Page, { props: props as never });
		expect(body.match(/\/files\//g)).toHaveLength(1);
	});

	it('says plainly when no bonus was read, rather than showing nothing', () => {
		// A blank would read as "no bonus"; the slip simply did not name one.
		const { body } = render(Page, { props: props as never });
		expect(body).toContain('none read');
		expect(body).toContain('8 000');
	});

	it('names every figure it shows, so none of them is of an unstated kind', () => {
		// The whole point of v0.4.6: a number on this screen used to be printed
		// with no indication whether it was gross or net, and it was net filed
		// as gross.
		const { body } = render(Page, { props: props as never });
		expect(body).toContain('>gross<');
		expect(body).toContain('>net<');
		expect(body).toContain('100 000');
		expect(body).toContain('71 400');
	});

	it('shows a dash for a figure the month does not have', () => {
		// A month evidenced only by a bank credit has a net and no gross. A zero
		// there would claim it was unpaid.
		const { body } = render(Page, { props: props as never });
		expect(body).toContain('—');
	});

	it('offers a delete on every payslip', () => {
		// There was no way to remove a payslip from this screen at all.
		const { body } = render(Page, { props: props as never });
		expect(body.match(/>Delete</g)).toHaveLength(2);
	});

	it('says so when nothing has been recorded at all', () => {
		const empty = { ...data, history: [{ id: 'p1', name: 'Robert', years: [], payslips: [] }] };
		const { body } = render(Page, { props: { ...props, data: empty } as never });
		expect(body).toContain('Nothing recorded yet');
	});

	it('gives a person with nothing recorded no block at all', () => {
		// An empty chart and an empty payslip list say only that the screen
		// works. A household where one person has never been paid through it
		// would carry that noise on every visit.
		const one = {
			...data,
			history: [...data.history, { id: 'p2', name: 'Kseniya', years: [], payslips: [] }]
		};
		const { body } = render(Page, { props: { ...props, data: one } as never });
		expect(body).not.toContain('Kseniya');
	});

	it('puts Add payslip in the header', () => {
		const { body } = render(Page, { props: props as never });
		expect(body).toContain('Add payslip');
	});
});

describe('the salary chart', () => {
	const chartProps = {
		years: data.history[0].years,
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
