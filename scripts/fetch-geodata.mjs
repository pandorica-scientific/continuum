#!/usr/bin/env node
/**
 * Fetch and trim the geometry the Map screen draws.
 *
 * Runs at BUILD or SETUP time, never at import time and never while somebody is
 * using the app — the same rule and the same reasoning as
 * `scripts/fetch-tessdata.mjs`. Continuum promises it does not call home, and
 * that promise is about what happens in front of a user. The prototype this was
 * built from fetched d3, topojson and both geometry files from a CDN on every
 * page load; none of that survives into the product.
 *
 *   npm run fetch:geodata
 *
 * Output lands in geodata/ (gitignored) and the Dockerfile runs this in its
 * build stage, exactly as it does for the OCR language data.
 *
 * ## What it costs, measured
 *
 *   world-atlas countries-50m     756 kB   copied as-is
 *   Natural Earth admin-1 10m    40.7 MB   trimmed to 21.8 MB, 5.8 MB gzipped
 *
 * Split per country that is 253 files, median 36 kB, largest Russia at 2.2 MB.
 * The download takes about two seconds on a CI runner.
 *
 * ## Why one province file and not two
 *
 * The design loaded Natural Earth's 50m file for nine large countries and the
 * 10m file on demand for everything else, because the prototype was paying CDN
 * bandwidth for whatever it loaded. Serving from Continuum's own origin removes
 * the reason for the split: every country is cut from the 10m file, trimmed and
 * gzipped on its own, and fetched when that country is opened. One source, one
 * file per country, better outlines everywhere, and no tier logic to get wrong.
 */
