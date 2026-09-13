// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Which region a place belongs to.
 *
 * The dataset answers this itself and its answer cannot be used: it files
 * French places under départements — `Bas-Rhin`, `Gironde` — because it was
 * built from the same Natural Earth admin-1 data the map used before v0.9.1.
 * The map now draws `Grand Est` and `Nouvelle-Aquitaine`. The names cannot be
 * matched and must not be guessed at, so the build asks the geometry instead.
 */
import { describe, expect, it } from 'vitest';
import { resolveRegion, type RegionFeature } from '$lib/life/geo/place-region';

/**
 * Two squares side by side, as the build sees a country's dissolved regions.
 *
 * WOUND CLOCKWISE, and that is not a detail. `geoContains` is spherical, so a
 * ring does not enclose an area — it divides the sphere, and the winding says
 * which half is the inside. Wound the other way these squares mean "everywhere
 * except here", and the first draft of this fixture did exactly that: the point
 * at [5, 5] came back as East and the point at [50, 50], in the empty Indian
 * Ocean, came back as West. Natural Earth's own rings are wound correctly,
 * which is why the build works and only the test was wrong.
 */
const REGIONS: RegionFeature[] = [
	{
		type: 'Feature',
		properties: { name: 'West' },
		geometry: {
			type: 'Polygon',
			coordinates: [
				[
					[0, 0],
					[0, 10],
					[10, 10],
					[10, 0],
					[0, 0]
				]
			]
		}
	},
	{
		type: 'Feature',
		properties: { name: 'East' },
		geometry: {
			type: 'Polygon',
			coordinates: [
				[
					[10, 0],
					[10, 10],
					[20, 10],
					[20, 0],
					[10, 0]
				]
			]
		}
	}
];

describe('resolveRegion', () => {
	it('names the region a point falls inside', () => {
		expect(resolveRegion([5, 5], REGIONS)).toBe('West');
		expect(resolveRegion([15, 5], REGIONS)).toBe('East');
	});

	// Honest rather than nearest: a coastal point just outside a generalised
	// outline belongs to no region, and saying so beats attaching it to whichever
	// polygon happens to be closest.
	it('answers null for a point in none of them', () => {
		expect(resolveRegion([50, 50], REGIONS)).toBeNull();
	});

	it('answers null when a country has no regions at all', () => {
		expect(resolveRegion([5, 5], [])).toBeNull();
	});
});
