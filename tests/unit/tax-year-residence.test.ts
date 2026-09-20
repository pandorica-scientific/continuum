// SPDX-License-Identifier: AGPL-3.0-or-later
// Residence raising a card of its own is the point of the whole tier: a return
// is owed for having lived somewhere, not for having earned there, so the year
// nobody worked is the year this has to get right.
import { describe, expect, it } from 'vitest';
import { taxResidences, taxYearCards, type TaxYearInput } from '$lib/documents/tax-years';

const ROBERT = { id: 'p1', name: 'Robert' };

const input = (over: Partial<TaxYearInput> = {}): TaxYearInput => ({
	engagements: [],
	filings: [],
	overrides: [],
	people: [ROBERT],
	thisYear: 2026,
	...over
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
});
