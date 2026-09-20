// SPDX-License-Identifier: AGPL-3.0-or-later
// Residence decides that a return is owed at all, so the tier that answered
// matters as much as the country it answered with: a guess drawn as confidently
// as a filed statement is how a household stops checking.
import { describe, expect, it } from 'vitest';
import {
	residenceCountries,
	residenceForYear,
	residenceIsProved,
	residenceNeedsAnswer,
	type ResidenceInput
} from '$lib/tax-residence';

const input = (over: Partial<ResidenceInput> = {}): ResidenceInput => ({
	declared: [],
	statementCountries: [],
	employmentCountries: [],
	citizenship: null,
	...over
});

describe('residenceForYear', () => {
	it('takes a declaration over everything derived', () => {
		const result = residenceForYear(
			input({
				declared: [{ country: 'CZ', fromOn: null, toOn: null }],
				statementCountries: ['ES'],
				employmentCountries: ['ES'],
				citizenship: 'PL'
			})
		);
		expect(result.evidence).toBe('declared');
		expect(residenceCountries(result)).toEqual(['CZ']);
		expect(result.ambiguous).toBe(false);
	});

	// The only tier a person writes is the only one that can say "I moved in
	// July", so it is the only one that may return two periods.
	it('keeps both halves of a year somebody moved in', () => {
		const result = residenceForYear(
			input({
				declared: [
					{ country: 'ES', fromOn: null, toOn: '2024-06-30' },
					{ country: 'CZ', fromOn: '2024-07-01', toOn: null }
				]
			})
		);
		expect(result.periods).toHaveLength(2);
		expect(residenceCountries(result)).toEqual(['CZ', 'ES']);
		// Two residences is the answer, not a question.
		expect(residenceNeedsAnswer(result)).toBe(false);
	});

	it('reads a filed residence return when nothing was declared', () => {
		const result = residenceForYear(
			input({ statementCountries: ['CZ'], employmentCountries: ['ES'], citizenship: 'PL' })
		);
		expect(result.evidence).toBe('statement');
		expect(residenceCountries(result)).toEqual(['CZ']);
		expect(residenceIsProved(result)).toBe(true);
	});

	// Two residence returns in one year is a contradiction: one of them is
	// really a source return, or the year was split. Either way the app must
	// not pick — it asks, and raises the obligation in both meanwhile.
	it('refuses to choose between two filed residence returns', () => {
		const result = residenceForYear(input({ statementCountries: ['CZ', 'PL'] }));
		expect(result.ambiguous).toBe(true);
		expect(result.candidates).toEqual(['CZ', 'PL']);
		expect(residenceCountries(result)).toEqual(['CZ', 'PL']);
	});

	it('falls to where they worked, and says it is a guess', () => {
		const result = residenceForYear(input({ employmentCountries: ['ES'], citizenship: 'PL' }));
		expect(result.evidence).toBe('employment');
		expect(residenceCountries(result)).toEqual(['ES']);
		expect(residenceIsProved(result)).toBe(false);
	});

	// 2024 in the real household: Spanish employment and Czech employment, and
	// neither return ever filed. Nothing can settle it, and both still owe.
	it('asks about a year worked in two countries', () => {
		const result = residenceForYear(
			input({ employmentCountries: ['ES', 'CZ'], citizenship: 'PL' })
		);
		expect(result.evidence).toBe('employment');
		expect(result.ambiguous).toBe(true);
		expect(result.candidates).toEqual(['CZ', 'ES']);
		expect(residenceNeedsAnswer(result)).toBe(true);
	});

	// The gap year. No work, no investments, no rent — and a return still owed
	// where they live, as a nil return. Deriving from income alone loses this.
	it('falls back to citizenship for a year with nothing in it', () => {
		const result = residenceForYear(input({ citizenship: 'PL' }));
		expect(result.evidence).toBe('citizenship');
		expect(residenceCountries(result)).toEqual(['PL']);
		expect(result.ambiguous).toBe(false);
	});

	it('has no answer at all when citizenship was never recorded', () => {
		const result = residenceForYear(input());
		expect(result.periods).toEqual([]);
		expect(residenceNeedsAnswer(result)).toBe(true);
	});

	// A mixed-case code arriving from a form would otherwise read as a second
	// country and turn a settled year into a move.
	it('folds country codes before comparing them', () => {
		const result = residenceForYear(input({ employmentCountries: ['cz', 'CZ', ' Cz '] }));
		expect(result.ambiguous).toBe(false);
		expect(residenceCountries(result)).toEqual(['CZ']);
	});

	it('ignores a country code that is not alpha-2', () => {
		const result = residenceForYear(input({ employmentCountries: ['CZE', ''], citizenship: 'PL' }));
		expect(result.evidence).toBe('citizenship');
		expect(residenceCountries(result)).toEqual(['PL']);
	});
});

// The drift this design exists to prevent: residence that carried over would
// keep raising Spanish returns for years after somebody left Spain, silently.
// There is no parameter for the previous year, which is the enforcement.
describe('no carry-forward', () => {
	it('resolves each year only from that year, so a settled year cannot leak', () => {
		const settled = residenceForYear(input({ statementCountries: ['ES'] }));
		const after = residenceForYear(input({ citizenship: 'PL' }));
		expect(residenceCountries(settled)).toEqual(['ES']);
		expect(residenceCountries(after)).toEqual(['PL']);
	});
});
