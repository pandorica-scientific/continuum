// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { bonusLabelSubset, detectBonus, extractCandidates, salaryStats } from '$lib/salary';

const czech = [
	'Hrubá mzda 62 000,00',
	'Prémie 8 000,00',
	'Zdravotní pojištění 2 790,00',
	'Sociální pojištění 4 340,00',
	'Záloha na daň 6 150,00',
	'K výplatě 45 231,00'
];

const english = [
	'Basic pay 4,200.00',
	'Performance bonus 1,150.00',
	'Income tax 812.00',
	'Net pay 3,538.00'
];

describe('detectBonus', () => {
	it('finds a Czech bonus line', () => {
		expect(detectBonus(extractCandidates(czech, 'CZK'))).toBe(800000n);
	});

	it('finds an English bonus line', () => {
		expect(detectBonus(extractCandidates(english, 'EUR'))).toBe(115000n);
	});

	it('sums several bonus lines on one slip', () => {
		// A slip can carry a monthly premium and a one-off award separately, and
		// reporting only the first would understate the month.
		const lines = ['Hrubá mzda 62 000,00', 'Prémie 8 000,00', 'Mimořádná odměna 12 000,00'];
		expect(detectBonus(extractCandidates(lines, 'CZK'))).toBe(2000000n);
	});

	it('matches with or without diacritics, the way the pay reader does', () => {
		expect(detectBonus(extractCandidates(['Odmena 5 000,00'], 'CZK'))).toBe(500000n);
		expect(detectBonus(extractCandidates(['Odměna 5 000,00'], 'CZK'))).toBe(500000n);
	});

	it('recognises a thirteenth salary', () => {
		expect(detectBonus(extractCandidates(['13. plat 40 000,00'], 'CZK'))).toBe(4000000n);
	});

	it('is null when the slip has no bonus, rather than zero', () => {
		// Null means "this slip did not say"; zero would claim it said none.
		const plain = ['Hrubá mzda 62 000,00', 'K výplatě 45 231,00'];
		expect(detectBonus(extractCandidates(plain, 'CZK'))).toBeNull();
	});

	it('does not mistake a bonus-shaped word inside a longer one', () => {
		expect(detectBonus(extractCandidates(['Bonusový program poplatek 100,00'], 'CZK'))).toBeNull();
	});

	it('prefers a learned label over the keywords', () => {
		// The same mechanism the pay amount already uses: a correction teaches it.
		const lines = ['Hrubá mzda 62 000,00', 'Pohyblivá složka 9 000,00'];
		expect(detectBonus(extractCandidates(lines, 'CZK'), ['pohyblivá složka'])).toBe(900000n);
	});
});

describe('salaryStats with bonuses', () => {
	const month = (periodMonth: string, gross: bigint, net: bigint, bonus?: bigint) => ({
		periodMonth,
		grossMinor: gross,
		netMinor: net,
		bonusMinor: bonus ?? null
	});

	it('separates base from bonus in the yearly gross', () => {
		const rows = salaryStats(
			[month('2025-01', 7000000n, 5000000n, 1000000n), month('2025-02', 6000000n, 4500000n)],
			null
		);
		expect(rows[0].grossTotalMinor).toBe(13000000n);
		expect(rows[0].bonusTotalMinor).toBe(1000000n);
		expect(rows[0].baseTotalMinor).toBe(12000000n);
	});

	it('totals the year’s net separately from its gross', () => {
		const rows = salaryStats(
			[month('2025-01', 7000000n, 5000000n), month('2025-02', 6000000n, 4500000n)],
			null
		);
		expect(rows[0].netTotalMinor).toBe(9500000n);
	});

	it('marks a year that does not have twelve net months', () => {
		// An annual total over three months is not a small year, it is a partial
		// one — and it looks like a 75% pay cut beside a complete year.
		const rows = salaryStats([month('2025-01', 7000000n, 5000000n)], null);
		expect(rows[0].netMonths).toBe(1);
		expect(rows[0].netComplete).toBe(false);
	});

	it('calls a full twelve months complete', () => {
		const months = Array.from({ length: 12 }, (_, i) =>
			month(`2025-${String(i + 1).padStart(2, '0')}`, 6000000n, 4500000n)
		);
		expect(salaryStats(months, null)[0].netComplete).toBe(true);
	});

	it('reports base change apart from total change, so a bonus is not a raise', () => {
		// Base flat, one bonus year. Total says +14% then −12%; base says neither
		// happened, which is the truth about the salary.
		const rows = salaryStats(
			[
				month('2024-01', 7000000n, 5000000n),
				month('2025-01', 8000000n, 5600000n, 1000000n),
				month('2026-01', 7000000n, 5000000n)
			],
			null
		);
		expect(rows[1].deltaPct).toBeGreaterThan(0);
		expect(rows[1].baseDeltaPct).toBe(0);
		expect(rows[2].baseDeltaPct).toBe(0);
	});

	it('carries a null bonus through as no bonus rather than as zero base', () => {
		const rows = salaryStats([month('2025-01', 7000000n, 5000000n)], null);
		expect(rows[0].bonusTotalMinor).toBe(0n);
		expect(rows[0].baseTotalMinor).toBe(7000000n);
	});

	it('never reports a negative base when a bonus exceeds the stated gross', () => {
		// A misread line, or a slip whose gross excludes the award. Clamped rather
		// than drawn upside down.
		const rows = salaryStats([month('2025-01', 500000n, 400000n, 900000n)], null);
		expect(rows[0].baseTotalMinor).toBe(0n);
	});
});

