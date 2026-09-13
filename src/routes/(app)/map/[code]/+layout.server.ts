// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The parts of a country page that a scratch cannot change.
 *
 * Split out of the page load for one reason: `world` is the 740 kB world
 * topology, and the page load re-runs on `invalidate(VISITS)` after every
 * region scratched off. That re-sent all of it and made the client re-parse it
 * and rebuild the projection, which is the blink — the map went to the "still
 * loading" outline and came back. A coin never showed it because rubbing one
 * invalidates nothing.
 *
 * A layout load does not depend on `VISITS`, so it does not re-run, and
 * SvelteKit hands the page back the SAME `world` string it already had. The
 * `$derived` that parses it is keyed on that identity, so it does not re-run
 * either.
 *
 * Nothing here reads the database. That is the test for whether something
 * belongs in this file rather than in the page's own load.
 */
import { error } from '@sveltejs/kit';
import { countryName } from '$lib/life/geo/countries';
import { geoManifest, slugForCountry, worldOutline } from '$lib/server/life/geodata';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ params }) => {
	const code = params.code.trim().toUpperCase();
	if (code.length !== 2) error(404, 'No such country');

	const manifest = geoManifest();
	if (!manifest) error(503, 'The map outlines have not been fetched.');

	const slug = slugForCountry(code);
	if (!slug) error(404, 'This map has no outline for that country.');

	// The name the OUTLINE files it under, which is how the feature is found in
	// the world topology — not the name a person would say.
	const outlineName =
		Object.entries(manifest.countries).find(([, entry]) => entry.code === code)?.[0] ?? '';

	return {
		code,
		slug,
		outlineName,
		name: countryName(code),
		world: await worldOutline(),
		/** How many provinces the fetch found, so the screen can say what is coming. */
		regionCount: manifest.files[slug]?.regions ?? 0,
		/**
		 * Which build of the outlines this is.
		 *
		 * The outlines are served `immutable` for a year, which is right for
		 * geometry that does not change — and a trap the moment it does: a
		 * release that redraws a country was invisible to every browser that had
		 * already opened it, for a year. Putting the build in the URL is what
		 * makes `immutable` honest; a new build is a new address.
		 */
		geoVersion: manifest.generated
	};
};
