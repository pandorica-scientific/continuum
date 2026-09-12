// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Where a place lands on the map.
 *
 * Run against the real world outline where a checkout has one, and skipped
 * where it does not: `geodata/` is fetched at image-build time, and CI's checks
 * job deliberately does not pay for that download. The arithmetic that matters
 * — the antimeridian rotate — is proved on a hand-built feature that needs no
 * fetch at all.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import type { Topology } from 'topojson-specification';
import { geoContains } from 'd3-geo';
import {
	VIEW,
	countriesFrom,
	countryProjection,
	moveCrimea,
	shapesFrom,
	worldProjection
} from '$lib/life/map/projection';

/** A country straddling the antimeridian, like Russia and Fiji. */
const straddler: Feature<Geometry> = {
	type: 'Feature',
	properties: { name: 'Straddle' },
	geometry: {
		type: 'Polygon',
		coordinates: [
			[
				[170, -10],
				[-170, -10],
				[-170, 10],
				[170, 10],
				[170, -10]
			]
		]
	}
};

describe('a country that crosses the antimeridian', () => {
	// Sliced in half by a projection centred on Greenwich, the halves span the
	// whole world and fit a box that is the whole map.
	it('is drawn whole rather than sliced', () => {
		const projection = countryProjection(straddler);
		const [left] = projection([170, 0]) ?? [Number.NaN];
		const [right] = projection([-170, 0]) ?? [Number.NaN];

		expect(Number.isFinite(left)).toBe(true);
		expect(Number.isFinite(right)).toBe(true);
		// The two edges land 20° apart, not most of the width of the map.
		expect(Math.abs(right - left)).toBeLessThan(VIEW.width);
		// And they are on the sides the inset allows.
		for (const x of [left, right]) {
			expect(x).toBeGreaterThanOrEqual(VIEW.inset - 1);
			expect(x).toBeLessThanOrEqual(VIEW.width - VIEW.inset + 1);
		}
	});

	it('fills the frame it was fitted to', () => {
		const projection = countryProjection(straddler);
		const [, top] = projection([0, 10]) ?? [0, Number.NaN];
		const [, bottom] = projection([0, -10]) ?? [0, Number.NaN];
		expect(Math.min(top, bottom)).toBeGreaterThanOrEqual(VIEW.inset - 1);
		expect(Math.max(top, bottom)).toBeLessThanOrEqual(VIEW.height - VIEW.inset + 1);
	});
});

const WORLD = 'geodata/countries-50m.json';
const world: FeatureCollection<Geometry> | null = existsSync(WORLD)
	? countriesFrom(JSON.parse(readFileSync(WORLD, 'utf8')) as Topology)
	: null;

describe.skipIf(!world)('the whole world', () => {
	it('projects every country inside the frame', () => {
		const projection = worldProjection(world!);
		const shapes = shapesFrom(world!, projection);

		expect(shapes.length).toBeGreaterThan(150);
		for (const shape of shapes) {
			const [[x0, y0], [x1, y1]] = shape.bounds;
			// A hair of tolerance: `fitExtent` lands on the inset exactly, and
			// floating point puts some edges a fraction the wrong side of it.
			expect(x0, shape.name).toBeGreaterThanOrEqual(-1);
			expect(y0, shape.name).toBeGreaterThanOrEqual(-1);
			expect(x1, shape.name).toBeLessThanOrEqual(VIEW.width + 1);
			expect(y1, shape.name).toBeLessThanOrEqual(VIEW.height + 1);
		}
	});

	// An empty `d` renders as an invisible click target rather than as nothing.
	it('never hands back a shape it could not draw', () => {
		const shapes = shapesFrom(world!, worldProjection(world!));
		for (const shape of shapes) {
			expect(shape.path, shape.name).not.toBe('');
			expect(Number.isFinite(shape.centroid[0]), shape.name).toBe(true);
			expect(Number.isFinite(shape.area), shape.name).toBe(true);
		}
	});

	it('names the countries it draws', () => {
		const names = shapesFrom(world!, worldProjection(world!)).map((shape) => shape.name);
		expect(names).toContain('Portugal');
		expect(names).toContain('Czechia');
	});
});

describe.skipIf(!world)('Crimea', () => {
	/**
	 * The world outline follows Natural Earth's de-facto view and files Crimea
	 * and Sevastopol under Russia. The admin-1 provinces are corrected at fetch
	 * time; this is the same correction for the country outlines, and the two
	 * datasets have to agree or the peninsula scratches off under the wrong flag.
	 */
	const CRIMEA: [number, number] = [34.0, 45.2];
	const SEVASTOPOL: [number, number] = [33.55, 44.6];

	const find = (features: FeatureCollection<Geometry>, name: string) =>
		features.features.find((one) => (one.properties as { name?: string })?.name === name)!;

	it('is filed under Russia before the correction', () => {
		const fresh = countriesFrom(JSON.parse(readFileSync(WORLD, 'utf8')) as Topology);
		expect(geoContains(find(fresh, 'Russia') as never, CRIMEA)).toBe(true);
		expect(geoContains(find(fresh, 'Ukraine') as never, CRIMEA)).toBe(false);
	});

	it('is Ukraine afterwards, and no longer Russia', () => {
		const fixed = countriesFrom(JSON.parse(readFileSync(WORLD, 'utf8')) as Topology);
		moveCrimea(fixed);
		for (const point of [CRIMEA, SEVASTOPOL]) {
			expect(geoContains(find(fixed, 'Ukraine') as never, point)).toBe(true);
			expect(geoContains(find(fixed, 'Russia') as never, point)).toBe(false);
		}
	});

	// Moving a polygon out of Russia must not take Siberia with it.
	it('leaves the rest of Russia alone', () => {
		const fixed = countriesFrom(JSON.parse(readFileSync(WORLD, 'utf8')) as Topology);
		moveCrimea(fixed);
		expect(geoContains(find(fixed, 'Russia') as never, [37.6, 55.7])).toBe(true);
		expect(geoContains(find(fixed, 'Russia') as never, [104.3, 52.3])).toBe(true);
	});

	it('does nothing the second time it runs', () => {
		const fixed = countriesFrom(JSON.parse(readFileSync(WORLD, 'utf8')) as Topology);
		moveCrimea(fixed);
		const after = (find(fixed, 'Ukraine').geometry as { coordinates: unknown[] }).coordinates
			.length;
		moveCrimea(fixed);
		expect((find(fixed, 'Ukraine').geometry as { coordinates: unknown[] }).coordinates.length).toBe(
			after
		);
	});
});
