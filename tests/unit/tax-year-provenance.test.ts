// SPDX-License-Identifier: AGPL-3.0-or-later
// WHY a card exists, and WHICH return it is.
//
// The screen offers one correction the household can make without filing
// anything — "end that role period and this obligation disappears" — and it can
// only offer it if the card remembers what raised it. And a cell that says
// "never filed" without saying whether the missing paper is the return you owed
// for living there or the second one a broker's country wanted is telling
// somebody to chase the wrong form.
import { describe, expect, it } from 'vitest';
import { taxYearCards, type TaxYearInput } from '$lib/documents/tax-years';

const PEOPLE = [{ id: 'p1', name: 'Robert' }];

const input = (over: Partial<TaxYearInput> = {}): TaxYearInput => ({
	engagements: over.engagements ?? [],
	filings: over.filings ?? [],
	overrides: over.overrides ?? [],
	people: over.people ?? PEOPLE,
	thisYear: over.thisYear ?? 2026,
	residenceDeclarations: over.residenceDeclarations,
	residenceStatements: over.residenceStatements,
	citizenship: over.citizenship
});

const at = (cards: ReturnType<typeof taxYearCards>, year: number, country: string) => {
	const card = cards.find((c) => c.year === year && c.country === country);
	if (!card) throw new Error(`no ${year} ${country} card`);
	return card;
};

describe('why a card exists', () => {
	it('names the employer whose role period raised it', () => {
		const cards = taxYearCards(
			input({
				engagements: [
					{
						personId: 'p1',
						country: 'CZ',
						startsOn: '2024-01-01',
						endsOn: '2024-12-31',
						organisationId: 'o1',
						organisationName: 'Oyster Czech Republic',
						organisationKind: 'employer'
					}
				]
			})
		);
		expect(at(cards, 2024, 'CZ').reasons).toContainEqual({
			source: 'engagement',
			personId: 'p1',
			country: 'CZ',
			organisationId: 'o1',
			organisationName: 'Oyster Czech Republic',
			organisationKind: 'employer'
		});
	});

	// The chip in the panel reads "XTB · brokerage · PL", and a broker is not an
	// employer: the kind travels so the panel does not have to guess it.
	it('carries the organisation kind, so a broker does not read as a job', () => {
		const cards = taxYearCards(
			input({
				engagements: [
					{
						personId: 'p1',
						country: 'PL',
						startsOn: '2025-01-01',
						endsOn: null,
						organisationId: 'o2',
						organisationName: 'XTB',
						organisationKind: 'broker'
					}
				]
			})
		);
		expect(at(cards, 2025, 'PL').reasons[0]).toMatchObject({
			source: 'engagement',
			organisationKind: 'broker'
		});
	});

	// A year with no work and no paper: the only thing holding the card up is
	// having lived somewhere, and the panel has to be able to say so.
	it('says residence where nothing but living there raised the card', () => {
		const cards = taxYearCards(input({ citizenship: { p1: 'CZ' }, thisYear: 2025 }));
		expect(at(cards, 2025, 'CZ').reasons).toContainEqual({
			source: 'residence',
			personId: 'p1',
			country: 'CZ',
			evidence: 'citizenship'
		});
	});

	it('says filing where paper already on record raised it', () => {
		const cards = taxYearCards(input({ filings: [{ personId: 'p1', year: 2025, country: 'PL' }] }));
		expect(at(cards, 2025, 'PL').reasons).toContainEqual({
			source: 'filing',
			personId: 'p1',
			country: 'PL'
		});
	});

	it('says added where somebody put the year up by hand', () => {
		const cards = taxYearCards(
			input({ overrides: [{ year: 2022, country: 'PT', personId: null, expected: true }] })
		);
		expect(at(cards, 2022, 'PT').reasons).toEqual([
			{ source: 'added', personId: null, country: 'PT' }
		]);
	});

	// The actionable reason goes first: ending a role period is the one way out
	// that does not involve filing anything.
	it('puts the role period before the rest', () => {
		const cards = taxYearCards(
			input({
				engagements: [
					{
						personId: 'p1',
						country: 'CZ',
						startsOn: '2025-01-01',
						endsOn: null,
						organisationId: 'o1',
						organisationName: 'MSD',
						organisationKind: 'employer'
					}
				],
				filings: [{ personId: 'p1', year: 2025, country: 'CZ' }],
				citizenship: { p1: 'CZ' }
			})
		);
		expect(at(cards, 2025, 'CZ').reasons.map((r) => r.source)).toEqual([
			'engagement',
			'filing',
			'residence'
		]);
	});
});

