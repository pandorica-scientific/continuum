// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Where a place lands on the map. `d3-geo` and `topojson-client`, not the
 * `d3` meta-package — must work offline on a self-hosted box.
 *
 * No DOM in this file: hands back a projection and path strings so the
 * arithmetic can be tested without a browser.
 */
import {
	geoArea,
	geoBounds,
	geoCentroid,
	geoMercator,
	geoNaturalEarth1,
	geoPath,
	type GeoPermissibleObjects,
	type GeoProjection
} from 'd3-geo';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import type { Feature, FeatureCollection, Geometry } from 'geojson';

/** The frame the handoff draws the world in. */
export const VIEW = { width: 960, height: 480, inset: 26 } as const;

export interface CountryShape {
	/** The name the topology files it under, which is what the aliases key on. */
	name: string;
	/** The `d` of the whole country, all its islands included. */
	path: string;
	/** Where a label would go, and what a single tap has to land inside. */
	centroid: [number, number];
	/** The projected bounding box: [[x0, y0], [x1, y1]]. */
	bounds: [[number, number], [number, number]];
	/** Projected area in square units, for deciding whether a label fits. */
	area: number;
	feature: Feature<Geometry>;
}

/**
 * The world, fitted to the frame. Natural Earth, not Mercator — a scratch map
 * is read as area, and Mercator makes Greenland the size of Africa. The
 * curved edge is the projection's own, not a decoration.
 */
export function worldProjection(
	_world: FeatureCollection<Geometry>,
	view: { width: number; height: number; inset: number } = VIEW
): GeoProjection {
	// Fitted to the SPHERE, not the countries — fitting features would make the
	// frame drift/rescale whenever the outline dataset changes.
	return geoNaturalEarth1().fitSize([view.width, view.height], {
		type: 'Sphere'
	} as unknown as GeoPermissibleObjects);
}

/**
 * Put Crimea and Sevastopol back in Ukraine — the world outline follows
 * Natural Earth's de-facto view and files them under Russia; admin-1
 * provinces are already corrected at fetch time, this matches the country
 * outlines to agree. Matched by geography (box containment), since country
 * polygons carry no province names. Mutates the collection in place.
 */
export function moveCrimea(world: FeatureCollection<Geometry>): void {
	const russia = world.features.find((f) => (f.properties as { name?: string })?.name === 'Russia');
	const ukraine = world.features.find(
		(f) => (f.properties as { name?: string })?.name === 'Ukraine'
	);
	if (!russia || !ukraine || russia.geometry?.type !== 'MultiPolygon') return;

	const [west, south, east, north] = [32.0, 43.9, 37.0, 46.5];
	const insideBox = (polygon: number[][][]): boolean => {
		const ring = polygon[0] ?? [];
		if (ring.length === 0) return false;
		return ring.every(([x, y]) => x >= west && x <= east && y >= south && y <= north);
	};

	const keep: number[][][][] = [];
	const move: number[][][][] = [];
	for (const polygon of russia.geometry.coordinates) {
		(insideBox(polygon) ? move : keep).push(polygon);
	}
	if (move.length === 0) return;

	russia.geometry.coordinates = keep;
	if (ukraine.geometry?.type === 'Polygon') {
		ukraine.geometry = {
			type: 'MultiPolygon',
			coordinates: [ukraine.geometry.coordinates, ...move]
		};
	} else if (ukraine.geometry?.type === 'MultiPolygon') {
		ukraine.geometry.coordinates = [...ukraine.geometry.coordinates, ...move];
	}
}

/**
 * The edge of the world, for the projection currently in use. Drawn from a
 * `Sphere` rather than faked with a border radius, so it stays correct if the
 * projection changes.
 */
export const sphereOutline = (projection: GeoProjection): string =>
	geoPath(projection)({ type: 'Sphere' } as unknown as GeoPermissibleObjects) ?? '';

/**
 * One country, re-fitted so it fills the frame on its own. Rotating to
 * centre the country before fitting keeps antimeridian-straddling countries
 * (Russia, Fiji) whole, rather than sliced by a Greenwich-centred projection.
 */
export function countryProjection(
	shape: Feature<Geometry>,
	view: { width: number; height: number; inset: number } = VIEW
): GeoProjection {
	const centre = geoCentroid(shape as never);
	return geoMercator()
		.rotate([-centre[0], 0])
		.fitExtent(
			[
				[view.inset, view.inset],
				[view.width - view.inset, view.height - view.inset]
			],
			mainland(shape) as unknown as GeoPermissibleObjects
		);
}

