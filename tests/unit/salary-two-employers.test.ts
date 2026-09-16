// SPDX-License-Identifier: AGPL-3.0-or-later
// Regression: one learned wording per person meant each employer's correction
// wiped the other's. Figures below are invented payroll boilerplate.
import { describe, expect, it } from 'vitest';
import {
	detectCurrency,
	extractCandidates,
	labelKey,
	learnedList,
	pickGross,
	pickNet,
	tightestLabelFor
} from '$lib/salary';

// Employer A prints the figure with nothing before it on the line.
const A = [
	'Payroll slip for month 1/2025',
	'Basic salary 95 000 Health insurance 5 000',
	'Gross salary 111 222 Income tax base 111 222',
	'Social Security of employer 27 111,50 Net salary 80 111'
];

// Employer B carries a column to the left, so the same words arrive with a prefix.
const B = [
	'February 2026',
	'(1) Empl. rel. 01.10.2025 Gross salary 99 444',
	'Time work: Full-time job 40:00 Net salary 70 555 Total to pay 70 555',
	'Benefits taken: 600 CZK'
];

const A_GROSS = 'gross salary';
const B_GROSS = '(1) empl. rel. 01.10.2025 gross salary';

describe('a person with two employers in one year', () => {
	it('reads both layouts from the keywords alone, with nothing learned', () => {
		expect(pickGross(extractCandidates(A, 'CZK'), null)?.amountMinor).toBe(11122200n);
		expect(pickNet(extractCandidates(A, 'CZK'), null)?.amountMinor).toBe(8011100n);
		expect(pickGross(extractCandidates(B, 'CZK'), null)?.amountMinor).toBe(9944400n);
		expect(pickNet(extractCandidates(B, 'CZK'), null)?.amountMinor).toBe(7055500n);
	});

	it('applies whichever learned wording belongs to the slip in hand', () => {
		const both = [B_GROSS, A_GROSS];
		expect(pickGross(extractCandidates(A, 'CZK'), both)?.amountMinor).toBe(11122200n);
		expect(pickGross(extractCandidates(B, 'CZK'), both)?.amountMinor).toBe(9944400n);
	});

	// Must fall through to the keywords rather than match the wrong employer's wording.
	it('ignores a wording that is not on this slip', () => {
		expect(pickGross(extractCandidates(A, 'CZK'), [B_GROSS])?.amountMinor).toBe(11122200n);
	});

	it('reads a currency off one layout and nothing off the other', () => {
		expect(detectCurrency(B, ['CZK', 'EUR'])).toBe('CZK');
		expect(detectCurrency(A, ['CZK', 'EUR'])).toBeNull();
	});
});

describe('reading what was learned before v0.5.2', () => {
	// Old setting stored one bare string per person; must keep working without migration.
	it('takes a single stored wording as a list of one', () => {
		expect(learnedList(A_GROSS)).toEqual([A_GROSS]);
		expect(pickGross(extractCandidates(A, 'CZK'), A_GROSS)?.amountMinor).toBe(11122200n);
	});

	it('has an empty answer for a person who has corrected nothing', () => {
		expect(learnedList(null)).toEqual([]);
		expect(learnedList(undefined)).toEqual([]);
		expect(learnedList([])).toEqual([]);
	});
});

// A joined table row can put the NEIGHBOURING column into the label, and that
// column changes value every month.
describe('a wording learned in January, on February’s slip', () => {
	const jan = extractCandidates(
		[
			'Gross salary 111 222 Income tax base 111 222',
			'Social Security of employer 27 111,50 Net salary 80 111'
		],
		'CZK'
	);
	const feb = extractCandidates(
		[
			'Gross salary 110 333 Income tax base 110 333',
			'Social Security of employer 26 222,40 Net salary 79 222'
		],
		'CZK'
	);

	it('learns the column that names the figure, not that column plus the next', () => {
		expect(tightestLabelFor(jan, 11122200n)?.label).toBe('gross salary');
	});

	it('still matches next month, though the neighbouring column has changed', () => {
		// The net label carries the employer's contribution (the cell to its left), so
		// amounts are stripped from both sides of the comparison instead.
		const learnedInJanuary = tightestLabelFor(jan, 8011100n)!.label;
		expect(learnedInJanuary).toContain('27 111,50');
		expect(pickNet(feb, [learnedInJanuary])?.amountMinor).toBe(7922200n);
	});

	it('reads the same wording as one key whatever figures are embedded in it', () => {
		expect(labelKey('social security of employer 27 111,50 net salary')).toBe(
			labelKey('social security of employer 26 222,40 net salary')
		);
	});

	// Stripping digits must not collapse two genuinely different columns into one.
	it('keeps two different wordings apart', () => {
		expect(labelKey('gross salary')).not.toBe(labelKey('gross salary 111 222 income tax base'));
	});
});
