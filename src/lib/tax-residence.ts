// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Where a person was tax-resident in one year, and how we know it.
 *
 * Residence is what decides that a return is owed at all. Income decides the
 * amount and whether a second country wants one of its own; it does not decide
 * whether anything is due. A year with no work, no investments and no rent
 * still owes a return where the person lived — filed as a nil return — and
 * deriving obligations from income alone makes exactly that year invisible.
 *
 * FOUR TIERS, strongest first. Each answers only if the one above it could not:
 *
 *   declared     somebody said so, on `tax_residence`. An override in the same
 *                sense as `tax_filing_override`: it exists to correct the
 *                derivation, so it wins, and it is the only tier that can split
 *                a year in two.
 *   statement    a filed statement marked `role = 'residence'`. The strongest
 *                derived evidence, because a filed return is a fact rather than
 *                an inference — which is also why a statement marked `source`
 *                proves nothing about residence.
 *   employment   the countries the person had a role period in. A guess, and
 *                the right one most of the time.
 *   citizenship  the floor, from the person's own record. Never absent once
 *                onboarding has run, which is what stops a year resolving to
 *                nothing and quietly raising no obligation.
 *
 * NOTHING CARRIES FORWARD. This function takes one year and has no parameter
 * for the year before it, which is the enforcement rather than a convention: a
 * residence that carried over would keep raising Spanish returns for years
 * after somebody left Spain, and would do it silently. Each year stands on its
 * own evidence or falls to the floor.
 *
 * Client-safe by construction: no imports. Callers pass country codes already
 * folded to upper-case alpha-2 the way `foldCountry` produces them; the
 * comparisons here fold again rather than trusting that, because a mixed-case
 * code would otherwise read as a second country and make a settled year look
 * like a move.
 */

/** Which tier answered. The screen draws its confidence from this, not from the country. */
export type ResidenceEvidence = 'declared' | 'statement' | 'employment' | 'citizenship';

/** One stretch of a year spent resident somewhere. A whole year has null on both ends. */
export interface ResidencePeriod {
	country: string;
	/** Inclusive, ISO date. Null means "from the start of the year". */
	fromOn: string | null;
	/** Inclusive, ISO date. Null means "to the end of the year". */
	toOn: string | null;
}

export interface ResidenceInput {
	/** Rows on `tax_residence` for this person and year. Two is a year they moved in. */
	declared: ResidencePeriod[];
	/** Countries with a filed statement marked `role = 'residence'` for this year. */
	statementCountries: readonly string[];
	/** Countries the person had a role period in at any point during the year. */
	employmentCountries: readonly string[];
	/** `person.citizenship`. Null only on a household that predates the field. */
	citizenship: string | null;
}

export interface Residence {
	/**
	 * One entry per stretch of the year. Empty only when nothing could answer,
	 * which means the household has no citizenship recorded.
	 */
	periods: ResidencePeriod[];
	evidence: ResidenceEvidence;
	/**
	 * The answering tier offered more than one country and cannot choose between
	 * them — the year somebody moved, before they said when. Not an error: the
	 * obligations still stand, in every candidate country, and the screen asks
	 * for the move date rather than picking one.
	 */
	ambiguous: boolean;
	/** The countries in play, so the question can name them. Sorted, deduplicated. */
	candidates: string[];
}

/** Upper-case alpha-2, or null for anything that is not one. */
function fold(code: string | null | undefined): string | null {
	if (typeof code !== 'string') return null;
	const folded = code.trim().toUpperCase();
	return /^[A-Z]{2}$/.test(folded) ? folded : null;
}

/** Distinct folded codes, in a stable order so two equal answers compare equal. */
function distinct(codes: readonly string[]): string[] {
	const seen = new Set<string>();
	for (const code of codes) {
		const folded = fold(code);
		if (folded) seen.add(folded);
	}
	return [...seen].sort();
}

/** A whole-year period in one country, which is what three of the four tiers produce. */
const wholeYear = (country: string): ResidencePeriod => ({
	country,
	fromOn: null,
	toOn: null
});

/**
 * Resolve one person's residence for one year.
 *
 * Returns the periods rather than a single country because a year somebody
 * moved in is genuinely two residences, and both halves owe a return. Callers
 * that want the set of countries to raise obligations in read `periods`, never
 * `candidates` — an ambiguous year raises one in every candidate, which is the
 * safe direction to be wrong in.
 */
