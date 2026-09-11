// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * THE COLOUR-LITERAL EXEMPTION, AND THE ONLY ONE IN THIS PRODUCT.
 *
 * Everywhere else a colour is a token, because everywhere else a colour is
 * SEMANTIC: red means a problem, `--rose` means the Life area, and both have to
 * change when the theme does. These are not semantic. They are physical
 * materials — the gold foil on a scratch map, the shavings that come off it,
 * the paper underneath — and a material does not change colour because somebody
 * switched to the light theme. Gold foil is gold in a dark room.
 *
 * So they are hexes, they are identical in both themes, and they live in this
 * one file so the next person to find a hex in a diff can tell in one step
 * whether it is the one that is allowed. See docs/ui-guidelines.md.
 */

/**
 * The foil itself, as a five-stop gradient.
 *
 * Five rather than two because two reads as a flat tint: real foil catches the
 * light unevenly, and it is the unevenness that makes it look like something
 * to scratch rather than a beige country.
 */
export const FOIL = ['#c6a75c', '#b99a4d', '#cfb26b', '#b3944a', '#c2a457'] as const;

/** What comes off it. Used by the residue when a region is scratched. */
export const SHAVINGS = ['#d9bd6c', '#b8994c', '#e6cf90', '#a98a3c', '#c9ab5b'] as const;

/** The stock the foil is printed on, where a scratch goes all the way through. */
export const LABEL_PAPER = '#efe9db';

/** Hairline scuffs scratched in beside a stroke: one dark, one bright. */
export const SCUFF_DARK = 'rgba(52, 41, 10, 0.22)';
export const SCUFF_LIGHT = 'rgba(255, 246, 214, 0.3)';

/**
 * The ink a country name is printed in while it is still under foil.
 *
 * Dark, because the foil is light in both themes — a white label on gold is
 * unreadable, and `--fg1` is white in the dark theme. This is part of the
 * material for the same reason the foil is.
 */
export const FOIL_INK = '#3c3011';

/** The border between two countries that are both still covered. */
export const FOIL_EDGE = 'rgba(48, 38, 8, 0.55)';

/**
 * A country name printed over a SCRATCHED country, and its halo.
 *
 * White, absolutely: a scratched country wears one of nineteen series colours,
 * and `--fg1` is white in one theme and near-black in the other — which would
 * put black text on a dark green Brazil half the time. The halo is dark for the
 * same reason. Both are the prototype's own values.
 */
export const SCRATCHED_INK = '#ffffff';
export const SCRATCHED_HALO =
	'0 0 6px rgba(0, 0, 0, 0.8), 0 0 3px rgba(0, 0, 0, 0.8), 0 0 2px rgba(0, 0, 0, 0.7)';

/** The same, for a name still printed on foil. */
export const FOIL_HALO = '0 0 6px rgba(240, 220, 156, 0.95), 0 0 3px rgba(240, 220, 156, 0.95)';

/** A stable stop for a given country, so the foil does not shimmer on redraw. */
export const foilFor = (seed: string): string => {
	let value = 0;
	for (const character of seed) value = (value * 31 + character.codePointAt(0)!) >>> 0;
	return FOIL[value % FOIL.length];
};
