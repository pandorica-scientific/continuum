// SPDX-License-Identifier: AGPL-3.0-or-later
// Payslips that are a real table: a row of headings, figures on the line beneath.
// extractCandidates reads line-at-a-time and can't label these on its own.
// Geometry is taken from two real layouts; the figures are invented.
import { describe, expect, it } from 'vitest';
import {
	columnCandidates,
	detectPeriod,
	extractCandidates,
	pickGross,
	pickNet,
	type LabelledLine
} from '$lib/salary';

// Each value sits to the RIGHT of the heading it belongs to, not under its left edge.
const STACKED: LabelledLine[] = [
	{ cells: ['Kiewisz Robert Dr.'], xs: [94] },
	{
		cells: ['(1) Employment', 'Full time job', 'Gross salary', 'Net salary'],
		xs: [17, 155, 293, 431]
	},
	{ cells: ['40:00', '111 222', '80 111'], xs: [257, 390, 523] },
	{
		cells: ['Total 23 days', 'Base salary', 'Taxable income', 'Sick payments'],
		xs: [17, 155, 293, 431]
	},
	{ cells: ['184:00', '95 000', '111 222'], xs: [113, 246, 390] }
];

describe('a payslip printed as a table', () => {
	it('labels a figure with the heading standing over its column', () => {
		const found = columnCandidates(STACKED, 'CZK');
		expect(found).toContainEqual({ label: 'gross salary', amountMinor: 11122200n });
		expect(found).toContainEqual({ label: 'net salary', amountMinor: 8011100n });
	});

	// Two headings side by side must not both end up on the same figure.
	it('keeps neighbouring headings on their own figures', () => {
		const found = columnCandidates(STACKED, 'CZK');
		expect(pickGross(found, null)?.amountMinor).toBe(11122200n);
		expect(pickNet(found, null)?.amountMinor).toBe(8011100n);
	});

	it('reads the row below the headings too', () => {
		expect(columnCandidates(STACKED, 'CZK')).toContainEqual({
			label: 'base salary',
			amountMinor: 9500000n
		});
	});

	// A row of figures is another row of values, not a name for one.
	it('skips a heading row that is only figures, and looks further up', () => {
		const withNoise: LabelledLine[] = [
			{ cells: ['Net salary'], xs: [385] },
			{ cells: ['Deductions', '77,89'], xs: [25, 305] },
			{ cells: ['80 111'], xs: [385] }
		];
		expect(pickNet(columnCandidates(withNoise, 'CZK'), null)?.amountMinor).toBe(8011100n);
	});

	// A heading split across three cells, with no neighbouring value to bound the band.
	it('gathers a heading split across several cells', () => {
		const spanish: LabelledLine[] = [
			{
				cells: ['REMUN.TOTAL', '7.470,84', 'REG.GRAL.', 'LIQUIDO', 'TOTAL', 'A PERCIBIR'],
				xs: [25, 90, 137, 346, 385, 415]
			},
			{ cells: ['4.910,89'], xs: [385] }
		];
		expect(pickNet(columnCandidates(spanish, 'EUR'), null)?.amountMinor).toBe(491089n);
	});

	it('finds nothing in a line with no column positions at all', () => {
		expect(columnCandidates([{ cells: ['Gross salary'] }, { cells: ['111 222'] }], 'CZK')).toEqual(
			[]
		);
	});
});

describe('which of a payslip’s dates is the period', () => {
	// Regression: reading the processing date as the period misfiled months of pay.
	it('takes the date the slip calls the period', () => {
		expect(
			detectPeriod(['Period:October 2025 Processed: 07.11.2025 11:22:55 Accounted for: 7.11.2025'])
		).toBe('2025-10');
	});

	it('takes a numeric period after the same kind of marker', () => {
		expect(detectPeriod(['Payroll slip for month 1/2025'])).toBe('2025-01');
	});

	// A month printed in words beats any numeric date when there's no marker.
	it('prefers a month named in words over a numeric date', () => {
		expect(detectPeriod(['February 2026', 'Printed 6.3.2026 12:54:27'])).toBe('2026-02');
	});

	it('reads a day-month-year pay date, as a Spanish slip prints it', () => {
		expect(detectPeriod(['Del 01 de 01 al 31 de 01 de 2024 31-01-2024 30'])).toBe('2024-01');
	});

	it('still answers nothing when the slip carries no date at all', () => {
		expect(detectPeriod(['Hrubá mzda 111 222'])).toBeNull();
	});
});

describe('a Spanish payslip’s wordings', () => {
	it('reads the withholding base as gross and the transfer as net', () => {
		const lines: LabelledLine[] = [
			{
				cells: ['BASE', 'SUJETA', 'A RETENCIÓN', 'DEL', 'IRPF', '7.570,84'],
				xs: [26, 46, 75, 124, 140, 290]
			},
			{ cells: ['LIQUIDO', 'TOTAL', 'A PERCIBIR'], xs: [346, 385, 415] },
			{ cells: ['4.910,89'], xs: [385] }
		];
		const found = columnCandidates(lines, 'EUR');
		expect(pickNet(found, null)?.amountMinor).toBe(491089n);
	});
});

// Regression: on a dot-ruled page with the figure ABOVE its wording, a loose
// match against a digit inside the IBAN fired before the column pass could run.
describe('a payslip that names its figures underneath them', () => {
	const RULED: LabelledLine[] = [
		{ cells: ['2.505,75'], xs: [120] },
		{ cells: ['LÍQUIDO A PERCIBIR .......................................'], xs: [26] },
		{
			cells: [
				'TRANSFERECIA DEL LÍQUIDO A PERCIBIR A LA CUENTA: IBAN: ES70 6893 0001 XX 000001XXXX'
			],
			xs: [26]
		}
	];

	it('reads the figure the wording underneath belongs to', () => {
		expect(pickNet(columnCandidates(RULED, 'EUR'), null)?.amountMinor).toBe(250575n);
	});

	// Dot leaders are not part of the wording and must be stripped from the label.
	it('does not let the dot leaders hide the end of the wording', () => {
		expect(columnCandidates(RULED, 'EUR')).toContainEqual({
			label: 'líquido a percibir',
			amountMinor: 250575n
		});
	});

	// An exact wording must outrank a loose match, whichever pass found it.
	it('prefers the exact heading over a loose match on an account number', () => {
		const inline = extractCandidates(
			RULED.map((l) => l.cells.join(' ')),
			'EUR'
		);
		const merged = [...columnCandidates(RULED, 'EUR'), ...inline];
		expect(pickNet(merged, null)?.amountMinor).toBe(250575n);
	});
});

describe('a two-digit year', () => {
	it('is read when the slip states it as the period', () => {
		expect(detectPeriod(['Periódo de liquidación 01/01/23 a 31/01/23'])).toBe('2023-01');
	});

	// Regression: line-by-line matching picked up the job-start date near the
	// top of the page instead of the four-digit period further down.
	it('never outranks a date further down the page that states its year', () => {
		expect(
			detectPeriod([
				'F.ALTA ANTIGU. CATEGORIA',
				'01-10-23 01-10-23 AREA 3',
				'PERIODO DEVENGADO F.COBRO',
				'Del 01 de 01 al 31 de 01 de 2024 31-01-2024 30'
			])
		).toBe('2024-01');
	});
});
