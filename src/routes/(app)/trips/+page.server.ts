// SPDX-License-Identifier: AGPL-3.0-or-later
import { fail, redirect } from '@sveltejs/kit';
import { asOptionalRowId, asRowId } from '$lib/ids';
import { db } from '$lib/server/db';
import { person } from '$lib/server/db/schema';
import { personHues } from '$lib/people';
import { countryName } from '$lib/life/geo/countries';
import {
	addIdea,
	createTrip,
	destinationLabel,
	ideaExists,
	listIdeas,
	listTrips,
	promoteIdea,
	removedTripName,
	removeIdea,
	restoreIdea,
	restoreTrip,
	tripFigures
} from '$lib/server/life/trips';
import { writeVisitsForEndedTrips } from '$lib/server/life/visits';
import { tripReadiness } from '$lib/server/life/readiness';
import { readinessWord, worstOf } from '$lib/life/readiness';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	// Done on read rather than on a timer — there's no scheduler to trust.
	await writeVisitsForEndedTrips();

	const [trips, ideas, figures, people] = await Promise.all([
		listTrips(),
		listIdeas(),
		tripFigures(),
		db.select({ id: person.id, name: person.name }).from(person).orderBy(person.name)
	]);

	const hues = personHues(people.map((p) => p.id));

	// Readiness only for trips still to come — a past trip's expired passport isn't news.
	const upcoming = trips.filter((trip) => trip.upcoming);
	const readiness = new Map(
		await Promise.all(
			upcoming.map(
				async (trip) =>
					[
						trip.id,
						await tripReadiness({
							members: trip.members,
							destinations: trip.destinations,
							returnsOn: trip.endsOn
						})
					] as const
			)
		)
	);

	/** The worst thing on a trip's readiness line, as a pill. */
	const pillFor = (id: string) => {
		const lines = readiness.get(id);
		if (!lines?.length) return undefined;
		const hue = worstOf(lines);
		return { hue, label: readinessWord(hue) };
	};

	return {
		// Labelled here rather than in the component, to avoid a per-row lookup there.
		trips: trips.map((trip) => ({
			...trip,
			readiness: pillFor(trip.id),
			destinations: trip.destinations.map((destination) => ({
				...destination,
				label: destinationLabel(destination, countryName)
			}))
		})),
		ideas,
		figures: {
			...figures,
			// Amber/red only when something genuinely needs attention — zero is the target state, not an alarm.
			needsALook: upcoming.filter((trip) => {
				const hue = pillFor(trip.id)?.hue;
				return hue === 'yellow' || hue === 'red';
			}).length
		},
		people: people.map((p) => ({ ...p, hue: hues.get(p.id) ?? '--fg3' })),
		// A trip deleted from its own page lands here with its id, so the undo bar
		// can offer it back. Null once the sweep has taken it, or for a stale link.
		removedTrip: await removedTripFrom(url.searchParams.get('removed'))
	};
};

async function removedTripFrom(raw: string | null) {
	const id = asOptionalRowId(raw);
	if (!id) return null;
	const name = await removedTripName(id);
	return name ? { id, name } : null;
}

export const actions: Actions = {
	removeIdea: async ({ request }) => {
		const form = await request.formData();
		const id = asRowId(form.get('id'));
		if (!id) return fail(400, { message: 'No such idea.' });
		await removeIdea(id);
		return { removed: true };
	},

	/**
	 * Put a removed idea back: the same row, which removal only hid, so its
	 * hearts, stamp and plans come back with it rather than a copy rebuilt from
	 * what the undo bar remembered.
	 */
	restoreIdea: async ({ request }) => {
		const form = await request.formData();
		const id = asRowId(form.get('id'));
		await restoreIdea(id);
		return { restored: true };
	},

	/** The same, for a trip deleted from its own page. */
	restoreTrip: async ({ request }) => {
		const form = await request.formData();
		const id = asRowId(form.get('id'));
		// An undo from a page left open past the sweep has nothing to open.
		redirect(303, (await restoreTrip(id)) ? `/trips/${id}` : '/trips');
	},

	addIdea: async ({ request }) => {
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		// `on` names which dialog the message belongs to — both dialogs share the same `form` object.
		if (!name) return fail(400, { on: 'idea', message: 'An idea needs somewhere to go.' });
		await addIdea({
			name,
			emoji: String(form.get('emoji') ?? ''),
			note: String(form.get('note') ?? '').trim(),
			country: String(form.get('country') ?? '').toUpperCase() || null,
			hearts: form.getAll('heart').map(String).filter(Boolean),
			art: form.get('art')
		});
		return { added: true };
	},

	newTrip: async ({ request }) => {
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const startsOn = String(form.get('startsOn') ?? '');
		const endsOn = String(form.get('endsOn') ?? '');
		if (!name) return fail(400, { on: 'trip', message: 'A trip needs a name.' });
		if (!startsOn || !endsOn) return fail(400, { on: 'trip', message: 'A trip needs both dates.' });
		if (endsOn < startsOn) {
			return fail(400, { on: 'trip', message: 'A trip cannot end before it starts.' });
		}

		const country = String(form.get('country') ?? '')
			.toUpperCase()
			.trim();
		if (!/^[A-Z]{2}$/.test(country)) {
			return fail(400, { on: 'trip', message: 'Where is it going? Two letters, like PT.' });
		}

		// `asOptionalRowId`, not the required variant — that turns an absent field into
		// the nil uuid, a real value no idea has, and the foreign key rejects it with a 500.
		const fromIdeaId = (await ideaExists(asOptionalRowId(form.get('fromIdeaId'))))
			? asOptionalRowId(form.get('fromIdeaId'))!
			: null;
		const input = {
			name,
			emoji: String(form.get('emoji') ?? ''),
			startsOn,
			endsOn,
			notes: '',
			destinations: [
				{
					country,
					region: String(form.get('region') ?? '').trim() || null,
					city: String(form.get('city') ?? '').trim() || null
				}
			],
			members: form.getAll('member').map(String).filter(Boolean),
			art: form.get('art')
		};
		// Promoting an idea takes it off the board — it's the same plan now, not a
		// duplicate — and carries its note, stamp and plans onto the trip.
		const id = fromIdeaId ? await promoteIdea(fromIdeaId, input) : await createTrip(input);

		redirect(303, `/trips/${id}`);
	}
};
