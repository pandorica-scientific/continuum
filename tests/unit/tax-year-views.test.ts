// SPDX-License-Identifier: AGPL-3.0-or-later
// The two ways the Tax years tab draws its cards: the household grid, where
// everybody is folded into one cell per year and country, and the per-person
// breakdown, where each person's countries are lanes on one time axis. Plus
// the rule that keeps an earnings report from counting as the return.
import { describe, expect, it } from 'vitest';
import { isSupportingPaper, taxYearGrid, type CardForView } from '$lib/documents/tax-years';

const R = { personId: 'p1', personName: 'Robert' };
const P = { personId: 'p2', personName: 'Partner' };

const CARDS: CardForView[] = [
	{ year: 2026, country: 'CZ', rows: [{ ...R, state: 'open' }] },
	{
		year: 2025,
		country: 'CZ',
		rows: [
			{ ...R, state: 'filed' },
			{ ...P, state: 'gap' }
		]
	},
	{ year: 2025, country: 'PL', rows: [{ ...R, state: 'gap' }] },
	{ year: 2024, country: 'CZ', rows: [{ ...R, state: 'gap' }] },
	{ year: 2024, country: 'ES', rows: [{ ...R, state: 'filed' }] },
	{ year: 2023, country: 'ES', rows: [] }
];

describe('taxYearGrid', () => {
	const grid = taxYearGrid(CARDS);
	const at = (year: number, country: string) =>
		grid.cells.find((c) => c.year === year && c.country === country)!;

	it('lays years newest-first down and countries alphabetically across', () => {
		expect(grid.years).toEqual([2026, 2025, 2024, 2023]);
		expect(grid.countries).toEqual(['CZ', 'ES', 'PL']);
		expect(grid.cells).toHaveLength(12);
	});

	it('is filed only when everyone who owes has filed', () => {
		expect(at(2024, 'ES').state).toBe('filed');
		// One of two has filed: the household is not done.
		expect(at(2025, 'CZ')).toMatchObject({ state: 'partial', filed: 1, owed: 2 });
	});

	it('is a gap when nobody has filed and the year is over', () => {
		expect(at(2024, 'CZ').state).toBe('gap');
		expect(at(2025, 'PL').state).toBe('gap');
	});

	it('is open for the year still running', () => {
		expect(at(2026, 'CZ').state).toBe('open');
	});

	// A blank cell is how the grid says "you never had to file here".
	it('is none where no card exists, or nobody is on it', () => {
		expect(at(2026, 'ES').state).toBe('none');
		expect(at(2023, 'ES')).toMatchObject({ state: 'none', owed: 0 });
	});
});

describe('isSupportingPaper', () => {
	it('recognises the Tax screen’s own kind tags for reports', () => {
		expect(isSupportingPaper(['employer report'])).toBe(true);
		expect(isSupportingPaper(['Broker Report'])).toBe(true);
	});

	it('treats a statement, and anything untagged, as the return', () => {
		expect(isSupportingPaper(['tax statement'])).toBe(false);
		expect(isSupportingPaper(['tax'])).toBe(false);
		expect(isSupportingPaper([])).toBe(false);
		expect(isSupportingPaper(['2025', 'urgent'])).toBe(false);
	});
});