import { createHash } from 'node:crypto';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { geoMercator, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import {
	COUNTRY_CODE_OVERRIDES,
	REGION_ADMIN_OVERRIDES,
	adminNameFor
} from '../src/lib/life/geo/aliases.ts';
import { assignColours } from '../src/lib/life/geo/country-colour.ts';

const DIRECTORY = 'geodata';
const ADMIN1_DIRECTORY = join(DIRECTORY, 'admin1');

const WORLD_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json';
const ADMIN1_URL =
	'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_1_states_provinces.geojson';

/**
 * Three decimals, about 110 m.
 *
 * Well under a pixel at every zoom this map offers — the world fits a 960-unit
 * viewBox, so one unit is roughly 40 km — and it is most of the saving: the raw
 * file carries fifteen significant figures per coordinate, which is a precision
 * nobody asked for and nobody can see.
 */
const COORDINATE_PRECISION = 3;

/** The viewBox the map is fitted into. The colour bands are measured in it. */
const VIEW = { width: 960, height: 480, inset: 26 };

const exists = async (path) => {
	try {
		return (await stat(path)).size > 0;
	} catch {
		return false;
	}
};

async function download(url, label) {
	process.stdout.write(`  fetching ${label}… `);
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${label}: ${response.status} ${response.statusText}`);
	const text = await response.text();
	console.log(`${(text.length / 1e6).toFixed(1)} MB`);
	return text;
}

const round = (value) => {
	const factor = 10 ** COORDINATE_PRECISION;
	return Math.round(value * factor) / factor;
};

/** Round every coordinate in a geometry, at whatever nesting depth it has. */
const roundCoordinates = (coordinates) =>
	typeof coordinates[0] === 'number'
		? [round(coordinates[0]), round(coordinates[1])]
		: coordinates.map(roundCoordinates);

/** A country's file name: stable, lower case, and safe in a URL. */
export const countrySlug = (admin) =>
	admin
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');

/**
 * Move a region to the country that holds sovereignty over it.
 *
 * Natural Earth records de facto control, so Crimea and Sevastopol arrive under
 * Russia. The override list is in `aliases.ts` beside the name table, and this
 * is the only place it is applied.
 */
function overrideAdmin(properties) {
	const candidates = [
		properties.name,
		properties.name_en,
		properties.name_local,
		properties.gn_name
	]
		.filter(Boolean)
		.map((name) => String(name));
	for (const rule of REGION_ADMIN_OVERRIDES) {
		if (properties.admin !== rule.from) continue;
		if (candidates.some((name) => rule.names.includes(name))) return rule.to;
	}
	return properties.admin;
}

async function main() {
	await mkdir(ADMIN1_DIRECTORY, { recursive: true });

	const manifestPath = join(DIRECTORY, 'manifest.json');
	const worldPath = join(DIRECTORY, 'countries-50m.json');

	if (await exists(manifestPath)) {
		console.log('  have geodata/ — delete it to refetch');
		return;
	}

	// ---- The world outline, copied as it comes ----
	const worldText = await download(WORLD_URL, 'world-atlas countries-50m');
	const world = JSON.parse(worldText);
	await writeFile(worldPath, worldText);

	// ---- The province outlines, trimmed and split ----
	const adminText = await download(ADMIN1_URL, 'natural-earth admin-1 10m');
	const admin1 = JSON.parse(adminText);

	/** admin name → its features, and the alpha-2 code its provinces carry. */
	const byAdmin = new Map();
	for (const source of admin1.features) {
		const properties = source.properties;
		const admin = overrideAdmin(properties);
		if (!byAdmin.has(admin)) byAdmin.set(admin, { code: null, features: [] });
		const entry = byAdmin.get(admin);
		// The overridden regions still carry Russia's code; the country they were
		// moved TO supplies its own from its own provinces.
		if (admin === properties.admin && /^[A-Z]{2}$/.test(properties.iso_a2 ?? '')) {
			entry.code ??= properties.iso_a2;
		}
		entry.features.push({
			type: 'Feature',
			properties: {
				admin,
				name: properties.name ?? null,
				name_en: properties.name_en ?? null
			},
			geometry: {
				type: source.geometry.type,
				coordinates: roundCoordinates(source.geometry.coordinates)
			}
		});
	}

	let written = 0;
	let bytes = 0;
	const files = {};
	for (const [admin, { features }] of byAdmin) {
		const slug = countrySlug(admin);
		const body = JSON.stringify({ type: 'FeatureCollection', features });
		const packed = gzipSync(body, { level: 9 });
		await writeFile(join(ADMIN1_DIRECTORY, `${slug}.json.gz`), packed);
		files[slug] = { regions: features.length, bytes: packed.length };
		written += 1;
		bytes += packed.length;
	}

	// ---- Join the two datasets, and refuse to guess ----
	//
	// Keyed by NAME, not by the numeric ISO id world-atlas also carries. Five of
	// its 241 outlines have no id at all — Kosovo, Somaliland, Northern Cyprus,
	// the Indian Ocean Territories and the Siachen Glacier — so keying by id
	// collapses all five onto the string "undefined", and Kosovo is a country
	// somebody can go on holiday to. Australia and Ashmore and Cartier Islands
	// share the id 036, so one silently overwrites the other. Names are unique
	// across all 241, and are what a clicked feature carries.
	const countries = feature(world, world.objects.countries).features;
	const codes = {};
	const unresolved = [];
	for (const country of countries) {
		const name = country.properties.name;
		const admin = adminNameFor(name);
		const entry = byAdmin.get(admin);
		const code = entry?.code ?? COUNTRY_CODE_OVERRIDES[name] ?? null;
		if (!code) {
			unresolved.push(name);
			continue;
		}
		codes[name] = { code, admin, slug: countrySlug(admin) };
	}

	// A country whose name resolves to nothing scratches as one piece, which does
	// not look like a fault — it looks like a decision. So it fails here, loudly,
	// where a name can be added to the alias table, rather than in front of
	// somebody who has just come back from holiday.
	//
	// The eleven Natural Earth admins with no ISO code (Somaliland, Northern
	// Cyprus, the sovereign base areas, Antarctica's claims) are expected: there
	// is no alpha-2 code to record a visit under, so they are listed and allowed.
	if (unresolved.length > 12) {
		console.error(`\n  ${unresolved.length} countries have no code:`);
		for (const name of unresolved.sort()) console.error(`    ${name}`);
		console.error('\n  Add them to COUNTRY_NAME_ALIASES in src/lib/life/geo/aliases.ts.');
		process.exit(1);
	}
	if (unresolved.length) {
		console.log(`  ${unresolved.length} outlines carry no ISO code: ${unresolved.join(', ')}`);
	}

	// ---- The colour each country wears, decided once ----
	//
	// Computed here rather than in the browser so the stamp on a past trip can
	// be inked in its country's colour without loading a world atlas to find out
	// what that colour is.
	const projection = geoMercator().fitExtent(
		[
			[VIEW.inset, VIEW.inset],
			[VIEW.width - VIEW.inset, VIEW.height - VIEW.inset]
		],
		{ type: 'Sphere' }
	);
	const path = geoPath(projection);
	const centroids = [];
	for (const country of countries) {
		const known = codes[country.properties.name];
		if (!known) continue;
		const [x, y] = path.centroid(country);
		if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
		centroids.push({ code: known.code, x, y });
	}
	const colours = Object.fromEntries(assignColours(centroids));

	const manifest = {
		version: 1,
		generated: new Date().toISOString().slice(0, 10),
		sources: { world: WORLD_URL, admin1: ADMIN1_URL },
		precision: COORDINATE_PRECISION,
		view: VIEW,
		countries: codes,
		colours,
		files
	};
	await writeFile(manifestPath, JSON.stringify(manifest));

	// The colour table is source, not data: the stamp wall imports it directly,
	// and a build that has not fetched the geometry must still compile.
	await writeColourTable(colours);

	console.log(
		`  ${written} countries, ${(bytes / 1e6).toFixed(1)} MB gzipped, ` +
			`${Object.keys(codes).length} outlines coded`
	);
}

/**
 * Write the country → colour table into the source tree.
 *
 * Generated rather than hand-kept, and committed rather than fetched: the trip
 * stamps need it at build time in an environment that may never have run this
 * script, and a table nobody can regenerate is a table that rots. Re-running
 * this script rewrites it, and the file says so.
 */
async function writeColourTable(colours) {
	const target = 'src/lib/life/geo/country-colour-table.ts';
	const entries = Object.entries(colours)
		.sort(([a], [b]) => (a < b ? -1 : 1))
		.map(([code, colour]) => `\t${code}: '${colour}'`)
		.join(',\n');
	const digest = createHash('sha256').update(entries).digest('hex').slice(0, 12);
	const body = `// SPDX-License-Identifier: AGPL-3.0-or-later
// GENERATED FILE — DO NOT EDIT.
//
// Written by \`npm run fetch:geodata\` from the projected world outline, so the
// stamp on a past trip can be inked in its country's own colour without the
// stamp wall loading a world atlas to find out what that colour is.
//
// The assignment itself lives in \`country-colour.ts\` and is spatial: two
// countries that share a border cannot share a slot. Re-running the script
// rewrites this file; editing it by hand puts the map and the stamps into
// different colours for the same place.
//
// fingerprint: ${digest}
import type { CountryColour } from './country-colour';

export const COUNTRY_COLOURS: Readonly<Record<string, CountryColour>> = {
${entries}
};
`;
	await writeFile(target, body);
}

try {
	await main();
} catch (error) {
	// A half-written geodata/ would be treated as complete by the `exists` check
	// on the next run, and the failure would look like a rendering bug days later.
	await rm(DIRECTORY, { recursive: true, force: true }).catch(() => {});
	console.error(`\ndesign:geodata — ${error.message}`);
	process.exit(1);
}
