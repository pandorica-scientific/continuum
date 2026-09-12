// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What to open tonight, and why.
 *
 * Every suggestion carries the rule that produced it, so a household can
 * disagree with the reasoning rather than with the taste. "Open this" is an
 * opinion nobody asked for; "its window closes this year" is a fact they can
 * argue with.
 *
 * Two at most. A list of eight suggestions is a second bottle grid, and a
 * suggestion that has to be scrolled to is not a suggestion.
 */
import { drinkPhase, type DrinkWindow } from '$lib/life/collections/drink-by';

export const MOST_SUGGESTIONS = 2;

/** A score at or above this is worth mentioning on its own. */
const WORTH_SAYING = 90;

/** How long a good bottle can sit unopened before it is worth a nudge. */
const MONTHS_UNOPENED = 12;

export interface Candidate extends DrinkWindow {
	id: string;
	producer: string;
	name: string;
	owned: number;
	opened: number;
	score: number | null;
	/** Whole months since the last logged tasting, or null if there never was one. */
	monthsSinceTasted: number | null;
}

export interface Suggestion {
	id: string;
	producer: string;
	name: string;
	/** The rule that produced it, said in one line. */
	because: string;
}

/**
 * At most two bottles worth opening, each with its reason.
 *
 * Only sealed bottles are suggested: telling somebody to open the bottle
 * already open on the counter is the kind of advice that gets a screen ignored.
 */
export function openTonight(cellar: Candidate[], year: number): Suggestion[] {
	const sealed = cellar.filter((one) => one.owned - one.opened > 0);

	const closing = sealed
		.filter((one) => drinkPhase(one, year) === 'drink-soon' || drinkPhase(one, year) === 'past')
		.sort((a, b) => (a.drinkTo ?? 0) - (b.drinkTo ?? 0))
		.map((one) => ({
			id: one.id,
			producer: one.producer,
			name: one.name,
			because:
				drinkPhase(one, year) === 'past'
					? 'Its drink-by window has closed.'
					: 'Its drink-by window closes this year.'
		}));

	// A bottle somebody rated and then left alone. Only where there IS a last
	// tasting: a bottle nobody has ever opened has no "have not opened one in
	// fourteen months" to report, and saying it anyway would be inventing a fact.
	const neglected = sealed
		.filter(
			(one) =>
				one.score !== null &&
				one.score >= WORTH_SAYING &&
				one.monthsSinceTasted !== null &&
				one.monthsSinceTasted >= MONTHS_UNOPENED
		)
		.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
		.map((one) => ({
			id: one.id,
			producer: one.producer,
			name: one.name,
			because: `You scored it ${one.score} and have not opened one in ${monthsWord(
				one.monthsSinceTasted as number
			)}.`
		}));

	// A closing window beats a good score: one is a deadline, the other is a
	// preference. De-duplicated by bottle, so one row never fills both slots.
	const seen = new Set<string>();
	const picked: Suggestion[] = [];
	for (const suggestion of [...closing, ...neglected]) {
		if (seen.has(suggestion.id)) continue;
		seen.add(suggestion.id);
		picked.push(suggestion);
		if (picked.length === MOST_SUGGESTIONS) break;
	}
	return picked;
}

/** "fourteen months" / "two years" — said the way the handoff writes it. */
function monthsWord(months: number): string {
	if (months >= 24) return `${Math.floor(months / 12)} years`;
	return `${months} months`;
}
