// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Whether a bottle wants drinking, and when.
 *
 * Years, not dates — a drink-by window is a precision nobody actually has,
 * so all comparisons are whole years. A bottle with no window (gin, rum,
 * most spirits) must say nothing at all rather than a false "drink soon".
 */

export interface DrinkWindow {
	/** The first year it is worth opening, if anybody said. */
	drinkFrom: number | null;
	/** The last year it is worth opening, if anybody said. */
	drinkTo: number | null;
}

export type DrinkPhase = 'too-young' | 'drinking-well' | 'drink-soon' | 'past' | 'keeps';

export function drinkPhase({ drinkFrom, drinkTo }: DrinkWindow, year: number): DrinkPhase {
	// No window, no opinion. Everything below assumes somebody said something.
	if (drinkFrom === null && drinkTo === null) return 'keeps';

	if (drinkTo !== null) {
		if (year > drinkTo) return 'past';
		// The closing year is the warning, even if the window opens the same year.
		if (year === drinkTo) return 'drink-soon';
	}

	if (drinkFrom !== null && year < drinkFrom) return 'too-young';

	return 'drinking-well';
}

/**
 * The traffic light, plus one that is not part of it. Blue for "too young"
 * deliberately — it's a fact, not a warning to open early. `keeps` uses
 * `--fg3` since it's the absence of an opinion, not an opinion.
 */
export function phaseHue(phase: DrinkPhase): string {
	switch (phase) {
		case 'too-young':
			return '--blue';
		case 'drinking-well':
			return '--green';
		case 'drink-soon':
			return '--yellow';
		case 'past':
			return '--red';
		case 'keeps':
			return '--fg3';
	}
}

export function phaseWord(phase: DrinkPhase): string {
	switch (phase) {
		case 'too-young':
			return 'Too young';
		case 'drinking-well':
			return 'Drinking well';
		case 'drink-soon':
			return 'Drink soon';
		case 'past':
			return 'Past its window';
		case 'keeps':
			return 'Keeps';
	}
}
