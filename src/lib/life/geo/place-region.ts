// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Which region a place belongs to, asked of the geometry rather than of a
 * name. The place dataset's own answer files French places under old-style
 * départements that no longer match the map's regions, so coordinates are
 * asked instead.
 */
import { geoContains } from 'd3-geo';
import type { Feature, Geometry } from 'geojson';

/** A dissolved map region, as `fetch-geodata.mjs` holds it before writing. */
export type RegionFeature = Feature<Geometry, { name: string | null }>;

/**
 * The region containing this point, or null when none does. Null rather than
 * nearest — a coastal point (e.g. Napoli, which falls in the Bay of Naples)
 * attached to the closest polygon would invent a fact.
 *
 * `geoContains` is SPHERICAL: a ring divides the sphere and winding order
 * says which half is inside. Natural Earth's rings wind correctly, but a
 * hand-written test fixture wound backwards means "everywhere except here".
 */
export function resolveRegion(
	point: [number, number],
	regions: readonly RegionFeature[]
): string | null {
	for (const region of regions) {
		if (geoContains(region, point)) return region.properties?.name ?? null;
	}
	return null;
}
