// SPDX-License-Identifier: AGPL-3.0-or-later
// A person with two jobs in a year has two payroll systems printing two
// different wordings for the same figure. Until v0.5.2 the reader kept one
// learned wording per person, so each correction wiped the other employer's:
// alternating between them relearned the same two labels forever, and neither
// was ever there when its own slip arrived.
//
// The wordings below are the two payroll layouts this was found on, reduced to
// the lines that matter. The figures are invented — the layouts are payroll
// boilerplate, but nobody's actual pay belongs in a repository.
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

// Employer B carries a column to the left, so the same words arrive with a
// prefix — a different learned label for the identical figure.
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

	// The defect: one slot per person. Correcting a B slip used to leave A's
	// wording nowhere, and vice versa.
	it('applies whichever learned wording belongs to the slip in hand', () => {
		const both = [B_GROSS, A_GROSS];
		expect(pickGross(extractCandidates(A, 'CZK'), both)?.amountMinor).toBe(11122200n);
		expect(pickGross(extractCandidates(B, 'CZK'), both)?.amountMinor).toBe(9944400n);
	});

	// A wording learned from the other employer must not match here at all — it
	// has to fall through to the keywords rather than answer wrongly.
	it('ignores a wording that is not on this slip', () => {
		expect(pickGross(extractCandidates(A, 'CZK'), [B_GROSS])?.amountMinor).toBe(11122200n);
	});

	// Employer A's slip names no currency anywhere; B's does. That difference is
	// real, and is why the currency has to be asked for and remembered.
	it('reads a currency off one layout and nothing off the other', () => {
		expect(detectCurrency(B, ['CZK', 'EUR'])).toBe('CZK');
		expect(detectCurrency(A, ['CZK', 'EUR'])).toBeNull();
	});
});

describe('reading what was learned before v0.5.2', () => {
	// One bare string per person is what the old setting held. It has to keep
	// working without a migration — a person with one job has nothing to migrate.
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

// The defect underneath the two-employer one, and the reason a year of hand
// corrections taught the reader nothing at all: a joined table row puts the
// NEIGHBOURING column into the label, and that column is a different figure
// every month.
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
		// The net label cannot avoid carrying the employer's contribution — it is
		// the cell to its left on the same row — so the amounts are stripped from
		// both sides of the comparison instead.
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
