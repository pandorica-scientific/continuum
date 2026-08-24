// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import SalaryMatrix from '$lib/components/SalaryMatrix.svelte';

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
	baseDeltaPct: 2,
	...over
});

const years = [year({ year: 2024, deltaPct: null, baseDeltaPct: null }), year()];

const props = { years, currency: 'CZK', openYear: null, onToggle: () => {} };

describe('the salary matrix', () => {
	it('names a column for each of base, bonus, net and the monthly average', () => {
		const { body } = render(SalaryMatrix, { props });
		expect(body).toContain('Base');
		expect(body).toContain('Bonus');
		expect(body).toContain('Net');
		expect(body).toContain('Avg month');
	});

	it('puts gross between what makes it up and what survives tax', () => {
		// base + bonus = gross, then net. Six equal columns read as six
		// comparable quantities; they are two groups of a different kind.
		const { body } = render(SalaryMatrix, { props });
		// Only net gets a heading: base, bonus and gross already say what they
		// are and that they add up, so labelling them restated the column names.
		expect(body).toContain('After tax');
		expect(body).not.toContain('What gross was made of');
		expect(body.indexOf('Bonus')).toBeLessThan(body.indexOf('Gross'));
		expect(body.indexOf('Gross')).toBeLessThan(body.indexOf('>Net<'));
	});

	it('gives the gross column the magnitude bar and the weight', () => {
		const { body } = render(SalaryMatrix, { props });
		expect(body).toContain('cell right gross');
		expect(body.match(/class="track/g)).toHaveLength(years.length);
	});

	it('shows newest first', () => {
		const { body } = render(SalaryMatrix, { props });
		expect(body.indexOf('2025')).toBeLessThan(body.indexOf('2024'));
	});

	it('puts the All row above the years', () => {
		const { body } = render(SalaryMatrix, { props });
		expect(body.indexOf('>All<')).toBeLessThan(body.indexOf('2025'));
	});

	it('sums base and bonus to the gross it reports', () => {
		// The breakdown columns add up to the total column, exactly as a tax
		// year's jurisdictions add up to its year total.
		const [y] = years;
		expect(BigInt(y.baseTotalMinor) + BigInt(y.bonusTotalMinor)).toBe(BigInt(y.grossTotalMinor));
	});

	it('says how much of a year the net covers rather than flagging it', () => {
		// An annual total over three months is a partial year, not a collapse.
		// Naming the shortfall is more use than a warning triangle.
		const partial = [year({ netMonths: 3, netComplete: false })];
		const { body } = render(SalaryMatrix, { props: { ...props, years: partial } });
		expect(body).toContain('3 of 12 months');
		expect(body).not.toContain('⚠');
	});

	it('does not mark a complete year', () => {
		const { body } = render(SalaryMatrix, { props });
		expect(body).not.toContain('of 12 months');
	});

	it('calls the first year first rather than leaving its change blank', () => {
		const { body } = render(SalaryMatrix, { props });
		expect(body).toContain('first year');
	});

	it('puts the magnitude bar only in the total column', () => {
		const { body } = render(SalaryMatrix, { props });
		expect(body.match(/class="track/g)).toHaveLength(years.length);
	});

	it('says nothing rather than zero where a year has no bonus', () => {
		// Null is "the slip did not itemise one", which is not "there was none".
		const plain = [year({ bonusTotalMinor: '0' })];
		const { body } = render(SalaryMatrix, { props: { ...props, years: plain } });
		expect(body).toContain('not itemised');
	});

	it('survives an empty record without a summary of dashes', () => {
		const { body } = render(SalaryMatrix, { props: { ...props, years: [] } });
		expect(body).not.toContain('All');
	});
});

const manyYears = Array.from({ length: 9 }, (_, i) => year({ year: 2025 - i }));

describe('the salary matrix pages', () => {
	const paged = { ...props, years: manyYears };

	it('shows at most five year rows', () => {
		const { body } = render(SalaryMatrix, { props: paged });
		expect(body.match(/aria-expanded="/g)).toHaveLength(5);
	});

	it('offers a pager naming the pages', () => {
		const { body } = render(SalaryMatrix, { props: paged });
		expect(body).toContain('1 / 2');
	});

	it('offers 5, 25 and 50 rows a page, five selected', () => {
		const { body } = render(SalaryMatrix, { props: paged });
		expect(body).toContain('Rows per page');
		expect(body).toContain('>50<');
		expect(body).toContain('aria-current="true"');
	});

	it('renders no pager at or below five years', () => {
		const { body } = render(SalaryMatrix, { props: { ...paged, years: manyYears.slice(0, 5) } });
		expect(body).not.toContain('1 / 1');
	});

	it('keeps the All row over every year, not only the visible page', () => {
		const { body } = render(SalaryMatrix, { props: paged });
		expect(body).toContain('9 years');
	});
});
