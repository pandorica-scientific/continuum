// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The parts of a country page a scratch cannot change.
 *
 * Split out because `world` is a 740 kB topology; a layout load doesn't
 * depend on `invalidate(VISITS)`, so SvelteKit reuses it instead of
 * re-parsing on every scratch.
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

	// The name the OUTLINE files it under, not the name a person would say.
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
		/** Outlines are served `immutable` for a year, so a redraw needs a new URL to reach cached browsers. */
		geoVersion: manifest.generated
	};
};
