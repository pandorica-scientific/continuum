// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The name printed under a coin.
 *
 * The place dataset names 315 of its 3,422 places in the local script alone —
 * Thimphu as `ཐིམ་ཕུ`, Kyiv as `Київ`, Bangkok as `กรุงเทพมหานคร`. A coin
 * labelled in a script the reader cannot place, with only its region underneath
 * in Latin, names nothing.
 *
 * Every one of those carries a Latin form in `alternateNames`, so the name is
 * TAKEN FROM THE DATA rather than transliterated here: this file never invents
 * a spelling, and a place whose alternates offer nothing keeps the name it came
 * with.
 *
 * Applied in the geodata build rather than by editing
 * `datasets/travel-places.json`, because the dataset is committed as it was
 * published so that a later version can be diffed against this one rather than
 * against our corrections to it. The same reasoning as resolving a place's
 * region from its coordinates instead of trusting the field the dataset ships —
 * see `place-region.ts`, which lives here for the same reason this does.
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

/**
 * The most readable name this place offers.
 *
 * A name that is already Latin — or only partly Latin, which is still legible —
 * is returned exactly as it is, alternates or no alternates.
 */
export function readableName(place: NamedPlace): string {
	const name = place.name ?? '';
	if (!LETTER.test(name) || LATIN.test(name)) return name;
	const latin = (place.alternateNames ?? []).find(
		(alternate) => LATIN.test(alternate) && LETTER.test(alternate)
	);
	return latin ?? name;
}
