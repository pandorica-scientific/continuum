// SPDX-License-Identifier: AGPL-3.0-or-later
import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { asOptionalRowId, asRowId } from '$lib/ids';
import { db } from '$lib/server/db';
import { person, tripIdea, tripIdeaHeart } from '$lib/server/db/schema';
import { createTrip, ideaExists, removeIdea } from '$lib/server/life/trips';
import type { Actions, PageServerLoad } from './$types';

/** A trip promoted from an idea arrives with the idea's id in the query and pre-fills from it. */
export const load: PageServerLoad = async ({ url }) => {
	const ideaId = asRowId(url.searchParams.get('idea'));

	const people = await db
		.select({ id: person.id, name: person.name })
		.from(person)
		.orderBy(person.name);

	if (!ideaId) return { idea: null, people };

	const [idea] = await db.select().from(tripIdea).where(eq(tripIdea.id, ideaId));
	if (!idea) return { idea: null, people };

	const hearts = await db
		.select({ personId: tripIdeaHeart.personId })
		.from(tripIdeaHeart)
		.where(eq(tripIdeaHeart.ideaId, ideaId));

	return {
		idea: {
			id: idea.id,
			name: idea.name,
			emoji: idea.emoji,
			country: idea.country ?? '',
			// Whoever wanted to go is who is going, until somebody says otherwise.
			members: hearts.map((heart) => heart.personId)
		},
		people
	};
};

export const actions: Actions = {
	default: async ({ request }) => {
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const startsOn = String(form.get('startsOn') ?? '');
		const endsOn = String(form.get('endsOn') ?? '');
		const country = String(form.get('country') ?? '')
			.toUpperCase()
			.trim();

		const entered = {
			name,
			emoji: String(form.get('emoji') ?? ''),
			startsOn,
			endsOn,
			country,
			region: String(form.get('region') ?? '').trim(),
			city: String(form.get('city') ?? '').trim(),
			members: form.getAll('member').map(String)
		};

		if (!name) return fail(400, { message: 'A trip needs a name.', entered });
		if (!startsOn || !endsOn) return fail(400, { message: 'A trip needs both dates.', entered });
		if (endsOn < startsOn) {
			return fail(400, { message: 'A trip cannot end before it starts.', entered });
		}
		if (!/^[A-Z]{2}$/.test(country)) {
			return fail(400, { message: 'Where is it going? Two letters, like PT.', entered });
		}

		// `asOptionalRowId`, not the required variant — that turns an absent field into
		// the nil uuid, a real value no idea has, and the foreign key rejects it with a 500.
		const fromIdeaId = (await ideaExists(asOptionalRowId(form.get('fromIdeaId'))))
			? asOptionalRowId(form.get('fromIdeaId'))!
			: null;
		const id = await createTrip({
			name,
			emoji: entered.emoji,
			startsOn,
			endsOn,
			notes: '',
			destinations: [{ country, region: entered.region || null, city: entered.city || null }],
			members: entered.members.filter(Boolean),
			fromIdeaId
		});

		// Promoting an idea takes it off the board — it's the same plan now, not a duplicate.
		if (fromIdeaId) await removeIdea(fromIdeaId);

		redirect(303, `/trips/${id}`);
	}
};
