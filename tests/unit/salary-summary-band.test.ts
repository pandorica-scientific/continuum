// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import SalarySummaryBand from '$lib/components/SalarySummaryBand.svelte';

const year = (over: Record<string, unknown> = {}) => ({
	year: 2025,
	age: 40,
	grossAvgMinor: '10000000',
	netAvgMinor: '7140000',
	grossTotalMinor: '120000000',
	baseTotalMinor: '100000000',
	bonusTotalMinor: '20000000',
	netTotalMinor: '85680000',
	grossMonths: 12,
	netMonths: 12,
	netComplete: true,
	deltaPct: 5,
	baseDeltaPct: 8.2,
	...over
});

const years = [year({ year: 2024, deltaPct: null, baseDeltaPct: null }), year()];
const props = { years, currency: 'CZK', scope: 'person' as const };

describe('the salary summary band', () => {
	it('says which year the record starts from', () => {
		const { body } = render(SalarySummaryBand, { props });
		expect(body).toContain('Earned since 2024');
	});

	it('leads with gross and carries net beneath it', () => {
		// The whole release is about the two not being the same number. A headline
		// that did not say which it was would be the defect all over again.
		const { body } = render(SalarySummaryBand, { props });
		expect(body).toContain('gross');
		expect(body).toContain('net');
	});

	it('reports the last real rise in base pay, with its year', () => {
		const { body } = render(SalarySummaryBand, { props });
		expect(body).toContain('Last increase');
		expect(body).toContain('+8.2%');
		expect(body).toContain('2025');
	});

	it('says so plainly when the base has never risen', () => {
		const flat = [year({ year: 2024, baseDeltaPct: null }), year({ baseDeltaPct: -3 })];
		const { body } = render(SalarySummaryBand, { props: { ...props, years: flat } });
		expect(body).toContain('no increase recorded');
	});

	it('averages over the months recorded, not over the years', () => {
		// A year with four payslips is a partial year, and dividing its total by
		// twelve would report a monthly figure nobody was paid.
		const partial = [year({ grossTotalMinor: '40000000', grossMonths: 4, netMonths: 4 })];
		const { body } = render(SalarySummaryBand, { props: { ...props, years: partial } });
		expect(body.replace(/\s+/g, ' ')).toContain('over 4 months');
	});

	it('shows household figures when both people are selected', () => {
		const { body } = render(SalarySummaryBand, { props: { ...props, scope: 'household' } });
		expect(body).toContain('Average year');
		expect(body).toContain('Last year');
		// "Last increase" is a person's raise; a household does not have one.
		expect(body).not.toContain('Last increase');
	});

	it('shows a person’s monthly figures when one is selected', () => {
		const { body } = render(SalarySummaryBand, { props });
		expect(body).toContain('Average month');
		expect(body).not.toContain('Average year');
	});

	it('renders nothing at all for an empty record', () => {
		const { body } = render(SalarySummaryBand, { props: { ...props, years: [] } });
		expect(body).not.toContain('Earned since');
	});

	it('marks a year whose net does not cover twelve months', () => {
		const partial = [year({ netMonths: 5, netComplete: false })];
		const { body } = render(SalarySummaryBand, { props: { ...props, years: partial } });
		expect(body).toContain('⚠');
	});
});
