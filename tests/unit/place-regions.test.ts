// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Which region a place belongs to.
 *
 * The dataset's own region names (French départements) don't match the map's
 * region names (e.g. `Grand Est`), so the build asks the geometry instead.
 */
import { describe, expect, it } from 'vitest';
import { resolveRegion, type RegionFeature } from '$lib/life/geo/place-region';

/**
 * Two squares side by side, as the build sees a country's dissolved regions.
 *
 * WOUND CLOCKWISE, and that is not a detail: `geoContains` is spherical, so a ring
 * divides the sphere rather than enclosing an area, and the winding says which
 * half is inside. Wound the other way, these squares mean "everywhere except here".
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

	// Honest rather than nearest: a point outside every outline belongs to no region.
	it('answers null for a point in none of them', () => {
		expect(resolveRegion([50, 50], REGIONS)).toBeNull();
	});

	it('answers null when a country has no regions at all', () => {
		expect(resolveRegion([5, 5], [])).toBeNull();
	});
});
