// SPDX-License-Identifier: AGPL-3.0-or-later
// A tax year card is drawn, never stored. These hold the derivation: which
// (year, country) cards exist, who is on each, and what the household's own
// corrections do to both.
//
// The country comes from the YEAR — a role period with a Czech employer, a
// filing already on record — never from crossing every country the household
// has ever seen with every year it has ever worked.
import { describe, expect, it } from 'vitest';
import { taxRowState, taxYearCards, type TaxYearInput } from '$lib/documents/tax-years';

const PEOPLE = [
	{ id: 'p1', name: 'Robert' },
	{ id: 'p2', name: 'Partner' }
];

const input = (over: Partial<TaxYearInput> = {}): TaxYearInput => ({
	engagements: over.engagements ?? [],
	filings: over.filings ?? [],
	overrides: over.overrides ?? [],
	people: over.people ?? PEOPLE,
	thisYear: over.thisYear ?? 2026
});

const job = (
	personId: string,
	country: string | null,
	startsOn: string | null,
	endsOn: string | null = null
) => ({ personId, country, startsOn, endsOn });

const keys = (cards: ReturnType<typeof taxYearCards>) => cards.map((c) => `${c.year} ${c.country}`);

describe('taxYearCards', () => {
	it('draws nothing when nothing says which country', () => {
		expect(taxYearCards(input({ engagements: [job('p1', null, '2023-04-01')] }))).toEqual([]);
	});

	it('draws a card per year of a role period, in that employer’s country', () => {
		const cards = taxYearCards(input({ engagements: [job('p1', 'CZ', '2024-04-01')] }));
		expect(keys(cards)).toEqual(['2026 CZ', '2025 CZ', '2024 CZ']);
	});

	// The complaint that started this: two employers in one year, one return.
	it('draws one card for a year worked at two employers in one country', () => {
		const cards = taxYearCards(
			input({
				engagements: [job('p1', 'CZ', '2024-01-01', '2025-05-31'), job('p1', 'CZ', '2025-06-01')]
			})
		);
		expect(cards.filter((c) => c.year === 2025)).toHaveLength(1);
	});

	// The reason the first cut was thrown away: Spain then Czechia must read as
	// Spanish years then Czech years, not as every country across every year.
	it('follows a career across countries year by year', () => {
		const cards = taxYearCards(
			input({
				engagements: [
					job('p1', 'ES', '2021-12-01', '2023-09-29'),
					job('p1', 'ES', '2023-10-01', '2024-05-29'),
					job('p1', 'CZ', '2024-06-01', '2025-09-29'),
					job('p1', 'CZ', '2025-10-01')
				]
			})
		);
		expect(keys(cards)).toEqual([
			'2026 CZ',
			'2025 CZ',
			'2024 CZ',
			'2024 ES',
			'2023 ES',
			'2022 ES',
			'2021 ES'
		]);
	});

	it('draws a card for a filing on record, with nobody employed there', () => {
		const cards = taxYearCards(input({ filings: [{ personId: 'p1', year: 2025, country: 'PL' }] }));
		expect(keys(cards)).toEqual(['2025 PL']);
		expect(cards[0].rows.map((r) => r.personId)).toEqual(['p1']);
	});

	it('does not spread a one-off filing’s country over other years', () => {
		const cards = taxYearCards(
			input({
				engagements: [job('p1', 'CZ', '2024-01-01')],
				filings: [{ personId: 'p1', year: 2025, country: 'PL' }]
			})
		);
		expect(keys(cards)).toEqual(['2026 CZ', '2025 CZ', '2025 PL', '2024 CZ']);
	});

	it('puts a person on a year and country their role period overlaps', () => {
		const cards = taxYearCards(
			input({
				engagements: [job('p1', 'CZ', '2024-01-01'), job('p2', 'CZ', '2026-02-01')]
			})
		);
		expect(cards.find((c) => c.year === 2024)?.rows.map((r) => r.personId)).toEqual(['p1']);
		expect(cards.find((c) => c.year === 2026)?.rows.map((r) => r.personId)).toEqual(['p1', 'p2']);
	});

	it('keeps a person off another country’s card for the same year', () => {
		const cards = taxYearCards(
			input({
				engagements: [job('p1', 'CZ', '2025-01-01'), job('p2', 'ES', '2025-01-01')],
				thisYear: 2025
			})
		);
		expect(cards.find((c) => c.country === 'CZ')?.rows.map((r) => r.personId)).toEqual(['p1']);
		expect(cards.find((c) => c.country === 'ES')?.rows.map((r) => r.personId)).toEqual(['p2']);
	});

	it('leaves a person off a year after their last role period closed', () => {
		const cards = taxYearCards(
			input({
				engagements: [job('p1', 'CZ', '2024-01-01', '2024-12-31'), job('p2', 'CZ', '2024-01-01')]
			})
		);
		expect(cards.find((c) => c.year === 2024)?.rows).toHaveLength(2);
		expect(cards.find((c) => c.year === 2025)?.rows.map((r) => r.personId)).toEqual(['p2']);
	});

	it('runs a role period with no start from the earliest year on record', () => {
		const cards = taxYearCards(
			input({
				engagements: [job('p1', 'CZ', null), job('p2', 'CZ', '2025-01-01')],
				thisYear: 2026
			})
		);
		expect(keys(cards)).toEqual(['2026 CZ', '2025 CZ']);
		expect(cards.every((c) => c.rows.some((r) => r.personId === 'p1'))).toBe(true);
	});

	it('adds a card the derivation missed', () => {
		const cards = taxYearCards(
			input({ overrides: [{ year: 2025, country: 'AT', personId: null, expected: true }] })
		);
		expect(keys(cards)).toEqual(['2025 AT']);
	});

	it('hides a card the derivation got wrong', () => {
		const cards = taxYearCards(
			input({
				engagements: [job('p1', 'CZ', '2025-01-01')],
				overrides: [{ year: 2025, country: 'CZ', personId: null, expected: false }]
			})
		);
		expect(keys(cards)).toEqual(['2026 CZ']);
	});

	it('adds a person with no income to a return', () => {
		const cards = taxYearCards(
			input({
				engagements: [job('p1', 'CZ', '2025-01-01', '2025-12-31')],
				thisYear: 2025,
				overrides: [{ year: 2025, country: 'CZ', personId: 'p2', expected: true }]
			})
		);
		expect(cards[0].rows.map((r) => r.personName)).toEqual(['Robert', 'Partner']);
	});

	it('takes a person off a return', () => {
		const cards = taxYearCards(
			input({
				engagements: [job('p1', 'CZ', '2025-01-01'), job('p2', 'CZ', '2025-01-01')],
				thisYear: 2025,
				overrides: [{ year: 2025, country: 'CZ', personId: 'p2', expected: false }]
			})
		);
		expect(cards[0].rows.map((r) => r.personId)).toEqual(['p1']);
	});

	it('folds a country typed in lower case, and drops prose', () => {
		const cards = taxYearCards(
			input({
				engagements: [job('p1', 'cz ', '2026-01-01'), job('p2', 'Czech Republic', '2026-01-01')]
			})
		);
		expect(keys(cards)).toEqual(['2026 CZ']);
		expect(cards[0].rows.map((r) => r.personId)).toEqual(['p1']);
	});

	it('sorts newest first, then by country', () => {
		const cards = taxYearCards(
			input({ engagements: [job('p1', 'CZ', '2025-01-01'), job('p1', 'AT', '2025-01-01')] })
		);
		expect(keys(cards)).toEqual(['2026 AT', '2026 CZ', '2025 AT', '2025 CZ']);
	});
});

describe('taxRowState', () => {
	it('is filed when anything is filed', () => {
		expect(taxRowState(1, 2025, 2026)).toBe('filed');
	});

	// A return for a year still running is not late.
	it('is open for the current year', () => {
		expect(taxRowState(0, 2026, 2026)).toBe('open');
	});

	it('is a gap once the year has ended', () => {
		expect(taxRowState(0, 2025, 2026)).toBe('gap');
	});
});
