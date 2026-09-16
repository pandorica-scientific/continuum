// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The name printed under a coin. 315 of 3,422 places are named only in local
 * script (Thimphu as `ཐིམ་ཕུ`, etc.), so this picks the Latin form from
 * `alternateNames` when one exists — never transliterating one itself.
 *
 * Applied in the geodata build rather than editing
 * `assets/datasets/travel-places.json` directly, so the dataset stays diffable
 * against upstream (see also `place-region.ts`).
 */

/** Any letter written in the Latin alphabet, its accented forms included. */
const LATIN = /\p{Script=Latin}/u;
/** Any letter at all, so a name of digits and punctuation is not called foreign. */
const LETTER = /\p{L}/u;

/** A place as the dataset writes it, in the two fields this reads. */
export interface NamedPlace {
	name?: string;
	alternateNames?: string[];
}

/** The most readable name this place offers — Latin (even partly) is returned as-is. */
export function readableName(place: NamedPlace): string {
	const name = place.name ?? '';
	if (!LETTER.test(name) || LATIN.test(name)) return name;
	const latin = (place.alternateNames ?? []).find(
		(alternate) => LATIN.test(alternate) && LETTER.test(alternate)
	);
	return latin ?? name;
}
