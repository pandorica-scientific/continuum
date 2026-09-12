// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Which colour each country wears.
 *
 * The map paints 241 countries from a palette of 19, so colours repeat. What
 * must never happen is two countries that share a border sharing a colour —
 * that reads as one larger country, which is a map saying something false.
 *
 * **The assignment is spatial, not hashed.** Countries are sorted into
 * horizontal bands by where their centroid projects, then by latitude within a
 * band, and the palette is handed out sequentially down that list. Neighbours
 * therefore land on different slots BY CONSTRUCTION rather than by luck, and a
 * repeat is always far away.
 *
 * A hash plus a distance-based repair pass was tried first and silently failed:
 * neighbours kept colliding, because the centroids it compared came from a
 * "largest polygon" guess rather than from the projected geometry. It looked
 * like it worked, because most pairs are fine under any scheme. Do not
 * reintroduce it.
 *
 * The same function inks the trip stamps, which is why it lives here and not
 * inside the map component: a stamp for Portugal and Portugal on the map are
 * the same colour, and that is the whole point of the stamp wall.
 */

/**
 * The nineteen series slots, in the order they are handed out.
 *
 * The nine named ones first, then the ten reserves. Named tokens rather than
 * hexes so both themes follow, and so `palette-contrast` and the token check
 * see them like any other use.
 */
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
 * How tall a band is, in projected units.
 *
 * The map is fitted to a 960×480 viewBox, and 60 puts eight bands across it —
 * enough that a band holds a manageable run of countries, few enough that the
 * run is long compared with the palette. Widen it and Europe becomes one band
 * whose colours cycle three times; narrow it and neighbours north and south of
 * each other start to collide.
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
 * Hand every country a slot, deterministically.
 *
 * Same input, same output, every time and on every machine: the sort is total
 * — band, then y, then x, then code — so no two countries can compare equal and
 * leave the order to the engine's sort stability.
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
 * The colour for one country when the projected map is not to hand.
 *
 * The stamp wall needs Portugal's colour without loading a world atlas to get
 * it, so the assignment is precomputed from the same geometry the map uses and
 * frozen into `country-colour-table.ts`. A country the table does not know —
 * a code from a future dataset — falls back to a stable slot of its own rather
 * than to a default that would put every unknown place in one colour.
 */
export function countryColour(
	code: string,
	table: Readonly<Record<string, CountryColour>>
): CountryColour {
	const known = table[code.toUpperCase()];
	if (known) return known;

	// Two letters, so this is a small stable number: it never collides with the
	// table and never changes between runs.
	const seed = code.toUpperCase().charCodeAt(0) * 31 + (code.toUpperCase().charCodeAt(1) || 0);
	return COUNTRY_PALETTE[seed % COUNTRY_PALETTE.length];
}

/**
 * The ground a country is painted on: its hue muted into the page.
 *
 * 82% rather than the hue itself. The series colours were measured for
 * separation as chart series against a card, which makes them far too loud
 * spread across half a continent — at full strength the map reads as a
 * children's atlas and the foil above it disappears.
 */
export const countryFill = (colour: CountryColour): string =>
	`color-mix(in srgb, var(--${colour}) 82%, var(--bg))`;

/**
 * A region inside an opened country: the country's own colour, five steps.
 *
 * Shades of one hue rather than five hues, because inside a country the
 * question is "which parts have we been to", not "which region is which". The
 * cycle is deliberately short and the steps deliberately close.
 */
export const regionFill = (colour: CountryColour, index: number): string =>
	`color-mix(in srgb, var(--${colour}) ${58 + (index % 5) * 9}%, var(--bg))`;
