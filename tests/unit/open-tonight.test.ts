// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What to open tonight.
 *
 * The reason is derived, not written: each suggestion carries the rule that
 * produced it, so a household can disagree with the reasoning rather than with
 * the taste. And a box with nothing to suggest is worse than no box.
 */
import { describe, expect, it } from 'vitest';
import { MOST_SUGGESTIONS, openTonight, type Candidate } from '$lib/life/collections/open-tonight';

const YEAR = 2026;

const bottle = (over: Partial<Candidate> & { id: string }): Candidate => ({
	producer: 'Quinta do Vale',
	name: 'Reserva Tinto',
	owned: 2,
	opened: 0,
	score: null,
	monthsSinceTasted: null,
	drinkFrom: null,
	drinkTo: null,
	...over
});

describe('a cellar with nothing to say', () => {
	// The card does not draw at all when this is empty.
	it('suggests nothing when nothing has a window or a score', () => {
		expect(
			openTonight([bottle({ id: 'a' }), bottle({ id: 'b' }), bottle({ id: 'c' })], YEAR)
		).toEqual([]);
	});

	it('suggests nothing from an empty cellar', () => {
		expect(openTonight([], YEAR)).toEqual([]);
	});
});

describe('a window that is closing', () => {
	it('says so, in the words the handoff uses', () => {
		const found = openTonight([bottle({ id: 'a', drinkTo: YEAR })], YEAR);
		expect(found).toHaveLength(1);
		expect(found[0].because).toBe('Its drink-by window closes this year.');
	});

	it('says something different once the window has gone', () => {
		const found = openTonight([bottle({ id: 'a', drinkTo: YEAR - 2 })], YEAR);
		expect(found[0].because).toBe('Its drink-by window has closed.');
	});

	it('has nothing to say about a bottle that is too young', () => {
		expect(openTonight([bottle({ id: 'a', drinkFrom: YEAR + 4 })], YEAR)).toEqual([]);
	});
});

describe('a good bottle left alone', () => {
	it('says the score and how long it has been', () => {
		const found = openTonight([bottle({ id: 'a', score: 94, monthsSinceTasted: 14 })], YEAR);
		expect(found[0].because).toBe('You scored it 94 and have not opened one in 14 months.');
	});

	it('counts in years once it has been that long', () => {
		const found = openTonight([bottle({ id: 'a', score: 96, monthsSinceTasted: 30 })], YEAR);
		expect(found[0].because).toBe('You scored it 96 and have not opened one in 2 years.');
	});

	// Saying "have not opened one in N months" about a bottle nobody has ever
	// opened would be inventing a fact.
	it('stays quiet about a bottle nobody has ever tasted', () => {
		expect(openTonight([bottle({ id: 'a', score: 97, monthsSinceTasted: null })], YEAR)).toEqual(
			[]
		);
	});

	it('stays quiet about a bottle nobody rated highly', () => {
		expect(openTonight([bottle({ id: 'a', score: 78, monthsSinceTasted: 40 })], YEAR)).toEqual([]);
	});

	it('stays quiet while it was tasted recently', () => {
		expect(openTonight([bottle({ id: 'a', score: 95, monthsSinceTasted: 3 })], YEAR)).toEqual([]);
	});
});

describe('which two', () => {
	// Telling somebody to open the bottle already open on the counter is the
	// kind of advice that gets a screen ignored.
	it('never suggests a bottle with nothing sealed left', () => {
		expect(openTonight([bottle({ id: 'a', owned: 1, opened: 1, drinkTo: YEAR })], YEAR)).toEqual(
			[]
		);
		expect(openTonight([bottle({ id: 'a', owned: 0, opened: 0, drinkTo: YEAR })], YEAR)).toEqual(
			[]
		);
	});

	it('stops at two', () => {
		const found = openTonight(
			[
				bottle({ id: 'a', drinkTo: YEAR }),
				bottle({ id: 'b', drinkTo: YEAR }),
				bottle({ id: 'c', drinkTo: YEAR })
			],
			YEAR
		);
		expect(found).toHaveLength(MOST_SUGGESTIONS);
	});

	// A deadline beats a preference.
	it('puts a closing window ahead of a good score', () => {
		const found = openTonight(
			[
				bottle({ id: 'scored', score: 98, monthsSinceTasted: 40 }),
				bottle({ id: 'closing', drinkTo: YEAR })
			],
			YEAR
		);
		expect(found[0].id).toBe('closing');
	});

	it('never fills both slots with the same bottle', () => {
		const found = openTonight(
			[bottle({ id: 'a', drinkTo: YEAR, score: 95, monthsSinceTasted: 20 })],
			YEAR
		);
		expect(found).toHaveLength(1);
	});
});
