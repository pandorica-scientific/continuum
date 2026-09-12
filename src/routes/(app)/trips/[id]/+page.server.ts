// SPDX-License-Identifier: AGPL-3.0-or-later
import { error, fail, redirect } from '@sveltejs/kit';
import { asRowId } from '$lib/ids';
import { db } from '$lib/server/db';
import { person } from '$lib/server/db/schema';
import { personHues } from '$lib/people';
import { countryName } from '$lib/life/geo/countries';
import { ENUMS, isEnumValue } from '$lib/enums';
import { saveUploadAndHash } from '$lib/server/system/files';
import { tripReadiness } from '$lib/server/life/readiness';
import { visaCaption } from '$lib/life/visa';
import {
	addBooking,
	attachBookingFile,
	detachBookingFile,
	addPlace,
	deleteBooking,
	deletePlace,
	deleteTrip,
	destinationLabel,
	loadTrip,
	saveNotes,
	togglePlace,
	updateTrip
} from '$lib/server/life/trips';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const id = asRowId(params.id);
	if (!id) error(404, 'No such trip');

	const trip = await loadTrip(id);
	if (!trip) error(404, 'No such trip');

	const [people, readiness] = await Promise.all([
		db.select({ id: person.id, name: person.name }).from(person).orderBy(person.name),
		tripReadiness({
			members: trip.members,
			destinations: trip.destinations,
			returnsOn: trip.endsOn
		})
	]);
	const hues = personHues(people.map((p) => p.id));

	return {
		readiness,
		visaCaption: visaCaption(),
		trip: {
			...trip,
			destinations: trip.destinations.map((destination) => ({
				...destination,
				label: destinationLabel(destination, countryName)
			}))
		},
		people: people.map((p) => ({ ...p, hue: hues.get(p.id) ?? '--fg3' })),
		bookingKinds: ENUMS['booking.kind']
	};
};

/** Every action here works on the trip in the URL, never one named in the form. */
const tripId = (params: { id: string }): string => asRowId(params.id);

/**
 * Save a confirmation and hook it to a booking. Returns a message on refusal.
 *
 * `saveUploadBytes` refuses anything that is not a PDF or an image, by
 * throwing. Caught so that picking the wrong file is a sentence saying so
 * rather than a 500 page: the household did nothing wrong, it chose a .docx.
 */
async function attachFile(file: File, bookingId: string, trip: string): Promise<string | null> {
	let saved: { storedName: string; contentHash: string };
	try {
		saved = await saveUploadAndHash(file);
	} catch (cause) {
		return cause instanceof Error ? cause.message : 'That file cannot be attached.';
	}
	await attachBookingFile({
		bookingId,
		tripId: trip,
		name: file.name.replace(/\.[^.]+$/, '') || 'Confirmation',
		storedName: saved.storedName,
		contentHash: saved.contentHash,
		ext: (file.name.split('.').pop() ?? 'PDF').toUpperCase()
	});
	return null;
}

