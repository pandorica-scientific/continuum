// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The one thing the map's colouring must never do is put two neighbours in the
 * same colour, because that reads as one larger country.
 *
 * A hash-and-repair scheme was tried during design and silently failed this.
 * These tests are what would have caught it.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	BAND_HEIGHT,
	COUNTRY_PALETTE,
	assignColours,
	countryColour,
	countryFill,
	regionFill,
	type CountryCentroid
} from '$lib/life/geo/country-colour';
import { COUNTRY_COLOURS } from '$lib/life/geo/country-colour-table';

const stylesheet = readFileSync('src/lib/styles/app.css', 'utf8');

describe('the palette', () => {
	it('names only tokens the stylesheet defines', () => {
		for (const colour of COUNTRY_PALETTE) {
			expect(stylesheet, colour).toContain(`--${colour}:`);
		}
	});

	it('has no duplicate slots', () => {
		expect(new Set(COUNTRY_PALETTE).size).toBe(COUNTRY_PALETTE.length);
	});
});

describe('assigning colours', () => {
	const grid = (): CountryCentroid[] => {
		const countries: CountryCentroid[] = [];
		for (let row = 0; row < 8; row++) {
			for (let column = 0; column < 30; column++) {
				countries.push({
					code: `${String.fromCharCode(65 + row)}${String.fromCharCode(65 + (column % 26))}${column}`,
					x: column * 32,
					y: row * BAND_HEIGHT + 10
				});
			}
		}
		return countries;
	};

	it('is deterministic', () => {
		const once = assignColours(grid());
		const again = assignColours(grid());
		expect([...again.entries()]).toEqual([...once.entries()]);
	});

	it('does not depend on the order it is handed', () => {
		const forwards = assignColours(grid());
		const backwards = assignColours([...grid()].reverse());
		expect([...backwards.entries()].sort()).toEqual([...forwards.entries()].sort());
	});

	it('gives adjacent countries in a band different colours', () => {
		const colours = assignColours(grid());
		const band = grid()
			.filter((country) => country.y === 10)
			.sort((a, b) => a.x - b.x);
		for (let i = 1; i < band.length; i++) {
			expect(colours.get(band[i].code), `${band[i - 1].code} vs ${band[i].code}`).not.toBe(
				colours.get(band[i - 1].code)
			);
		}
	});

	it('gives a country and the one above it different colours', () => {
		const colours = assignColours(grid());
		const at = (row: number, column: number) =>
			colours.get(grid().find((c) => c.y === row * BAND_HEIGHT + 10 && c.x === column * 32)!.code);
		for (let row = 1; row < 8; row++) {
			for (let column = 0; column < 30; column++) {
				expect(at(row, column), `row ${row} column ${column}`).not.toBe(at(row - 1, column));
			}
		}
	});

	it('uses every slot before repeating one', () => {
		const colours = assignColours(grid().slice(0, COUNTRY_PALETTE.length));
		expect(new Set(colours.values()).size).toBe(COUNTRY_PALETTE.length);
	});
});

describe('the generated table', () => {
	it('covers the countries a household is likely to name', () => {
		for (const code of ['CZ', 'PL', 'PT', 'ES', 'DE', 'HR', 'JP', 'US', 'UA', 'XK']) {
			expect(COUNTRY_COLOURS[code], code).toBeDefined();
		}
	});

	it('names only slots in the palette', () => {
		for (const [code, colour] of Object.entries(COUNTRY_COLOURS)) {
			expect(COUNTRY_PALETTE, code).toContain(colour);
		}
	});

	it('gives some well-known neighbours different colours', () => {
		// Not exhaustive — the exhaustive check is the grid above. These are the
		// pairs a household in central Europe would actually notice.
		const neighbours: [string, string][] = [
			['CZ', 'PL'],
			['CZ', 'DE'],
			['CZ', 'AT'],
			['CZ', 'SK'],
			['ES', 'PT'],
			['FR', 'DE'],
			['HR', 'SI'],
			['UA', 'PL']
		];
		for (const [a, b] of neighbours) {
			expect(COUNTRY_COLOURS[a], `${a} vs ${b}`).not.toBe(COUNTRY_COLOURS[b]);
		}
	});
});

describe('reading a colour back', () => {
	it('finds a country in the table whatever the case', () => {
		expect(countryColour('cz', COUNTRY_COLOURS)).toBe(COUNTRY_COLOURS.CZ);
	});

	it('gives an unknown code a stable slot rather than a shared default', () => {
		const once = countryColour('ZZ', COUNTRY_COLOURS);
		expect(countryColour('ZZ', COUNTRY_COLOURS)).toBe(once);
		expect(COUNTRY_PALETTE).toContain(once);
		expect(countryColour('ZY', COUNTRY_COLOURS)).not.toBe(once);
	});
});

describe('the fills', () => {
	it('mutes a country into the page rather than painting it at full strength', () => {
		expect(countryFill('series-r1')).toBe('color-mix(in srgb, var(--series-r1) 82%, var(--bg))');
	});

	it('walks five steps of one hue for the regions inside a country', () => {
		const steps = [0, 1, 2, 3, 4, 5].map((i) => regionFill('series-r1', i));
		expect(new Set(steps.slice(0, 5)).size).toBe(5);
		// The sixth step is the first again: a short cycle, on purpose.
		expect(steps[5]).toBe(steps[0]);
	});
});
