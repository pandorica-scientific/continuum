// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The outlines the Map draws, read off the disk they were fetched onto.
 *
 * `geodata/` is written at image-build time by `scripts/fetch-geodata.mjs` and
 * never at runtime, so a missing manifest means the fetch has not run — a
 * state the Map is expected to draw, not a reason to fail.
 *
 * NOTHING here joins a request to a path: a slug is looked up in the
 * manifest, and a name that is not in it never reaches the filesystem at all.
 */
import { gunzipSync } from 'node:zlib';
import { geoBounds, geoContains, geoEquirectangular, geoPath } from 'd3-geo';
import type { Geometry } from 'geojson';
import type { Topology } from 'topojson-specification';
import {
	countriesFrom,
	moveCrimea,
	shapesFrom,
	sphereOutline,
	worldProjection
} from '$lib/life/map/projection';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Where the fetch script writes. Relative to the working directory, as tessdata is. */
const GEODATA_DIR = process.env.GEODATA_DIR ?? 'geodata';

export interface CountryEntry {
	/** ISO 3166-1 alpha-2, where the country has one. */
	code: string;
	/** The name Natural Earth files its provinces under. */
	admin: string;
	/** The filename stem under `admin1/`. */
	slug: string;
	/** Its centre on the globe, [longitude, latitude]. Null where it has none. */
	centre: [number, number] | null;
	/**
	 * How much of the globe it covers, in square kilometres.
	 *
	 * The continent coins weight their share by it, so that having been to
	 * Australia is not the same amount of Oceania as having been to Nauru.
	 */
	area: number;
}

export interface GeoManifest {
	version: number;
	generated: string;
	precision: number;
	view: { width: number; height: number; inset: number };
	countries: Record<string, CountryEntry>;
	files: Record<string, { regions: number; bytes: number }>;
	/** How many time zones the bands file holds. */
	zones: number;
	/** Continent → how many countries are on it. The denominator for a coin. */
	continents: Record<string, number>;
}

/**
 * Read once and held, once there is something to hold.
 *
 * The manifest is written at build time and cannot change while the server is
 * up, so re-reading it per request would be a syscall to learn something
 * already known. Its ABSENCE is not cached — see below.
 */
let manifest: GeoManifest | null = null;

export function geoManifest(): GeoManifest | null {
	if (manifest) return manifest;
	const path = join(GEODATA_DIR, 'manifest.json');
	// A MISS IS NOT CACHED: caching it would freeze "not fetched" until a
	// restart, and re-checking costs one `existsSync` on a page nobody hits in
	// a loop.
	if (!existsSync(path)) return null;
	try {
		// Synchronous deliberately: one small file, read once, for a question
		// whose answer never changes.
		manifest = JSON.parse(readFileSync(path, 'utf8')) as GeoManifest;
	} catch {
		// A half-written manifest is treated as no manifest. Not cached either —
		// a fetch that was still writing will finish.
		return null;
	}
	return manifest;
}

/** Whether there is anything to draw at all. The Map's guidance state reads this. */
export const hasGeodata = (): boolean => geoManifest() !== null;

/** The command a developer has to run. Said in one place so it cannot drift. */
export const FETCH_COMMAND = 'npm run fetch:geodata';

/** The world outline, as the bytes on disk. Null when the fetch has not run. */
export async function worldOutline(): Promise<string | null> {
	if (!geoManifest()) return null;
	const path = join(GEODATA_DIR, 'countries-50m.json');
	if (!existsSync(path)) return null;
	return readFile(path, 'utf8');
}

/**
 * One country's provinces, gzipped, as they sit on disk.
 *
 * Handed back compressed so the route can pass the bytes straight through with
 * `Content-Encoding: gzip` — nothing is decompressed in order to be
 * recompressed. Null where the slug is not one the manifest knows, which is the
 * only check standing between a request and a path.
 */
