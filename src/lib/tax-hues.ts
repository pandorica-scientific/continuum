// SPDX-License-Identifier: AGPL-3.0-or-later
// Which fill a jurisdiction is drawn in, and what it is called.

/**
 * The four measured soft steps, then the ranked reserve.
 *
 * Assigned by order of appearance in the data rather than from a fixed
 * country table, so a household filing in a new country needs no edit here.
 * The soft four were measured together for colour-vision separation; past
 * them the reserve takes over, ranked as for the category palette.
 */
const SOFT = [
	'--series-health-soft',
	'--series-income-soft',
	'--series-bills-soft',
	'--series-taxes-soft'
] as const;

const RESERVE = ['--series-r1', '--series-r2', '--series-r3', '--series-r4'] as const;

const PALETTE = [...SOFT, ...RESERVE];

/**
 * Stable across loads, because the codes are sorted before they are assigned.
 * A jurisdiction that changed colour when an unrelated one was added would make
 * every earlier screenshot of this screen quietly wrong.
 */
export function hueTokens(countries: string[]): Map<string, string> {
	const sorted = [...new Set(countries)].sort();
	return new Map(sorted.map((code, i) => [code, PALETTE[i % PALETTE.length]]));
}

/**
 * The hue every country on one screen is drawn in, with a fallback.
 *
 * Both Income & Tax views paint spans, residence cells and lane cells by
 * country, and both need the same assignment or the two readings of one shelf
 * would disagree about what blue means.
 */
export function countryHues(codes: readonly (string | null)[]): (country: string | null) => string {
	const hues = hueTokens(codes.filter((code): code is string => code !== null));
	// The last of the reserve, kept back for "no country yet": a card with none
	// must not borrow the colour of a country it is not in.
	return (country) => (country && hues.get(country)) || '--series-r10';
}

// A jurisdiction's readable name, from the one place countries are named.
// Re-exported rather than moved outright: the tax screen asks a hue module for
// the name beside the hue, and both of its callers read it from here.
export { countryName } from './countries';
