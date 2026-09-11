// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Serving the province outlines.
 *
 * The thing worth testing is the thing that could go wrong: a filename from a
 * browser must never become a path. Everything below goes through
 * `countryOutlines`, which looks a slug up in the generated manifest and opens
 * the manifest's own answer.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Read as source rather than imported.
 *
 * The module reads `geodata/`, which a checkout may not have — the fetch runs
 * at image-build time. Asserting on the source is what `screen-frame.test.ts`
 * already does for the same reason: some rules can only be checked where they
 * are written.
 */
const geodata = readFileSync('src/lib/server/life/geodata.ts', 'utf8');
const route = readFileSync('src/routes/(app)/map/geo/[file]/+server.ts', 'utf8');

describe('the outlines module', () => {
	// The one check standing between a request and the filesystem.
	it('will not open a slug the manifest does not list', () => {
		expect(geodata).toMatch(/Object\.hasOwn\(found\.files, slug\)/);
	});

	it('joins the directory itself rather than taking a path', () => {
		// Every join starts from GEODATA_DIR and a literal, never from an argument
		// that could carry a separator or a `..`.
		for (const call of geodata.match(/join\([^)]*\)/g) ?? []) {
			expect(call, call).toMatch(/join\(GEODATA_DIR/);
		}
	});

	// A checkout without geodata is a state the Map draws, not a crash.
	it('reports missing geodata rather than throwing', () => {
		expect(geodata).toMatch(/export const hasGeodata/);
		expect(geodata).toMatch(/FETCH_COMMAND = 'npm run fetch:geodata'/);
	});

	it('holds the manifest rather than re-reading it per request', () => {
		expect(geodata).toMatch(/if \(manifest !== undefined\) return manifest;/);
	});
});

describe('the route', () => {
	it('serves the gzip as it lies', () => {
		expect(route).toMatch(/'content-encoding': 'gzip'/);
		// Decompressing to recompress would throw away the whole point of
		// gzipping at fetch time.
		expect(route).not.toMatch(/gunzip|inflate|createGunzip/);
	});

	it('caches hard, and privately', () => {
		expect(route).toMatch(/'cache-control': 'private, max-age=31536000, immutable'/);
	});

	// A developer who has not run the fetch gets told which, rather than a 404
	// that reads as "this country has no provinces".
	it('tells a missing fetch apart from a missing country', () => {
		expect(route).toMatch(/hasGeodata\(\)\) error\(503/);
		expect(route).toMatch(/error\(404, 'No outlines for that country\.'\)/);
	});

	it('never builds a path of its own', () => {
		expect(route).not.toMatch(/join\(|readFile|existsSync/);
	});
});
