// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Where a place lands on the map.
 *
 * `d3-geo` for the projection and `topojson-client` for turning a topology into
 * features — two packages, not the `d3` meta-package, and no CDN tag: the
 * prototype's script tags do not survive the port into a bundle that has to
 * work offline on a self-hosted box.
 *
 * No DOM in this file. It hands back a projection and the path strings drawn
 * from it, so the arithmetic can be tested without a browser and the component
 * is markup.
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
 * The world, fitted to the frame.
 *
 * Natural Earth, not Mercator, and the handoff draws it that way for a reason:
 * this map is a picture of how much of the world a household has seen, and
 * Mercator answers that question wrongly — it makes Greenland the size of
 * Africa and shrinks everywhere most people actually go. A scratch map is read
 * as area, so the projection has to be one that roughly preserves it.
 *
 * The curved edge is the projection's own, not a decoration: meridians bend
 * towards the poles, which is what buys back the area Mercator spends.
 */
export function worldProjection(
	_world: FeatureCollection<Geometry>,
	view: { width: number; height: number; inset: number } = VIEW
): GeoProjection {
	// Fitted to the SPHERE, not to the countries. The handoff's prototype does
	// this and it matters: fitting the features makes the frame depend on which
	// islands the dataset happens to include, so the world drifts and rescales
	// the day the outline file is updated. The globe is a fixed thing.
	return geoNaturalEarth1().fitSize([view.width, view.height], {
		type: 'Sphere'
	} as unknown as GeoPermissibleObjects);
}

/**
 * Put Crimea and Sevastopol back in Ukraine.
 *
 * The world outline follows Natural Earth's de-facto view and files them under
 * Russia. The admin-1 provinces are already corrected at fetch time; this is
 * the same correction for the country outlines, ported from the handoff's
 * prototype so the two datasets agree.
 *
 * Matched by geography rather than by name, because the country polygons carry
 * no province names at all: a ring lying entirely inside the peninsula's box is
 * the peninsula. Mutates the collection in place, once, before it is projected.
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
 * The edge of the world, for the projection currently in use.
 *
 * A `Sphere` is a real GeoJSON-ish type `d3-geo` understands: it draws the
 * outline of the whole globe under this projection, which is the curved lens
 * the handoff frames the map in. Drawn rather than faked with a border radius,
 * so it stays correct if the projection ever changes again.
 */
export const sphereOutline = (projection: GeoProjection): string =>
	geoPath(projection)({ type: 'Sphere' } as unknown as GeoPermissibleObjects) ?? '';

/**
 * One country, re-fitted so it fills the frame on its own.
 *
 * `rotate([-centroid[0], 0])` before fitting is what keeps Russia and Fiji
 * whole: a country straddling the antimeridian is sliced in half by a
 * projection centred on Greenwich, and the halves then fit a box that spans the
 * entire world. Turning the globe so the country is in the middle first costs
 * one line and removes the class.
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
 * Re-fit a country once its provinces have arrived.
 *
 * The country outline and the province outlines are different datasets and do
 * not agree about where a country ends — so a frame built from one and filled
 * with the other leaves provinces hanging off the edge. Fitting to the
 * provinces that are actually in frame is what makes them fill the box.
 *
 * Mutates the projection it is given, and hands back the provinces worth
 * drawing: far-flung ones are dropped rather than dragging the frame out to a
 * scale where nothing is legible.
 */
export function refitToProvinces(
	projection: GeoProjection,
	country: Feature<Geometry>,
	provinces: Feature<Geometry>[],
	view: { width: number; height: number; inset: number } = VIEW
): Feature<Geometry>[] {
	if (provinces.length <= 1) return provinces;

	const [[west, south], [east, north]] = geoBounds(mainland(country) as never);
	// A box that crosses the antimeridian reads west > east. Russia and Fiji.
	const wrapped = west > east;
	const padLon = (wrapped ? 360 - (west - east) : east - west) * 0.15 + 0.6;
	const padLat = (north - south) * 0.15 + 0.6;

	const inFrame = (province: Feature<Geometry>) => {
		const at = geoCentroid(province as never);
		if (at[1] < south - padLat || at[1] > north + padLat) return false;
		if (wrapped) return at[0] >= west - padLon || at[0] <= east + padLon;
		return at[0] >= west - padLon && at[0] <= east + padLon;
	};

	const kept = provinces.filter(inFrame);
	const parts = kept.length > 1 ? kept : provinces;

	projection.fitExtent(
		[
			[view.inset, view.inset],
			[view.width - view.inset, view.height - view.inset]
		],
		{ type: 'FeatureCollection', features: parts } as unknown as GeoPermissibleObjects
	);
	return parts;
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