export function residenceForYear(input: ResidenceInput): Residence {
	// Declared first, and it may carry several periods: this is the only tier
	// that can state a move, because it is the only one a person writes.
	const declared = input.declared
		.map((period) => ({ ...period, country: fold(period.country) }))
		.filter((period): period is ResidencePeriod => period.country !== null);
	if (declared.length > 0) {
		return {
			periods: declared,
			evidence: 'declared',
			ambiguous: false,
			candidates: distinct(declared.map((period) => period.country))
		};
	}

	// A filed residence return. Two of them in one year is a contradiction the
	// app must not resolve on its own — either one is really a source return, or
	// the year was split — so it asks instead of choosing.
	const filed = distinct(input.statementCountries);
	if (filed.length > 0) {
		return {
			periods: filed.map(wholeYear),
			evidence: 'statement',
			ambiguous: filed.length > 1,
			candidates: filed
		};
	}

	// Where they worked. Two countries here is the ordinary shape of the year
	// somebody moved, and the one case worth asking about rather than guessing.
	const worked = distinct(input.employmentCountries);
	if (worked.length > 0) {
		return {
			periods: worked.map(wholeYear),
			evidence: 'employment',
			ambiguous: worked.length > 1,
			candidates: worked
		};
	}

	// The floor. A year with no paper and no work is the gap year this tier
	// exists for: still resident somewhere, so still owing a nil return.
	const home = fold(input.citizenship);
	return {
		periods: home ? [wholeYear(home)] : [],
		evidence: 'citizenship',
		ambiguous: home === null,
		candidates: home ? [home] : []
	};
}

/**
 * The countries a return is owed in for this year, from residence alone.
 *
 * Source countries — a Polish broker while resident in Czechia — are added by
 * the caller from the income side. This is only the half residence decides.
 */
export function residenceCountries(residence: Residence): string[] {
	return distinct(residence.periods.map((period) => period.country));
}

/** Whether the year still needs somebody to answer a question about it. */
export function residenceNeedsAnswer(residence: Residence): boolean {
	return residence.ambiguous || residence.periods.length === 0;
}

/**
 * Whether this year's residence rests on evidence rather than on a guess.
 *
 * The Tax screen marks the rest "prove it": attaching the year's statement is
 * what turns an inference into a fact, and it is one action rather than a
 * settings trip.
 */
export function residenceIsProved(residence: Residence): boolean {
	return residence.evidence === 'declared' || residence.evidence === 'statement';
}

/** What a whole household's year resolved to, folded from each person's. */
export interface HouseholdResidence {
	/** Where they lived, or — where `unsettled` — the countries it is torn between. */
	countries: string[];
	/**
	 * `proved` said so or filed it; `inferred` worked it out; `unsettled` could
	 * not call it. Three borders rather than three colours on the screen: a guess
	 * is not a warning.
	 */
	state: 'proved' | 'inferred' | 'unsettled';
	/** The weakest tier standing, or null where nothing answered. */
	evidence: ResidenceEvidence | null;
}

/**
 * One year, folded across everybody in the house.
 *
 * TORN IS NOT SILENT. A tier that offered a CHOICE is the year somebody moved,
 * and both countries owe something until the date is said. A person with no
 * evidence at all offered nothing, which is a different thing — folding the two
 * together made one person with an empty record turn every settled year in the
 * household amber.
 *
 * Two people resident in two countries is a couple living apart, not a
 * question, so only a tier that could not choose makes a year unsettled. The
 * weakest tier standing decides the word: a year proved for one person and
 * guessed for another is still a guess about the household.
 *
 * Lives here, beside the per-person rule it sits on, because both screens ask
 * it and a fold written twice is a rule that can drift from itself.
 */
export function householdResidence(residences: readonly Residence[]): HouseholdResidence {
	const torn = distinct(
		residences.flatMap((r) => (r.ambiguous && r.candidates.length > 1 ? r.candidates : []))
	);
	if (torn.length > 1) return { countries: torn, state: 'unsettled', evidence: null };

	// Only the people something is known about can settle the year; the rest are
	// silent rather than contradicting.
	const known = residences.filter((r) => r.periods.length > 0);
	const countries = distinct(known.flatMap(residenceCountries));
	if (countries.length === 0) return { countries: [], state: 'unsettled', evidence: null };

	// Weakest first: the first tier present is the one the household is standing on.
	const weakest = (['citizenship', 'employment', 'statement', 'declared'] as const).find((tier) =>
		known.some((r) => r.evidence === tier)
	);
	return {
		countries,
		state: known.every(residenceIsProved) ? 'proved' : 'inferred',
		evidence: weakest ?? null
	};
}
