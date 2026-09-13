// SPDX-License-Identifier: AGPL-3.0-or-later
import { error, fail } from '@sveltejs/kit';
import { asOptionalRowId } from '$lib/ids';
import { countryName } from '$lib/life/geo/countries';
import {
	addManualVisit,
	countryVisits,
	removeManualVisit,
	writeVisitsForEndedTrips
} from '$lib/server/life/visits';
import { localToday } from '$lib/dates';
import { VISITS } from '$lib/life/map/depends';
import {
	artVersion,
	hasArt,
	markSeen,
	placesFor,
	seenIn,
	unmarkSeen
} from '$lib/server/life/places';
import type { Actions, PageServerLoad } from './$types';

/**
 * Everything about this country that a scratch CAN change.
 *
 * The outlines are not here — they are in `+layout.server.ts`, because this
 * load re-runs on every scratch and they are 740 kB. See that file.
 */
export const load: PageServerLoad = async ({ params, url, depends }) => {
	depends(VISITS);

	const code = params.code.trim().toUpperCase();
	if (code.length !== 2) error(404, 'No such country');

	const version = await artVersion();

	await writeVisitsForEndedTrips();
	const rows = await countryVisits(code);

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
		who: who ?? null,
		/**
		 * The places worth the detour here, as coins.
		 *
		 * Filtered to those whose engraving exists, because a place without one is
		 * not offered at all — `hasArt` reads a directory listing once per process
		 * rather than a file per place, since the engravings ship inside the image
		 * and cannot change while it runs.
		 *
		 * The URL carries the build stamp: these are served `immutable` for a
		 * year, and v0.9.1 already learned what that costs at a fixed address.
		 */
		sights: (await placesFor(code))
			.filter((one) => hasArt(one.id))
			.map((one) => ({
				id: one.id,
				name: one.name,
				where: one.region ?? countryName(code),
				art: `/map/sight/${one.id}?v=${version}`
			})),
		seen: await seenIn(code),
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
	},

	/**
	 * Take that scratch back, within the few seconds the pill offers it.
	 *
	 * Deletes only the hand-made visit — `removeManualVisit` says why. Undoing
	 * something the trips pass wrote would look like it worked and then be
	 * rewritten on the next load, which is worse than refusing.
	 */
	unscratched: async ({ request, params }) => {
		const code = params.code.trim().toUpperCase();
		if (code.length !== 2) return fail(400, { on: 'scratch', message: 'No such country.' });

		const form = await request.formData();
		const region = String(form.get('region') ?? '').trim();
		if (!region) return fail(400, { on: 'scratch', message: 'Which region?' });

		// Refused rather than reported as done, which is what the paragraph above
		// promises and what the code did not do: `{ unscratched: false }` is a
		// SUCCESS to every caller, so an undo that removed nothing recoated the
		// region, said "put back", and was contradicted by the next load.
		const removed = await removeManualVisit(code, region);
		if (removed === 0) {
			return fail(409, {
				on: 'scratch',
				message: 'A trip records that one, so it stays until the trip does not.'
			});
		}
		return { unscratched: true };
	},

	/**
	 * A coin rubbed off: this PLACE has been seen.
	 *
	 * Writes `sight_visit` and nothing else. It deliberately does not mark the
	 * country visited — `visit` is the only answer to that question, and seeing
	 * a place on a layover is not the same as having been.
	 */
	seen: async ({ request }) => {
		const form = await request.formData();
		const placeId = String(form.get('place') ?? '').trim();
		if (!placeId) return fail(400, { on: 'sight', message: 'Which place?' });

		const known = await markSeen(placeId, Number(localToday().slice(0, 4)));
		if (!known) return fail(400, { on: 'sight', message: 'No such place.' });
		return { seen: true };
	},

	/** Take that back, within the few seconds the pill offers it. */
	unseen: async ({ request }) => {
		const form = await request.formData();
		const placeId = String(form.get('place') ?? '').trim();
		if (!placeId) return fail(400, { on: 'sight', message: 'Which place?' });

		await unmarkSeen(placeId);
		return { unseen: true };
	}
};
