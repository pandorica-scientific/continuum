// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * When a bottle wants drinking.
 *
 * The gate is the whole point: a bottle with no window has no opinion, and
 * without that gate a bottle of gin gets told to "drink soon" inside a window
 * that does not exist.
 */
import { describe, expect, it } from 'vitest';
import { drinkPhase, phaseHue, phaseWord } from '$lib/life/collections/drink-by';

const THIS_YEAR = 2026;

describe('a bottle with no window', () => {
	it('keeps', () => {
		expect(drinkPhase({ drinkFrom: null, drinkTo: null }, THIS_YEAR)).toBe('keeps');
	});

	// Gin does not go off, and the screen must not imply it does.
	it('shows no marker and takes no traffic-light colour', () => {
		expect(phaseHue('keeps')).toBe('--fg3');
	});
});

describe('a window that has only opened', () => {
	it('is too young before it', () => {
		expect(drinkPhase({ drinkFrom: THIS_YEAR + 2, drinkTo: null }, THIS_YEAR)).toBe('too-young');
	});

	it('drinks well from the year it opens', () => {
		expect(drinkPhase({ drinkFrom: THIS_YEAR, drinkTo: null }, THIS_YEAR)).toBe('drinking-well');
		expect(drinkPhase({ drinkFrom: THIS_YEAR - 5, drinkTo: null }, THIS_YEAR)).toBe(
			'drinking-well'
		);
	});
});

describe('a window that only closes', () => {
	it('drinks well while the year is inside it', () => {
		expect(drinkPhase({ drinkFrom: null, drinkTo: THIS_YEAR + 3 }, THIS_YEAR)).toBe(
			'drinking-well'
		);
	});

	it('says drink soon in the closing year', () => {
		expect(drinkPhase({ drinkFrom: null, drinkTo: THIS_YEAR }, THIS_YEAR)).toBe('drink-soon');
	});

	it('is past once the year has gone', () => {
		expect(drinkPhase({ drinkFrom: null, drinkTo: THIS_YEAR - 1 }, THIS_YEAR)).toBe('past');
	});
});

describe('both ends', () => {
	it('walks the whole window', () => {
		const window = { drinkFrom: 2024, drinkTo: 2028 };
		expect(drinkPhase(window, 2023)).toBe('too-young');
		// On the opening boundary exactly.
		expect(drinkPhase(window, 2024)).toBe('drinking-well');
		expect(drinkPhase(window, 2026)).toBe('drinking-well');
		// The closing year itself is the warning, not the year after.
		expect(drinkPhase(window, 2028)).toBe('drink-soon');
		expect(drinkPhase(window, 2029)).toBe('past');
	});

	// A window of one year opens and closes at once, and the closing half wins:
	// telling somebody it drinks well in the year it stops doing so is useless.
	it('warns when a one-year window opens and closes together', () => {
		expect(drinkPhase({ drinkFrom: THIS_YEAR, drinkTo: THIS_YEAR }, THIS_YEAR)).toBe('drink-soon');
	});
});

describe('what each phase is called and inked in', () => {
	// Blue is a series colour and is right here: too young is not a warning.
	it('takes its colours from the traffic light', () => {
		expect(phaseHue('too-young')).toBe('--blue');
		expect(phaseHue('drinking-well')).toBe('--green');
		expect(phaseHue('drink-soon')).toBe('--yellow');
		expect(phaseHue('past')).toBe('--red');
	});

	it('says it the way a person would', () => {
		expect(phaseWord('too-young')).toBe('Too young');
		expect(phaseWord('drinking-well')).toBe('Drinking well');
		expect(phaseWord('drink-soon')).toBe('Drink soon');
		expect(phaseWord('past')).toBe('Past its window');
		expect(phaseWord('keeps')).toBe('Keeps');
	});
});
