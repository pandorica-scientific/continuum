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
