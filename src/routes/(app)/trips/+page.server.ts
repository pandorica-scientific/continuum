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
	removeIdea,
	tripFigures
} from '$lib/server/life/trips';
import { writeVisitsForEndedTrips } from '$lib/server/life/visits';
import { tripReadiness } from '$lib/server/life/readiness';
import { readinessWord, worstOf } from '$lib/life/readiness';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	// A trip that has ended has been where it said it was going. Done on read
	// rather than on a timer: there is no scheduler to trust, and a household
	// opening the app after a holiday is exactly when this should happen.
	await writeVisitsForEndedTrips();

	const [trips, ideas, figures, people] = await Promise.all([
		listTrips(),
		listIdeas(),
		tripFigures(),
		db.select({ id: person.id, name: person.name }).from(person).orderBy(person.name)
	]);

	const hues = personHues(people.map((p) => p.id));

	// Readiness only for trips still to come. A passport that expired after a
	// holiday somebody already took is not news, and checking every past trip
	// would be one query per row for an answer nobody reads.
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
		// Labelled here rather than in the component: "Porto, Portugal" needs the
		// country's name, and a component that looked it up would do so per row.
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
			// Amber only when something genuinely wants attention. A nought here is
			// the state the block exists to reach, and a red nought is an alarm
			// about nothing.
			needsALook: upcoming.filter((trip) => {
				const hue = pillFor(trip.id)?.hue;
				return hue === 'yellow' || hue === 'red';
			}).length
		},
		people: people.map((p) => ({ ...p, hue: hues.get(p.id) ?? '--fg3' }))
	};
};

export const actions: Actions = {
	removeIdea: async ({ request }) => {
		const form = await request.formData();
		const id = asRowId(form.get('id'));
		if (!id) return fail(400, { message: 'No such idea.' });
		await removeIdea(id);
		return { removed: true };
	},

	/**
	 * Put a removed idea back.
	 *
	 * The undo bar restores the whole card rather than un-deleting a row: the
	 * original is gone by then, so what comes back is what the bar was holding.
	 * The artwork is resolved again from the same name and country, which is
	 * what makes it come back looking the same.
	 */
	restoreIdea: async ({ request }) => {
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (!name) return fail(400, { message: 'An idea needs a name.' });
		await addIdea({
			name,
			emoji: String(form.get('emoji') ?? ''),
			note: String(form.get('note') ?? ''),
			country: String(form.get('country') ?? '') || null,
			hearts: form.getAll('heart').map(String).filter(Boolean)
		});
		return { restored: true };
	},

	addIdea: async ({ request }) => {
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		// `on` names which dialog the message belongs to. Both dialogs read the
		// same `form` object, so without it a rejected idea reopens the trip
		// form and shows the error there.
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

		// Optional, so `asOptionalRowId`: the required variant turns an absent
		// field into the nil uuid, which is a real value that no idea has — and
		// the foreign key then rejects the whole trip with a 500. An id that is
		// present but names nothing is dropped for the same reason.
		const fromIdeaId = (await ideaExists(asOptionalRowId(form.get('fromIdeaId'))))
			? asOptionalRowId(form.get('fromIdeaId'))!
			: null;
		const id = await createTrip({
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
			fromIdeaId,
			art: form.get('art')
		});

		// Promoting an idea takes it off the board: it is the same plan, and
		// leaving it in Someday would ask the household to tidy up after itself.
		if (fromIdeaId) await removeIdea(fromIdeaId);

		// Straight to the trip that was just made. A dialog that closed back onto
		// the board would leave the household to find what it had just created.
		redirect(303, `/trips/${id}`);
	}
};
