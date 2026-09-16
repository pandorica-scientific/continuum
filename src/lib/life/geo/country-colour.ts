// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Which colour each country wears.
 *
 * 241 countries from a palette of 19, so colours repeat — but two countries
 * sharing a border must never share a colour, or the map reads as one larger
 * (false) country.
 *
 * The assignment is spatial, not hashed: countries are sorted into horizontal
 * bands by projected centroid, then by latitude within a band, and the
 * palette handed out sequentially — so neighbours land on different slots by
 * construction. A hash + distance-repair pass was tried and silently failed
 * (bad centroids caused neighbour collisions); do not reintroduce it.
 *
 * Also inks the trip stamps, so Portugal the country and a Portugal stamp match.
 */

/** The nineteen series slots, in order — nine named ones, then ten reserves. */
export const COUNTRY_PALETTE = [
	'series-income',
	'series-taxes',
	'series-bills',
	'series-subscriptions',
	'series-health',
	'series-transport',
	'series-living',
	'series-housing',
	'series-savings',
	'series-r1',
	'series-r2',
	'series-r3',
	'series-r4',
	'series-r5',
	'series-r6',
	'series-r7',
	'series-r8',
	'series-r9',
	'series-r10'
] as const;

export type CountryColour = (typeof COUNTRY_PALETTE)[number];

/**
 * How tall a band is, in projected units — 60 puts eight bands across the
 * 960×480 viewBox. Too wide and Europe becomes one band with colours cycling
 * three times; too narrow and north/south neighbours start to collide.
 */
export const BAND_HEIGHT = 60;

export interface CountryCentroid {
	/** ISO 3166-1 alpha-2, upper case. */
	code: string;
	/** Where the country's centroid lands in the projected viewBox. */
	x: number;
	y: number;
}

/**
 * Hand every country a slot, deterministically. The sort is total (band,
 * y, x, code) so no two countries can compare equal.
 */
export function assignColours(countries: CountryCentroid[]): Map<string, CountryColour> {
	const ordered = [...countries].sort((a, b) => {
		const bandA = Math.floor(a.y / BAND_HEIGHT);
		const bandB = Math.floor(b.y / BAND_HEIGHT);
		if (bandA !== bandB) return bandA - bandB;
		if (a.y !== b.y) return a.y - b.y;
		if (a.x !== b.x) return a.x - b.x;
		return a.code < b.code ? -1 : 1;
	});

	const colours = new Map<string, CountryColour>();
	ordered.forEach((country, index) => {
		colours.set(country.code, COUNTRY_PALETTE[index % COUNTRY_PALETTE.length]);
	});
	return colours;
}

/**
 * The colour for one country when the projected map is not to hand, read
 * from the precomputed `country-colour-table.ts`. An unknown code falls back
 * to a stable slot of its own, not a shared default.
 */
export function countryColour(
	code: string,
	table: Readonly<Record<string, CountryColour>>
): CountryColour {
	const known = table[code.toUpperCase()];
	if (known) return known;

	// A small stable number from two letters — never changes between runs.
	const seed = code.toUpperCase().charCodeAt(0) * 31 + (code.toUpperCase().charCodeAt(1) || 0);
	return COUNTRY_PALETTE[seed % COUNTRY_PALETTE.length];
}

/**
 * The ground a country is painted on: its hue muted 82% into the page — at
 * full strength (tuned for chart series) the map reads as a children's atlas.
 */
export const countryFill = (colour: CountryColour): string =>
	`color-mix(in srgb, var(--${colour}) 82%, var(--bg))`;

/**
 * A region inside an opened country: shades of the country's own colour, not
 * five different hues — the question inside a country is "which parts have
 * we been to", not "which region is which".
 */
export const regionFill = (colour: CountryColour, index: number): string =>
	`color-mix(in srgb, var(--${colour}) ${58 + (index % 5) * 9}%, var(--bg))`;
