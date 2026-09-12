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
import { geoContains, geoEquirectangular, geoPath } from 'd3-geo';
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
 * Read once and held.
 *
 * The manifest is written at build time and cannot change while the server is
 * up, so re-reading it per request would be a syscall to learn something that
 * is already known. `undefined` means "not looked at yet"; `null` means looked
 * at and genuinely absent.
 */
let manifest: GeoManifest | null | undefined;

export function geoManifest(): GeoManifest | null {
	if (manifest !== undefined) return manifest;
	const path = join(GEODATA_DIR, 'manifest.json');
	if (!existsSync(path)) return (manifest = null);
	try {
		// Synchronous deliberately: this is one small file, read once, and every
		// caller below would otherwise have to be async to ask a question whose
		// answer never changes.
		manifest = JSON.parse(readFileSync(path, 'utf8')) as GeoManifest;
	} catch {
		// A half-written manifest is the same situation as no manifest: the map
		// says the geodata is missing and names the command that fixes it.
		manifest = null;
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

	const bands = zones.map((one) => {
		const features = one.geometry.map((geometry) => ({
			type: 'Feature' as const,
			properties: null,
			geometry
		}));
		const [[x0], [x1]] = draw.bounds({ type: 'FeatureCollection', features } as never);
		return {
			zone: one.zone,
			label:
				one.utc || `UTC${one.zone === 0 ? '±0' : (one.zone < 0 ? '−' : '+') + Math.abs(one.zone)}`,
			path: features.map((f) => draw(f as never) ?? '').join(' '),
			middle: (x0 + x1) / 2,
			features
		};
	});

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
		bands: bands.map(({ zone, label, path, middle }) => ({ zone, label, path, middle })),
		zoneOf
	};
	return zonesReady;
}