describe('bonusLabelSubset', () => {
	const twoLines = extractCandidates(
		['Hrubá mzda 62 000,00', 'Prémie 8 000,00', 'Mimořádná odměna 12 000,00'],
		'CZK'
	);

	it('finds the two labels behind a summed total', () => {
		// 8 000 + 12 000 = 20 000. Before v0.4.6 this returned nothing, so the
		// screen's promise to "remember the wording" silently did not happen.
		expect(bonusLabelSubset(twoLines, 2000000n)?.sort()).toEqual(
			['mimořádná odměna', 'prémie'].sort()
		);
	});

	it('prefers a single line when one matches exactly', () => {
		expect(bonusLabelSubset(twoLines, 800000n)).toEqual(['prémie']);
	});

	it('returns null when no subset of bonus lines sums to the total', () => {
		expect(bonusLabelSubset(twoLines, 999n)).toBeNull();
	});

	it('never reaches outside the bonus lines to reach the total', () => {
		// 62 000 is gross, not a bonus. A subset search over every candidate
		// would happily use it.
		expect(bonusLabelSubset(twoLines, 6200000n)).toBeNull();
	});
});

describe('detectBonus with learned labels', () => {
	it('sums every learned label present on the slip', () => {
		const c = extractCandidates(['Roční odměna 5 000,00', 'Cílová složka 3 000,00'], 'CZK');
		expect(detectBonus(c, ['roční odměna', 'cílová složka'])).toBe(800000n);
	});

	it('falls back to the keywords when no learned label is on this slip', () => {
		const c = extractCandidates(['Prémie 8 000,00'], 'CZK');
		expect(detectBonus(c, ['cílová složka'])).toBe(800000n);
	});
});

describe('detectBonus on tabular slips', () => {
	// One row, cells joined: the bonus, then the tax columns after it. Every
	// amount to the right carries a label that still contains "bonus", so summing
	// every match added the tax to the award — 65 251 + 65 251 + 202 441 + 34 823.
	const row = 'AIP bonus 65 251 65 251 Calculated advance tax 202 441 34 823';

	it('reports the award once, not the whole row', () => {
		expect(detectBonus(extractCandidates([row], 'CZK'))).toBe(6525100n);
	});

	it('leaves the bonus at or below gross, which is what made the month recordable', () => {
		const c = extractCandidates(
			['(1) Empl. rel. 01.10.2025 Gross salary 201 019 AIP bonus 65 251', row],
			'CZK'
		);
		expect(detectBonus(c)!).toBeLessThanOrEqual(20101900n);
	});

	it('still sums a genuine two-line bonus, where each label ends at its keyword', () => {
		const lines = ['Prémie 8 000,00', 'Mimořádná odměna 12 000,00'];
		expect(detectBonus(extractCandidates(lines, 'CZK'))).toBe(2000000n);
	});
});
