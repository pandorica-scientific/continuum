// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Which region a place belongs to, asked of the geometry rather than of a name.
 *
 * The place dataset answers this itself and its answer cannot be used: it files
 * French places under départements — `Bas-Rhin`, `Gironde` — because it was
 * built from the same Natural Earth admin-1 data the map used before v0.9.1,
 * and the map now draws `Grand Est` and `Nouvelle-Aquitaine`. The names cannot
 * be matched and must not be guessed at, so the coordinates are asked instead.
 *
 * Lives in `src/lib` rather than beside the build script for the same reason
 * `aliases.ts` does: the script imports it, and a pure function with types is
 * something a test can hold on its own.
 */
import { geoContains } from 'd3-geo';
import type { Feature, Geometry } from 'geojson';

/** A dissolved map region, as `fetch-geodata.mjs` holds it before writing. */
export type RegionFeature = Feature<Geometry, { name: string | null }>;

/**
 * The region containing this point, or null when none does.
 *
 * Null rather than nearest. Natural Earth's outlines are generalised, so a
 * coastal place can fall just outside the country it is plainly in — Napoli's
 * own coordinate sits in the Bay of Naples — and attaching it to whichever
 * polygon happens to be closest would invent a fact. A place with no region is
 * perfectly serviceable: its coin says the country under its name instead.
 *
 * `geoContains` is SPHERICAL, which is the trap here. A ring does not enclose an
 * area; it divides the sphere, and the winding order says which half is the
 * inside. Natural Earth's rings are wound correctly, so this works on real data
 * — but a hand-written fixture wound the other way means "everywhere except
 * here", and the first draft of this function's test did exactly that.
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