export const actions: Actions = {
	edit: async ({ request, params }) => {
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const startsOn = String(form.get('startsOn') ?? '');
		const endsOn = String(form.get('endsOn') ?? '');
		const country = String(form.get('country') ?? '')
			.toUpperCase()
			.trim();

		if (!name) return fail(400, { on: 'edit', message: 'A trip needs a name.' });
		if (!startsOn || !endsOn) return fail(400, { on: 'edit', message: 'A trip needs both dates.' });
		if (endsOn < startsOn) {
			return fail(400, { on: 'edit', message: 'A trip cannot end before it starts.' });
		}
		if (!/^[A-Z]{2}$/.test(country)) {
			return fail(400, { on: 'edit', message: 'Where is it going? Two letters, like PT.' });
		}

		await updateTrip(tripId(params), {
			name,
			emoji: String(form.get('emoji') ?? ''),
			startsOn,
			endsOn,
			destinations: [
				{
					country,
					region: String(form.get('region') ?? '').trim() || null,
					city: String(form.get('city') ?? '').trim() || null
				}
			],
			members: form.getAll('member').map(String).filter(Boolean)
		});
		return { edited: true };
	},

	addBooking: async ({ request, params }) => {
		const form = await request.formData();
		const title = String(form.get('title') ?? '').trim();
		const kind = String(form.get('kind') ?? '');
		const startsOn = String(form.get('startsOn') ?? '');

		if (!title) return fail(400, { on: 'booking', message: 'What is it?' });
		if (!isEnumValue('booking.kind', kind)) {
			return fail(400, { on: 'booking', message: 'Pick what kind of booking it is.' });
		}
		if (!startsOn) return fail(400, { on: 'booking', message: 'A booking needs a day.' });

		const endsOn = String(form.get('endsOn') ?? '');
		if (endsOn && endsOn < startsOn) {
			return fail(400, { on: 'booking', message: 'A stay cannot end before it starts.' });
		}

		const bookingId = await addBooking({
			tripId: tripId(params),
			kind,
			title,
			startsOn,
			startsAt: String(form.get('startsAt') ?? ''),
			endsOn: endsOn || null,
			reference: String(form.get('reference') ?? '').trim()
		});

		// The confirmation, when one came with it. Optional: a booking somebody
		// was told about on the phone has no paper, and refusing to record it
		// until one exists would be the app inventing a rule.
		//
		// The booking is already saved by this point, so a file the upload guard
		// refuses costs the household the attachment and not the booking.
		const file = form.get('file');
		if (file instanceof File && file.size > 0) {
			const attached = await attachFile(file, bookingId, tripId(params));
			if (attached) return fail(400, { on: 'booking-file', message: attached });
		}
		return { added: true };
	},

	/**
	 * Put a confirmation on a booking.
	 *
	 * The file lands in the archive as a real document, linked to the trip, and
	 * the booking points at it — so it is searchable with everything else the
	 * household keeps rather than hidden in a corner of the Life area.
	 */
	attachBooking: async ({ request, params }) => {
		const form = await request.formData();
		const id = asRowId(form.get('id'));
		const file = form.get('file');
		if (!id) return fail(400, { message: 'No such booking.' });
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { on: 'attach', message: 'Choose a file to attach.' });
		}

		const refused = await attachFile(file, id, tripId(params));
		if (refused) return fail(400, { on: 'attach', message: refused });
		return { attached: true };
	},

	detachBooking: async ({ request }) => {
		const form = await request.formData();
		const id = asRowId(form.get('id'));
		if (!id) return fail(400, { message: 'No such booking.' });
		await detachBookingFile(id);
		return { detached: true };
	},

	deleteBooking: async ({ request }) => {
		const form = await request.formData();
		const id = asRowId(form.get('id'));
		if (!id) return fail(400, { message: 'No such booking.' });
		await deleteBooking(id);
		return { removed: true };
	},

	addPlace: async ({ request, params }) => {
		const form = await request.formData();
		const label = String(form.get('label') ?? '').trim();
		if (!label) return fail(400, { on: 'place', message: 'What is it?' });
		await addPlace(tripId(params), label);
		return { added: true };
	},

	togglePlace: async ({ request }) => {
		const form = await request.formData();
		const id = asRowId(form.get('id'));
		if (!id) return fail(400, { message: 'No such place.' });
		await togglePlace(id);
		return { toggled: true };
	},

	deletePlace: async ({ request }) => {
		const form = await request.formData();
		const id = asRowId(form.get('id'));
		if (!id) return fail(400, { message: 'No such place.' });
		await deletePlace(id);
		return { removed: true };
	},

	saveNotes: async ({ request, params }) => {
		const form = await request.formData();
		await saveNotes(tripId(params), String(form.get('notes') ?? ''));
		return { saved: true };
	},

	delete: async ({ params }) => {
		await deleteTrip(tripId(params));
		redirect(303, '/trips');
	}
};