export async function countryOutlines(slug: string): Promise<Uint8Array | null> {
	const found = geoManifest();
	if (!found) return null;

	// The two shared documents the progress cards read, served through the same
	// route. Named here rather than matched by pattern: a fixed pair of literals
	// cannot be made to point anywhere else.
	const path = Object.hasOwn(SHARED, slug)
		? join(GEODATA_DIR, SHARED[slug])
		: Object.hasOwn(found.files, slug)
			? join(GEODATA_DIR, 'admin1', `${slug}.json.gz`)
			: null;

	if (!path || !existsSync(path)) return null;
	return new Uint8Array(await readFile(path));
}

/** Documents that belong to the whole map rather than to one country. */
const SHARED: Record<string, string> = {
	zones: 'zones.json.gz',
	continents: 'continents.json.gz'
};

/** The slug a country code is filed under, or null if nothing is. */
export function slugForCountry(code: string): string | null {
	const found = geoManifest();
	if (!found) return null;
	const wanted = code.trim().toUpperCase();
	for (const entry of Object.values(found.countries)) {
		if (entry.code === wanted) return entry.slug;
	}
	return null;
}

/**
 * The world, already projected, so a browser never parses the topology.
 *
 * Turning the raw TopoJSON into path strings is a parse, a mesh
 * reconstruction and a projection per country — all main-thread work the Map
 * would otherwise redo on every open. Done here once and cached for the life
 * of the process, since the world does not change.
 */
let drawn: WorldShapes | null = null;

export interface WorldShapes {
	sphere: string;
	countries: { name: string; path: string; centroid: [number, number] }[];
}

export async function projectedWorld(): Promise<WorldShapes | null> {
	if (drawn) return drawn;
	const text = await worldOutline();
	if (!text) return null;

	const countries = countriesFrom(JSON.parse(text) as Topology);
	moveCrimea(countries);
	const projection = worldProjection(countries);

	drawn = {
		sphere: sphereOutline(projection),
		countries: shapesFrom(countries, projection).map((shape) => ({
			name: shape.name,
			path: shape.path,
			centroid: shape.centroid
		}))
	};
	return drawn;
}

/**
 * The time-zone card's bands, and which zone each country sits in.
 *
 * Worked out here, once, and cached: the browser has no use for the raw
 * geometry, only a path per band and which zone each country falls in — a
 * containment test that has no business running on a phone.
 */
let zonesReady: ZoneCard | null = null;

export interface ZoneCard {
	coastline: string;
	bands: { zone: number; label: string; path: string; middle: number }[];
	/** ISO code → the zone its centre falls in. */
	zoneOf: Record<string, number>;
}

