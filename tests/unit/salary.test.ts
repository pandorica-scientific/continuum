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
});

describe('detectPeriod', () => {
	it('reads numeric, ISO and Czech month forms', () => {
		expect(detectPeriod(['Výplatní páska za období 08/2026'])).toBe('2026-08');
		expect(detectPeriod(['Období: 2026-08'])).toBe('2026-08');
		expect(detectPeriod(['Mzda za srpen 2026'])).toBe('2026-08');
		expect(detectPeriod(['July 2026 payslip'])).toBe('2026-07');
		expect(detectPeriod(['no period here'])).toBeNull();
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
