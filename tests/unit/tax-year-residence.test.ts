// SPDX-License-Identifier: AGPL-3.0-or-later
// Residence raising a card of its own is the point of the whole tier: a return
// is owed for having lived somewhere, not for having earned there, so the year
// nobody worked is the year this has to get right.
import { describe, expect, it } from 'vitest';
import { taxResidences, taxYearCards, type TaxYearInput } from '$lib/documents/tax-years';
import { foldFilingAge } from '$lib/server/settings';

const ROBERT = { id: 'p1', name: 'Robert' };

const input = (over: Partial<TaxYearInput> = {}): TaxYearInput => ({
	engagements: [],
	filings: [],
	overrides: [],
	people: [ROBERT],
	thisYear: 2026,
	...over
});

const job = (
	personId: string,
	country: string,
	startsOn: string,
	endsOn: string | null = null
) => ({
	personId,
	country,
	startsOn,
	endsOn
});

const keys = (cards: { year: number; country: string }[]) =>
	cards.map((card) => `${card.year} ${card.country}`).sort();

describe('residence as a source of cards', () => {
	// The safe default, and the reason this can ship before anybody fills in
	// their household: with no citizenship on file the tier contributes nothing
	// and the grid is exactly what it was.
	it('adds nothing at all until citizenship is recorded', () => {
		const withEngagement = input({
			engagements: [{ personId: 'p1', country: 'CZ', startsOn: '2025-01-01', endsOn: null }]
		});
		expect(keys(taxYearCards(withEngagement))).toEqual(['2025 CZ', '2026 CZ']);
	});

	// The gap year. No role period, no filing, and a nil return still owed.
	it('raises the year with no work once citizenship is known', () => {
		const cards = taxYearCards(
			input({
				engagements: [
					{ personId: 'p1', country: 'CZ', startsOn: '2024-01-01', endsOn: '2024-12-31' }
				],
				citizenship: { p1: 'PL' },
				thisYear: 2025
			})
		);
		// 2024 is Czech because that is where the work was; 2025 has no work at
		// all and falls to citizenship rather than vanishing.
		expect(keys(cards)).toEqual(['2024 CZ', '2025 PL']);
		expect(cards.find((c) => c.year === 2025)?.rows).toEqual([
			{ personId: 'p1', personName: 'Robert' }
		]);
	});

	// The drift this design exists to prevent: leaving a country must stop
	// raising its returns, not keep doing it forever.
	it('does not carry a country forward past the work that put it there', () => {
		const cards = taxYearCards(
			input({
				engagements: [
					{ personId: 'p1', country: 'ES', startsOn: '2021-01-01', endsOn: '2021-12-31' }
				],
				citizenship: { p1: 'PL' },
				thisYear: 2023
			})
		);
		expect(keys(cards)).toEqual(['2021 ES', '2022 PL', '2023 PL']);
	});

	it('takes a declaration over the country somebody worked in', () => {
		const cards = taxYearCards(
			input({
				engagements: [{ personId: 'p1', country: 'ES', startsOn: '2024-01-01', endsOn: null }],
				residenceDeclarations: [
					{ personId: 'p1', year: 2024, country: 'CZ', fromOn: null, toOn: null }
				],
				citizenship: { p1: 'PL' },
				thisYear: 2024
			})
		);
		// Spain still owes: the role period is income arising there. Czechia is
		// added because that is where they say they lived.
		expect(keys(cards)).toEqual(['2024 CZ', '2024 ES']);
	});

	// A move splits the year, and both halves owe — the move date is not a
	// choice between two countries.
	it('keeps both countries of a year somebody moved in', () => {
		const cards = taxYearCards(
			input({
				residenceDeclarations: [
					{ personId: 'p1', year: 2024, country: 'ES', fromOn: null, toOn: '2024-06-30' },
					{ personId: 'p1', year: 2024, country: 'CZ', fromOn: '2024-07-01', toOn: null }
				],
				filings: [{ personId: 'p1', year: 2024, country: 'ES' }],
				thisYear: 2024
			})
		);
		expect(keys(cards)).toEqual(['2024 CZ', '2024 ES']);
	});

	// A household that genuinely does not file where it lives can still say so;
	// residence proposes, the override disposes.
	it('lets a card-level override remove a residence-raised year', () => {
		const cards = taxYearCards(
			input({
				filings: [{ personId: 'p1', year: 2025, country: 'CZ' }],
				citizenship: { p1: 'PL' },
				overrides: [{ year: 2025, country: 'PL', personId: null, expected: false }],
				thisYear: 2025
			})
		);
		expect(keys(cards)).toEqual(['2025 CZ']);
	});

	it('reports which tier settled each year', () => {
		const resolved = taxResidences(
			input({
				engagements: [
					{ personId: 'p1', country: 'ES', startsOn: '2024-01-01', endsOn: '2024-12-31' }
				],
				residenceStatements: [{ personId: 'p1', year: 2025, country: 'CZ' }],
				filings: [{ personId: 'p1', year: 2025, country: 'CZ' }],
				citizenship: { p1: 'PL' },
				thisYear: 2026
			})
		);
		const tier = (year: number) => resolved.find((r) => r.year === year)?.residence.evidence;
		expect(tier(2024)).toBe('employment');
		expect(tier(2025)).toBe('statement');
		expect(tier(2026)).toBe('citizenship');
	});

	// A household's earliest year is not a year every member of it owed a return
	// for. Without a per-person floor, somebody added later acquires a
	// never-filed return for every year back to a housemate's first job.
	it('does not raise years for a person before they had anything', () => {
		const cards = taxYearCards(
			input({
				people: [
					{ id: 'p1', name: 'Robert' },
					{ id: 'p2', name: 'Newcomer' }
				],
				engagements: [job('p1', 'CZ', '2015-01-01')],
				citizenship: { p1: 'CZ', p2: 'CZ' },
				birthYears: { p2: 2004 },
				thisYear: 2026
			})
		);
		const rowsFor = (year: number) =>
			cards.find((c) => c.year === year && c.country === 'CZ')?.rows.map((r) => r.personId) ?? [];
		expect(rowsFor(2015)).toEqual(['p1']);
		// 2022 is the year they turned eighteen; 2021 is a year they were a minor
		// with nothing of their own, which owes nothing.
		expect(rowsFor(2021)).toEqual(['p1']);
		expect(rowsFor(2022)).toEqual(['p1', 'p2']);
	});

	// The bug this rule exists for: a baby born into the household arrived
	// already owing a nil return for the year of their birth, because the
	// citizenship tier answers every year it is asked about.
	it('raises nothing for a child with no income of their own', () => {
		const cards = taxYearCards(
			input({
				people: [
					{ id: 'p1', name: 'Robert' },
					{ id: 'p2', name: 'Oliwia' }
				],
				engagements: [job('p1', 'CZ', '2021-01-01')],
				citizenship: { p1: 'CZ', p2: 'PL' },
				birthYears: { p1: 1992, p2: 2026 },
				thisYear: 2026
			})
		);
		// No Polish card at all: the only thing that wanted one was a newborn's
		// citizenship.
		expect(keys(cards)).toEqual(['2021 CZ', '2022 CZ', '2023 CZ', '2024 CZ', '2025 CZ', '2026 CZ']);
		expect(cards.every((card) => card.rows.every((row) => row.personId === 'p1'))).toBe(true);
	});

	// A minor with a job, a filing or a declared residence has evidence of their
	// own, and the age bound never touches those tiers.
	it('still raises the year a minor actually earned in', () => {
		const cards = taxYearCards(
			input({
				people: [{ id: 'p2', name: 'Oliwia' }],
				engagements: [job('p2', 'PL', '2042-06-01', '2042-08-31')],
				citizenship: { p2: 'PL' },
				birthYears: { p2: 2026 },
				thisYear: 2042
			})
		);
		expect(keys(cards)).toEqual(['2042 PL']);
		expect(cards[0].rows).toEqual([{ personId: 'p2', personName: 'Oliwia' }]);
	});

	// The household's own answer wins over the default: a country that starts
	// earlier, or a household that wants the floor tier off the age rule.
	it('takes the filing age from the household', () => {
		const withAge = (filingAge: number) =>
			keys(
				taxYearCards(
					input({
						people: [{ id: 'p2', name: 'Oliwia' }],
						citizenship: { p2: 'PL' },
						birthYears: { p2: 2010 },
						filingAge,
						thisYear: 2026
					})
				)
			);
		// Sixteen in 2026, so a sixteen-year-old floor raises the year and the
		// default does not.
		expect(withAge(16)).toEqual(['2026 PL']);
		expect(withAge(18)).toEqual([]);
		// Zero turns the rule off entirely.
		expect(withAge(0)).toEqual(['2026 PL']);
	});

	// No work, no paper, no birth year: asked about the year in progress and no
	// earlier one, rather than about every year somebody else has been working.
	it('asks only about this year for a person nothing is known about', () => {
		const cards = taxYearCards(
			input({
				people: [
					{ id: 'p1', name: 'Robert' },
					{ id: 'p2', name: 'Unknown' }
				],
				engagements: [job('p1', 'CZ', '2020-01-01')],
				citizenship: { p1: 'CZ', p2: 'CZ' },
				thisYear: 2022
			})
		);
		const rowsFor = (year: number) =>
			cards.find((c) => c.year === year && c.country === 'CZ')?.rows.map((r) => r.personId) ?? [];
		expect(rowsFor(2020)).toEqual(['p1']);
		expect(rowsFor(2021)).toEqual(['p1']);
		expect(rowsFor(2022)).toEqual(['p1', 'p2']);
	});
});

// The setting is typed into a form, so blank and scientific-notation input
// have to be refused rather than read the way Number() reads them: '' as 0
// would put every newborn back on the grid.
describe('reading the filing age from a form or the settings table', () => {
	it('takes a whole age from 0 to 120, as a number or as digits', () => {
		expect(foldFilingAge(18)).toBe(18);
		expect(foldFilingAge(' 16 ')).toBe(16);
		expect(foldFilingAge('0')).toBe(0);
		expect(foldFilingAge(120)).toBe(120);
	});

	it('refuses blank, non-decimal and out-of-range input', () => {
		for (const bad of [
			'',
			'   ',
			'1e1',
			'0x12',
			'-1',
			'18.5',
			'121',
			'abc',
			null,
			undefined,
			-1,
			18.5,
			121
		]) {
			expect(foldFilingAge(bad)).toBeNull();
		}
	});
});