export async function zoneCard(): Promise<ZoneCard | null> {
	if (zonesReady) return zonesReady;
	const manifest = geoManifest();
	const packed = await countryOutlines('zones');
	if (!manifest || !packed) return null;

	const { coastline, zones } = JSON.parse(gunzipSync(packed).toString('utf8')) as {
		coastline: string;
		zones: { zone: number; utc: string; geometry: Geometry[] }[];
	};

	const flat = geoEquirectangular().fitSize([720, 360], { type: 'Sphere' } as never);
	const draw = geoPath(flat);

	/*
	 * Where each offset is printed.
	 *
	 * The label is drawn at the FOOT of the card, so it is measured there — but
	 * the foot of an equirectangular map is Antarctica, where zones fan out
	 * from the pole and OVERLAP.
	 *
	 * So each column is given a single owner. Where two zones both reach a
	 * column it goes to the one whose own meridian is nearer, and each label is
	 * then centred in the widest run of columns that are unambiguously its own.
	 */
	const COLUMNS = 360;
	const LABEL_ROWS = [286, 310, 334, 352];

	/*
	 * The probe points, inverted ONCE rather than redone per zone — the
	 * `geoContains` tests behind them are the real cost, paid by whoever opens
	 * the Map first after a restart, since this answer is cached but never
	 * warmed.
	 */
	const probes: [number, number][][] = [];
	for (let at = 0; at < COLUMNS; at++) {
		const x = ((at + 0.5) / COLUMNS) * 720;
		probes[at] = LABEL_ROWS.map((y) => flat.invert?.([x, y])).filter(
			(point): point is [number, number] => Boolean(point)
		);
	}

	/**
	 * Whether a point is inside a feature's bounding box — west may wrap east.
	 *
	 * Width is folded rather than taken modulo 360, since a box spanning the
	 * whole circle would otherwise read as width zero and reject every point.
	 * This test may only ever return a cheap NO: rejecting what `geoContains`
	 * would accept is a hole in the band, not a saving.
	 */
	const inBox = (box: [[number, number], [number, number]], point: [number, number]): boolean => {
		if (point[1] < box[0][1] || point[1] > box[1][1]) return false;
		const span = box[1][0] - box[0][0];
		const width = span < 0 ? span + 360 : span;
		if (width >= 360) return true;
		return (point[0] - box[0][0] + 360) % 360 <= width;
	};

	const bands = zones.map((one) => {
		const features = one.geometry.map((geometry) => ({
			type: 'Feature' as const,
			properties: null,
			geometry
		}));
		// A box test first — cheap, and rejects almost every pair before
		// `geoContains` runs on the rest.
		const boxes = features.map(
			(feature) => geoBounds(feature as never) as [[number, number], [number, number]]
		);
		// Which columns this zone reaches, across the rows the label crosses.
		// Ownership is settled after every zone has been measured — see below.
		const reach: boolean[] = [];
		for (let at = 0; at < COLUMNS; at++) {
			reach[at] = probes[at].some((point) =>
				features.some(
					(feature, index) => inBox(boxes[index], point) && geoContains(feature as never, point)
				)
			);
		}

		return {
			zone: one.zone,
			label:
				one.utc || `UTC${one.zone === 0 ? '±0' : (one.zone < 0 ? '−' : '+') + Math.abs(one.zone)}`,
			path: features.map((f) => draw(f as never) ?? '').join(' '),
			reach,
			features
		};
	});

	/** Each column to one zone: the nearest meridian wins a contested one. */
	const owner: (number | null)[] = new Array(COLUMNS).fill(null);
	for (let at = 0; at < COLUMNS; at++) {
		const x = ((at + 0.5) / COLUMNS) * 720;
		let best: number | null = null;
		let nearest = Infinity;
		for (const band of bands) {
			if (!band.reach[at]) continue;
			const meridian = ((band.zone * 15 + 180) / 360) * 720;
			const away = Math.abs(x - meridian);
			if (away < nearest) {
				nearest = away;
				best = band.zone;
			}
		}
		owner[at] = best;
	}

	/** The middle of the widest run of columns matching a test. */
	const widestRun = (holds: (at: number) => boolean): number => {
		let middle = -1;
		let longest = 0;
		let from = -1;
		for (let at = 0; at <= COLUMNS; at++) {
			if (at < COLUMNS && holds(at)) {
				if (from < 0) from = at;
				continue;
			}
			if (from >= 0) {
				if (at - from > longest) {
					longest = at - from;
					middle = ((from + at) / 2 / COLUMNS) * 720;
				}
				from = -1;
			}
		}
		return middle;
	};

	/**
	 * Where a zone's label goes.
	 *
	 * Its own columns where it has any, and its widest reach where it has none.
	 * The fallback is for the half-hour offsets: India is UTC+05:30, so its
	 * meridian sits between +05:00's and +06:00's and it loses every contested
	 * column to whichever is nearer — it would own nothing and go unlabelled.
	 */
	const anchor = (band: { zone: number; reach: boolean[] }): number => {
		const owned = widestRun((at) => owner[at] === band.zone);
		return owned >= 0 ? owned : widestRun((at) => band.reach[at]);
	};

	const zoneOf: Record<string, number> = {};
	for (const entry of Object.values(manifest.countries)) {
		if (!entry.centre) continue;
		for (const band of bands) {
			if (band.features.some((f) => geoContains(f as never, entry.centre!))) {
				zoneOf[entry.code] = band.zone;
				break;
			}
		}
	}

	zonesReady = {
		coastline,
		// Every band, always: filtering here would drop the half-hour offsets
		// (India, Iran, Nepal, Venezuela) from the PAINTING too, not just the
		// labelling. A band with nowhere to put its label still has somewhere
		// to be drawn.
		bands: bands.map((band) => ({
			zone: band.zone,
			label: band.label,
			path: band.path,
			middle: anchor(band)
		})),
		zoneOf
	};
	return zonesReady;
}
