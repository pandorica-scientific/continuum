// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * THE COLOUR-LITERAL EXEMPTION, AND THE ONLY ONE IN THIS PRODUCT.
 *
 * Everywhere else a colour is a token because it's semantic and must change
 * with the theme. These are physical materials — gold foil, shavings, paper —
 * that don't change colour with the theme, so they're hexes, kept in this one
 * file. See docs/ui-guidelines.md.
 */

/** The foil itself, a five-stop gradient — two stops would read as a flat tint. */
export const FOIL = ['#c6a75c', '#b99a4d', '#cfb26b', '#b3944a', '#c2a457'] as const;

/** What comes off it. Used by the residue when a region is scratched. */
export const SHAVINGS = ['#d9bd6c', '#b8994c', '#e6cf90', '#a98a3c', '#c9ab5b'] as const;

/** The stock the foil is printed on, where a scratch goes all the way through. */
export const LABEL_PAPER = '#efe9db';

/** Hairline scuffs scratched in beside a stroke: one dark, one bright. */
export const SCUFF_DARK = 'rgba(52, 41, 10, 0.22)';
export const SCUFF_LIGHT = 'rgba(255, 246, 214, 0.3)';

/** The ink a country name is printed in under foil — dark, since foil is light in both themes. */
export const FOIL_INK = '#3c3011';

/** The border between two countries that are both still covered. */
export const FOIL_EDGE = 'rgba(48, 38, 8, 0.55)';

/**
 * A country name printed over a SCRATCHED country, and its halo. White,
 * absolutely — `--fg1` is near-black in one theme, which would put black
 * text on a dark green country half the time.
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
