import { describe, expect, it } from 'vitest';
import {
	detectPeriod,
	extractCandidates,
	parsePrintedAmount,
	pickAmount,
	salaryStats
} from '$lib/salary';

describe('parsePrintedAmount', () => {
	it('reads Czech and English printed amounts', () => {
		expect(parsePrintedAmount('45 231,00')).toBe(4523100n);
		expect(parsePrintedAmount('45 231')).toBe(4523100n);
		expect(parsePrintedAmount('45.231')).toBe(4523100n);
		expect(parsePrintedAmount('45231.50')).toBe(4523150n);
		expect(parsePrintedAmount('1 234 567,89')).toBe(123456789n);
	});

	it('reads comma-grouped thousands', () => {
		expect(parsePrintedAmount('45,231.00')).toBe(4523100n);
		expect(parsePrintedAmount('45,231')).toBe(4523100n);
		expect(parsePrintedAmount('1,234,567.89')).toBe(123456789n);
	});
});

describe('extractCandidates and pickAmount', () => {
	const lines = [
		'Hrubá mzda 62 000,00',
		'Zdravotní pojištění 2 790,00',
		'Sociální pojištění 4 340,00',
		'Záloha na daň 6 150,00',
		'K výplatě 45 231,00'
	];

	it('labels each amount with the text before it', () => {
		const candidates = extractCandidates(lines);
		expect(candidates.some((c) => c.label === 'k výplatě' && c.amountMinor === 4523100n)).toBe(
			true
		);
	});

	it('prefers the net-pay keyword over the largest amount', () => {
		const picked = pickAmount(extractCandidates(lines), null);
		expect(picked?.amountMinor).toBe(4523100n); // not the 62 000 gross
	});

	it('a learned label beats the keywords', () => {
		const withCustom = [...lines, 'Převedeno celkem 44 000,00'];
		const picked = pickAmount(extractCandidates(withCustom), 'převedeno celkem');
		expect(picked?.amountMinor).toBe(4400000n);
	});

	it('falls back to the largest amount when nothing matches', () => {
		const picked = pickAmount(extractCandidates(['Alpha 100,00', 'Beta 900,00']), null);
		expect(picked?.amountMinor).toBe(90000n);
	});

	it('matches keywords with or without diacritics', () => {
		const noDiacritics = ['Hruba mzda 62 000,00', 'K vyplate 45 231,00'];
		expect(pickAmount(extractCandidates(noDiacritics), null)?.amountMinor).toBe(4523100n);
	});

	it('reads an English payslip at full magnitude, not its first four digits', () => {
		// Without a comma-grouped alternative the amount pattern fell through to
		// `\d{1,3}[.,]\d{2}` and matched "45,23" out of "45,231.00", so the slip
		// was filed as 45.23 — a thousandfold error, silently.
		const english = ['Gross pay 62,000.00', 'Tax withheld 16,769.00', 'Net pay 45,231.00'];
		const candidates = extractCandidates(english);
		expect(candidates.some((c) => c.label === 'net pay' && c.amountMinor === 4523100n)).toBe(true);
		expect(pickAmount(candidates, null)?.amountMinor).toBe(4523100n);
		expect(pickAmount(extractCandidates(['Take home 1,234,567.89']), null)?.amountMinor).toBe(
			123456789n
		);
	});
});

describe('detectPeriod', () => {
	it('reads numeric, ISO and Czech month forms', () => {
		expect(detectPeriod(['Výplatní páska za období 08/2026'])).toBe('2026-08');
		expect(detectPeriod(['Období: 2026-08'])).toBe('2026-08');
		expect(detectPeriod(['Mzda za srpen 2026'])).toBe('2026-08');
		expect(detectPeriod(['July 2026 payslip'])).toBe('2026-07');
		expect(detectPeriod(['no period here'])).toBeNull();
	});

	it('reads every month name in the table, diacritics included', () => {
		// `\b` is defined over [A-Za-z0-9_], so between a space and "ú" there is
		// no boundary and `\búnor\b` never matched. Nine names failed that way,
		// which quietly removed five months a year from the salary history and
		// the tax prefill.
		const expected: Array<[string, string]> = [
			['leden', '01'],
			['ledna', '01'],
			['únor', '02'],
			['února', '02'],
			['březen', '03'],
			['března', '03'],
			['duben', '04'],
			['dubna', '04'],
			['květen', '05'],
			['května', '05'],
			['červen', '06'],
			['června', '06'],
			['červenec', '07'],
			['července', '07'],
			['srpen', '08'],
			['srpna', '08'],
			['září', '09'],
			['říjen', '10'],
			['října', '10'],
			['listopad', '11'],
			['listopadu', '11'],
			['prosinec', '12'],
			['prosince', '12']
		];
		for (const [name, month] of expected) {
			expect(detectPeriod([`Mzda za ${name} 2026`])).toBe(`2026-${month}`);
			expect(detectPeriod([`MZDA ZA ${name.toUpperCase()} 2026`])).toBe(`2026-${month}`);
		}
	});

	it('does not match a month name inside a longer word', () => {
		expect(detectPeriod(['Zaříznuto 2026'])).toBeNull();
		expect(detectPeriod(['Mayor 2026'])).toBeNull();
	});
});

describe('salaryStats', () => {
	it('averages per year and computes the year-on-year change and age', () => {
		const slips = [
			{ periodMonth: '2024-01', amountMinor: 40_000_00n },
			{ periodMonth: '2024-07', amountMinor: 42_000_00n },
			{ periodMonth: '2025-03', amountMinor: 45_100_00n }
		];
		const rows = salaryStats(slips, 1990);
		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({ year: 2024, age: 34, months: 2 });
		expect(rows[0].avgMonthlyMinor).toBe(41_000_00n);
		expect(rows[0].deltaPct).toBeNull();
		expect(rows[1].deltaPct).toBeCloseTo(10, 1); // 45 100 vs 41 000
		expect(salaryStats([], null)).toHaveLength(0);
	});
});