/**
 * The part of a country the frame should be built around.
 *
 * Not simply the largest polygon: the largest piece PLUS everything near it
 * that is not a rounding error. Fitting Portugal to everything it owns puts the
 * mainland at a twentieth of the frame because of the Azores; fitting it to the
 * single biggest polygon would drop the islands just off the coast that belong
 * in the picture. The prototype's thresholds — within 18° of longitude and 16°
 * of latitude, and at least a twentieth of the main piece's area — are what
 * separate "just offshore" from "an ocean away".
 */
function mainland(shape: Feature<Geometry>): Feature<Geometry> {
	if (shape.geometry?.type !== 'MultiPolygon') return shape;

	const polygons = shape.geometry.coordinates.map(
		(coordinates) => ({ type: 'Polygon', coordinates }) as Geometry
	);

	let best: Geometry | null = null;
	let biggest = -Infinity;
	for (const polygon of polygons) {
		// `geoArea` measures on the globe, which is the comparison that means
		// something — a projected area would call Greenland the mainland of
		// Denmark.
		const area = geoArea(polygon as never);
		if (area > biggest) {
			biggest = area;
			best = polygon;
		}
	}
	if (!best) return shape;

	const middle = geoCentroid(best as never);
	const near = polygons.filter((polygon) => {
		if (geoArea(polygon as never) < biggest * 0.05) return false;
		const at = geoCentroid(polygon as never);
		let apart = Math.abs(at[0] - middle[0]);
		// The short way round: two things either side of the antimeridian are
		// neighbours, not half a world apart.
		if (apart > 180) apart = 360 - apart;
		return apart <= 18 && Math.abs(at[1] - middle[1]) <= 16;
	});

	return {
		type: 'Feature',
		properties: shape.properties,
		geometry: {
			type: 'MultiPolygon',
			coordinates: (near.length ? near : [best]).map(
				(polygon) => (polygon as { coordinates: number[][][] }).coordinates
			)
		}
	};
}

/**
 * Split a country's regions into the main body and its far-flung groups.
 *
 * Portugal is the mainland, the Azores and Madeira; Norway is the mainland and
 * Svalbard; France is the hexagon and four overseas departments. Fitting one
 * frame around all of it makes the part somebody actually opened the page for
 * tiny in a corner — Norway ended up a sliver at the bottom of an ocean of
 * empty sea, because Svalbard is 1,500 km north of it.
 *
 * Grouped by the GAP BETWEEN BOUNDING BOXES rather than by distance between
 * centroids. Centroids split Finnmark off the Norwegian mainland it is joined
 * to, because Norway is long and thin and Finnmark's middle is a long way from
 * Troms'. Two boxes that touch are one landmass whatever their centroids say.
 *
 * Sorted by area on the globe, so the first cluster is the one to build the
 * frame around and the rest are insets.
 */
