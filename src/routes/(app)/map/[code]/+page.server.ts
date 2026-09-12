// SPDX-License-Identifier: AGPL-3.0-or-later
import { error, fail } from '@sveltejs/kit';
import { asOptionalRowId } from '$lib/ids';
import { countryName } from '$lib/life/geo/countries';
import { geoManifest, slugForCountry, worldOutline } from '$lib/server/life/geodata';
import {
	addManualVisit,
	countryVisits,
	writeVisitsForEndedTrips
} from '$lib/server/life/visits';
import { localToday } from '$lib/dates';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
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

	await writeVisitsForEndedTrips();
	const [world, rows] = await Promise.all([worldOutline(), countryVisits(code)]);

	/**
	 * Whose view this is, carried from the world map's member tabs.
	 *
	 * Household is the aggregate; a person's view is what that person saw. The
	 * same answer has to hold on both screens, or scratching on one tab quietly
	 * credits the other.
	 */
	const who = asOptionalRowId(url.searchParams.get('who'));

	// One filter over one set of rows. Regions, cities and years are all this
	// person's, or all the household's — never a mix of the two.
	const mine = rows.filter((row) => !who || row.personId === who);

	return {
		code,
		who: who ?? null,
		slug,
		outlineName,
		name: countryName(code),
		world,
		/** How many provinces the fetch found, so the screen can say what is coming. */
		regionCount: manifest.files[slug]?.regions ?? 0,
		// Whose view this is: the household sees every row, a person sees theirs.
		visited: {
			regions: [...new Set(mine.map((row) => row.region).filter((one) => one !== null))],
			cities: [...new Set(mine.map((row) => row.city).filter((one) => one !== null))],
			years: [...new Set(mine.map((row) => row.year))].sort((a, b) => a - b)
		}
	};
};

export const actions: Actions = {
	/**
	 * A region somebody scratched the foil off.
	 *
	 * Written as a real visit with `source = 'manual'`, which is what makes the
	 * scratch mean anything: the country then colours in on the world map, the
	 * tiles count it, and it is still there tomorrow. Scratching that only
	 * changed a canvas was a drawing, not a record.
	 *
	 * The region name is the one the MAP uses, which is the point — it is the
	 * only name that can be matched back against the outline it came from.
	 */
	scratched: async ({ request, params }) => {
		const code = params.code.trim().toUpperCase();
		if (code.length !== 2) return fail(400, { on: 'scratch', message: 'No such country.' });

		const form = await request.formData();
		const region = String(form.get('region') ?? '').trim();
		if (!region) return fail(400, { on: 'scratch', message: 'Which region?' });

		// Credited to whoever's tab the scratch happened on. A visit with no
		// member still counts towards the household, which is the aggregate —
		// so scratching from the household view is "somebody went", not "nobody".
		const who = asOptionalRowId(form.get('who'));

		await addManualVisit({
			country: code,
			region,
			city: null,
			year: Number(localToday().slice(0, 4)),
			members: who ? [who] : []
		});
		return { scratched: true };
	}
};
