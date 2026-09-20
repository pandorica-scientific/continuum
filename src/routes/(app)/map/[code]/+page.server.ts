// SPDX-License-Identifier: AGPL-3.0-or-later
import { error, fail } from '@sveltejs/kit';
import { asc } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { person } from '$lib/server/db/schema';
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
 * Everything about this country that a scratch CAN change — the 740 kB
 * outlines live in `+layout.server.ts`, which doesn't re-run on every scratch.
 */
export const load: PageServerLoad = async ({ params, url, depends }) => {
	depends(VISITS);

	const code = params.code.trim().toUpperCase();
	if (code.length !== 2) error(404, 'No such country');

	const version = await artVersion();

	await writeVisitsForEndedTrips();
	const rows = await countryVisits(code);

	/** Whose view this is, carried from the world map's member tabs. */
	const who = asOptionalRowId(url.searchParams.get('who'));

	// Regions, cities and years are all this person's, or all the household's
	// — never a mix of the two.
	const mine = rows.filter((row) => !who || row.personId === who);

	return {
		who: who ?? null,
		// The same tabs the world map draws. They follow you in here rather than
		// vanishing, so switching person does not mean going back first.
		people: await db
			.select({ id: person.id, name: person.name })
			.from(person)
			.orderBy(asc(person.name)),
		/** Filtered to places with an engraving on disk; URL carries the build stamp since these are served `immutable`. */
		sights: (await placesFor(code))
			.filter((one) => hasArt(one.id))
			.map((one) => ({
				id: one.id,
				name: one.name,
				where: one.region ?? countryName(code),
				art: `/map/sight/${one.id}?v=${version}`
			})),
		seen: await seenIn(code),
		visited: {
			regions: [...new Set(mine.map((row) => row.region).filter((one) => one !== null))],
			cities: [...new Set(mine.map((row) => row.city).filter((one) => one !== null))],
			years: [...new Set(mine.map((row) => row.year))].sort((a, b) => a - b)
		}
	};
};

export const actions: Actions = {
	/** Written as a real visit (`source = 'manual'`) so it colours the world map and persists. */
	scratched: async ({ request, params }) => {
		const code = params.code.trim().toUpperCase();
		if (code.length !== 2) return fail(400, { on: 'scratch', message: 'No such country.' });

		const form = await request.formData();
		const region = String(form.get('region') ?? '').trim();
		if (!region) return fail(400, { on: 'scratch', message: 'Which region?' });

		// Credited to whoever's tab the scratch happened on. The household tab has
		// nobody to credit — it is the union of everybody's visits, a reading
		// rather than a record — so a scratch there is refused rather than
		// written with no member. A member-less visit is a fact no person's tab
		// can show and nothing can afterwards attribute.
		const who = asOptionalRowId(form.get('who'));
		if (!who) {
			return fail(400, {
				on: 'scratch',
				message: 'Pick a person first — the household view only shows everyone together.'
			});
		}

		await addManualVisit({
			country: code,
			region,
			city: null,
			year: Number(localToday().slice(0, 4)),
			members: [who]
		});
		return { scratched: true };
	},

	/** Deletes only the hand-made visit — undoing one the trips pass wrote would just be rewritten on the next load. */
	unscratched: async ({ request, params }) => {
		const code = params.code.trim().toUpperCase();
		if (code.length !== 2) return fail(400, { on: 'scratch', message: 'No such country.' });

		const form = await request.formData();
		const region = String(form.get('region') ?? '').trim();
		if (!region) return fail(400, { on: 'scratch', message: 'Which region?' });

		// Same rule as scratching, for the same reason: the household view is a
		// reading of everybody's visits, and taking one back there would be
		// removing somebody else's without saying whose.
		const who = asOptionalRowId(form.get('who'));
		if (!who) {
			return fail(400, {
				on: 'scratch',
				message: 'Pick a person first — the household view only shows everyone together.'
			});
		}

		// Refused rather than reported as done: `{ unscratched: false }` still
		// reads as success to every caller, so an undo that removed nothing
		// would say "put back" and be contradicted by the next load.
		const removed = await removeManualVisit(code, region, who);
		if (removed === 0) {
			return fail(409, {
				on: 'scratch',
				message: 'A trip records that one, so it stays until the trip does not.'
			});
		}
		return { unscratched: true };
	},

	/** Writes `sight_visit` only — does not mark the country visited (a layover isn't a visit). */
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