export function clusterRegions(regions: Feature<Geometry>[]): Feature<Geometry>[][] {
	/**
	 * Degrees between two boxes, zero when they touch or overlap.
	 *
	 * Longitude measured ON THE CIRCLE, which is not the same as subtracting and
	 * is wrong exactly where it matters. `geoBounds` reports a shape that crosses
	 * the antimeridian with its west GREATER than its east — Russia's Chukchi
	 * Autonomous Okrug comes back as 157.7°E to −169.0°E — and plain arithmetic
	 * then reads that as 324 degrees from the Kamchatka it actually overlaps. The
	 * okrug borders the Russian mainland and was being drawn in an inset panel of
	 * its own. `fetch-geodata.mjs` already measures its continent boxes this way.
	 */
	const gap = (a: [[number, number], [number, number]], b: typeof a): number => {
		// Each box as a start plus a width going east, so a wrapped box is the
		// part that wraps rather than a negative span.
		const wide = (box: typeof a) => (box[1][0] - box[0][0] + 360) % 360;
		const [wa, wb] = [wide(a), wide(b)];
		// How far east b's west edge is from a's, and the other way round. Either
		// landing inside the other interval means the two overlap in longitude.
		const east = (b[0][0] - a[0][0] + 360) % 360;
		const west = (a[0][0] - b[0][0] + 360) % 360;
		const x = east <= wa || west <= wb ? 0 : Math.min(east - wa, west - wb);
		const y = Math.max(0, Math.max(a[0][1] - b[1][1], b[0][1] - a[1][1]));
		return Math.hypot(x, y);
	};

	// Two degrees of slack: neighbouring provinces do not quite touch once the
	// outlines have been generalised, and a hard zero would split a coastline
	// into one cluster per province.
	const TOUCHING = 2;

	const boxed = regions.map((region) => ({ region, box: geoBounds(region as never) }));
	const clusters: { members: typeof boxed; area: number }[] = [];

	for (const one of boxed) {
		const near = clusters.filter((cluster) =>
			cluster.members.some((member) => gap(member.box, one.box) < TOUCHING)
		);
		if (!near.length) {
			clusters.push({ members: [one], area: geoArea(one.region as never) });
			continue;
		}
		// Joining two clusters at once is the point of single linkage: a province
		// can be the bridge between groups that were separate until it arrived.
		const first = near[0];
		first.members.push(one);
		first.area += geoArea(one.region as never);
		for (const other of near.slice(1)) {
			first.members.push(...other.members);
			first.area += other.area;
			clusters.splice(clusters.indexOf(other), 1);
		}
	}

	return clusters
		.sort((a, b) => b.area - a.area)
		.map((cluster) => cluster.members.map((member) => member.region));
}

/** A panel on the side of the frame holding one far-flung group. */
export interface InsetBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** How wide the column of inset panels is, and the air around them. */
const INSET_WIDTH = 132;
const INSET_PAD = 8;

/** The frame the main body gets, once the insets have taken their column. */
export const mainExtent = (
	insets: number,
	view: { width: number; height: number; inset: number } = VIEW
): [[number, number], [number, number]] => [
	[view.inset + (insets ? INSET_WIDTH + INSET_PAD : 0), view.inset],
	[view.width - view.inset, view.height - view.inset]
];

/**
 * Where each far-flung group is drawn, stacked down the left.
 *
 * Down the side rather than in place, which is the whole point: an inset says
 * "this belongs to the country and is not where the box is". Real atlases have
 * done it this way for Alaska and the Azores for a century, and the alternative
 * — one frame around everything — is what made Norway a sliver.
 */
export function insetBoxes(
	count: number,
	view: { width: number; height: number; inset: number } = VIEW
): InsetBox[] {
	if (count < 1) return [];
	const usable = view.height - view.inset * 2;
	const height = Math.min(140, (usable - INSET_PAD * (count - 1)) / count);
	return Array.from({ length: count }, (_, at) => ({
		x: view.inset,
		y: view.inset + at * (height + INSET_PAD),
		width: INSET_WIDTH,
		height
	}));
}

/** Turn a world-atlas topology into the features the map draws. */
export function countriesFrom(topology: Topology, key = 'countries'): FeatureCollection<Geometry> {
	return feature(topology, topology.objects[key]) as FeatureCollection<Geometry>;
}

/** Every country, projected once, with what the screen needs to place it. */
export function shapesFrom(
	countries: FeatureCollection<Geometry>,
	projection: GeoProjection
): CountryShape[] {
	const draw = geoPath(projection);

	return countries.features
		.map((one): CountryShape | null => {
			const path = draw(one as unknown as GeoPermissibleObjects);
			// A feature the projection cannot draw — an empty geometry, or one
			// entirely behind the globe — is dropped rather than pushed onto the
			// screen as an empty `d`, which renders as an invisible click target.
			if (!path) return null;

			const [[x0, y0], [x1, y1]] = draw.bounds(one as unknown as GeoPermissibleObjects);
			if (![x0, y0, x1, y1].every(Number.isFinite)) return null;

			const centroid = draw.centroid(one as unknown as GeoPermissibleObjects);
			if (!centroid.every(Number.isFinite)) return null;

			return {
				name: String((one.properties as { name?: string } | null)?.name ?? ''),
				path,
				centroid: [centroid[0], centroid[1]],
				bounds: [
					[x0, y0],
					[x1, y1]
				],
				// `geoPath.area` is the projected area, which is what matters for
				// whether a word fits — not the real one.
				area: draw.area(one as unknown as GeoPermissibleObjects),
				feature: one
			};
		})
		.filter((shape): shape is CountryShape => shape !== null);
}
