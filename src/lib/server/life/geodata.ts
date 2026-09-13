// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The outlines the Map draws, read off the disk they were fetched onto.
 *
 * `geodata/` is written at image-build time by `scripts/fetch-geodata.mjs`,
 * exactly as tessdata is, and never at runtime. So everything here is a read of
 * files that are already there — or the honest report that a developer has not
 * run the fetch yet, which is a state the Map is expected to draw rather than a
 * reason to fail.
 *
 * NOTHING here joins a request to a path. A slug is looked up in the manifest
 * and the manifest's own answer is what opens; a name that is not in it does
 * not reach the filesystem at all. That is the same lesson `/files/[name]`
 * carries: a path built from something a browser sent is a traversal waiting to
 * be found.
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
	// A MISS IS NOT CACHED. Caching it would mean a developer who runs the fetch
	// while the server is up sees "not fetched" until they restart — and the
	// only cost of re-checking is one `existsSync` on a page nobody is loading
	// in a loop.
	if (!existsSync(path)) return null;
	try {
		// Synchronous deliberately: this is one small file, read once, and every
		// caller below would otherwise have to be async to ask a question whose
		// answer never changes.
		manifest = JSON.parse(readFileSync(path, 'utf8')) as GeoManifest;
	} catch {
		// A half-written manifest is the same situation as no manifest: the map
		// says the geodata is missing and names the command that fixes it. Not
		// cached either — a fetch that was still writing will finish.
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
 * This is the fix for the several-second stall when the Map opens: the outline
 * is 756 kB of TopoJSON, and turning it into 240 path strings is a parse, a
 * mesh reconstruction and 240 projections — all on the main thread, all before
 * anything on the screen responds. Doing it here costs one server render and is
 * then cached for the life of the process, because the world does not change.
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
 * Worked out here, once, and cached: the zones file is a megabyte of geometry
 * and the browser has no use for it. What the card needs is a path per band —
 * rounded at fetch time — and the answer to "which zone is this country in",
 * which is a containment test over 40 bands that has no business running on a
 * phone.
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
	 * The label is drawn vertically at the FOOT of the card, so it is measured
	 * there — three earlier anchors all failed by measuring the band somewhere
	 * the text does not sit. But the foot of an equirectangular map is
	 * Antarctica, where the zones fan out from the pole and OVERLAP: UTC+11
	 * reaches 676-706 and UTC+12 reaches 690-720, so both labels centred within
	 * fourteen units of each other and sat on top of one another.
	 *
	 * So each column is given a single owner. Where two zones both reach a
	 * column it goes to the one whose own meridian is nearer, and each label is
	 * then centred in the widest run of columns that are unambiguously its own.
	 */
	const COLUMNS = 360;
	const LABEL_ROWS = [286, 310, 334, 352];

	/*
	 * The probe points, inverted ONCE.
	 *
	 * Inside the per-zone loop this was the same 1,440 inversions redone for
	 * every band, and the `geoContains` behind them was the real cost: forty
	 * zones × 360 columns × four rows is 57,600 point-in-multipolygon tests
	 * against geometry with tens of thousands of vertices, which measured
	 * sixteen seconds on the shipped `zones.json.gz` — paid by whoever opened
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
	 * The width is folded rather than taken modulo 360, which would turn a box
	 * that spans the whole circle into a box of width zero and reject every
	 * point in it. `geoBounds` reports exactly that — `[[-180, …], [180, …]]` —
	 * for anything containing a pole or reaching more than half way round, and
	 * this pass is only ever allowed to be a cheap NO: a box test that rejects
	 * what `geoContains` would accept is a hole in the band, not a saving.
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
		// A box test first, because it rejects almost every pair for the price of
		// four comparisons and leaves `geoContains` only the handful that could
		// actually be inside.
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
		// Every band, always. Filtering this list once dropped the half-hour
		// offsets — India, Iran, Nepal, Venezuela — out of the PAINTING as well
		// as out of the labelling, and they came out as black holes in the map.
		// A band with nowhere to put its label still has somewhere to be drawn.
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
