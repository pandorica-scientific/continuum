// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Contact search folds diacritics so a Czech or Polish name is findable from an
// ASCII keyboard. Pure and client-safe: the same function normalises the term
// the browser sends and the term the SQL predicate compares against, so the two
// halves cannot drift into disagreeing about what "rehor" means.

// Latin letters carrying a STROKE rather than a combining accent. NFD cannot
// decompose these — Ł is a single code point with no accent to strip — so
// without this map "lodz" never finds "Łódź". Kept to the letters that occur in
// languages this household actually writes in, plus the neighbouring Slavic
// ones, rather than a speculative sweep of Unicode.
const STROKED: Record<string, string> = {
	ł: 'l',
	đ: 'd',
	ø: 'o',
	ħ: 'h',
	ŧ: 't'
};

/**
 * Lowercase, trim, and strip diacritics.
 *
 * Order matters: lowercase first so the stroked map only needs its lowercase
 * keys, then substitute strokes, then NFD-decompose and drop the combining
 * marks. Doing NFD before the substitution would work too, but doing it after
 * keeps the map small and the intent readable.
 */
export function normaliseSearch(term: string): string {
	return term
		.trim()
		.toLowerCase()
		.replace(/[łđøħŧ]/g, (character) => STROKED[character])
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '');
}

/**
 * The same folding as a Postgres expression, for the index and the predicate.
 *
 * `unaccent()` handles the combining marks; `translate()` covers the stroked
 * letters it cannot, mirroring STROKED above. The two must agree — a term folded
 * one way and compared against text folded another matches nothing — so both
 * sides are generated from here rather than written out twice.
 */
export const SQL_FOLD_FROM = Object.keys(STROKED).join('');
export const SQL_FOLD_TO = Object.values(STROKED).join('');