describe('which return a card is', () => {
	// Czechia by the filed statement, Poland only because a broker is there: the
	// Polish one is the second return, and saying so is the difference between
	// chasing a resident form and a non-resident one.
	it('marks the residence country residence and the other source', () => {
		const cards = taxYearCards(
			input({
				engagements: [
					{
						personId: 'p1',
						country: 'PL',
						startsOn: '2025-01-01',
						endsOn: null,
						organisationId: 'o2',
						organisationName: 'XTB',
						organisationKind: 'broker'
					}
				],
				residenceStatements: [{ personId: 'p1', year: 2025, country: 'CZ' }]
			})
		);
		expect(at(cards, 2025, 'CZ').returnKind).toBe('residence');
		expect(at(cards, 2025, 'PL').returnKind).toBe('source');
	});

	// The year somebody moved: two countries from the same tier, nothing filed.
	// Neither card may claim to be THE return until somebody says when.
	it('marks both countries unclear in a year residence cannot call', () => {
		const cards = taxYearCards(
			input({
				engagements: [
					{
						personId: 'p1',
						country: 'ES',
						startsOn: '2024-01-01',
						endsOn: '2024-05-31',
						organisationId: 'o3',
						organisationName: 'Oyster HR Spain',
						organisationKind: 'employer'
					},
					{
						personId: 'p1',
						country: 'CZ',
						startsOn: '2024-06-01',
						endsOn: null,
						organisationId: 'o1',
						organisationName: 'Oyster Czech Republic',
						organisationKind: 'employer'
					}
				],
				thisYear: 2024
			})
		);
		expect(at(cards, 2024, 'ES').returnKind).toBe('unclear');
		expect(at(cards, 2024, 'CZ').returnKind).toBe('unclear');
	});

	// A household that has recorded nothing about where anybody lives: the card
	// exists because paper was filed, and NOTHING is known about which return it
	// is. Calling that "residence unclear" would put a moved-year alarm on every
	// cell of a fresh instance.
	it('says unknown where no tier offered anything at all', () => {
		const cards = taxYearCards(input({ filings: [{ personId: 'p1', year: 2025, country: 'CZ' }] }));
		expect(at(cards, 2025, 'CZ').returnKind).toBe('unknown');
	});

	// Said out loud, the year is settled — and the country nobody lived in that
	// year goes back to being the second return.
	it('settles once residence is declared', () => {
		const cards = taxYearCards(
			input({
				engagements: [
					{
						personId: 'p1',
						country: 'ES',
						startsOn: '2024-01-01',
						endsOn: '2024-05-31',
						organisationId: 'o3',
						organisationName: 'Oyster HR Spain',
						organisationKind: 'employer'
					},
					{
						personId: 'p1',
						country: 'CZ',
						startsOn: '2024-06-01',
						endsOn: null,
						organisationId: 'o1',
						organisationName: 'Oyster Czech Republic',
						organisationKind: 'employer'
					}
				],
				residenceDeclarations: [
					{ personId: 'p1', year: 2024, country: 'CZ', fromOn: null, toOn: null }
				],
				thisYear: 2024
			})
		);
		expect(at(cards, 2024, 'CZ').returnKind).toBe('residence');
		expect(at(cards, 2024, 'ES').returnKind).toBe('source');
	});
});
