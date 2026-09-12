// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Whether a bottle wants drinking, and when.
 *
 * Years, not dates: a drink-by window is a thing people hold in years, and
 * storing a day would be a precision nobody has. So the arithmetic compares
 * whole years and nothing here needs a clock.
 *
 * The gate at the top is the whole point. A bottle with no window has no
 * opinion — gin, rum, most spirits — and must say nothing at all. Without it,
 * every bottle in the cellar gets told to drink soon inside a window that does
 * not exist.
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
		// The closing year IS the warning. Saying "drinking well" in the year a
		// window shuts is true and useless, so the warning wins even where the
		// window opens and closes in the same year.
		if (year === drinkTo) return 'drink-soon';
	}

	if (drinkFrom !== null && year < drinkFrom) return 'too-young';

	return 'drinking-well';
}

/**
 * The traffic light, plus one that is not part of it.
 *
 * Blue for "too young" deliberately: it is a fact about the bottle, not a
 * warning about it, and yellow would have somebody opening it early to make the
 * screen calm down. `keeps` takes `--fg3` because it is the absence of an
 * opinion rather than an opinion.
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
