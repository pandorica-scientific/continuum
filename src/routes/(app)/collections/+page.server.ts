// SPDX-License-Identifier: AGPL-3.0-or-later
import { fail, redirect } from '@sveltejs/kit';
import { asRowId } from '$lib/ids';
import { bottleFrom } from '$lib/server/life/bottle-form';
import { getBaseCurrency } from '$lib/server/settings';
import {
	CELLAR_KEY,
	createBottle,
	listBottles,
	listShelves,
	openedThisYear
} from '$lib/server/life/cellar';
import { openTonight, type Candidate } from '$lib/life/collections/open-tonight';
import { drinkPhase } from '$lib/life/collections/drink-by';
import { localToday, monthsBetween } from '$lib/dates';
import { db } from '$lib/server/db';
import { tasting } from '$lib/server/db/schema';
import { inArray, max } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const today = localToday();
	const year = Number(today.slice(0, 4));

	const [shelves, baseCurrency] = await Promise.all([listShelves(), getBaseCurrency()]);
	const cellarId = shelves.find((shelf) => shelf.key === CELLAR_KEY)?.id ?? shelves[0]?.id ?? null;

	if (!cellarId) {
		return {
			shelves,
			cellarId: null,
			bottles: [],
			suggestions: [],
			openedThisYear: 0,
			readyNow: 0,
			baseCurrency,
			year
		};
	}

	const [bottles, opened] = await Promise.all([
		listBottles(cellarId, year),
		openedThisYear(cellarId, year)
	]);

	// The last tasting per bottle, for the "left alone" suggestion. One query,
	// not one per bottle: a cellar grows to fifty rows without anybody noticing.
	const lastTasted = new Map<string, string>();
	if (bottles.length) {
		const rows = await db
			.select({ bottleId: tasting.bottleId, last: max(tasting.tastedOn) })
			.from(tasting)
			.where(
				inArray(
					tasting.bottleId,
					bottles.map((one) => one.id)
				)
			)
			.groupBy(tasting.bottleId);
		for (const row of rows) if (row.last) lastTasted.set(row.bottleId, row.last);
	}

	const candidates: Candidate[] = bottles.map((one) => {
		const last = lastTasted.get(one.id);
		return {
			id: one.id,
			producer: one.producer,
			name: one.name,
			owned: one.owned,
			opened: one.opened,
			score: one.score,
			drinkFrom: one.drinkFrom,
			drinkTo: one.drinkTo,
			monthsSinceTasted: last ? monthsBetween(last, today) : null
		};
	});

	return {
		shelves,
		cellarId,
		bottles,
		openedThisYear: opened,
		// Counted here rather than in the component: the tile and the grid must
		// agree, and two places counting the same thing is how they stop agreeing.
		readyNow: bottles.filter(
			(one) => one.owned - one.opened > 0 && ['drink-soon', 'past'].includes(drinkPhase(one, year))
		).length,
		suggestions: openTonight(candidates, year),
		baseCurrency,
		year
	};
};

export const actions: Actions = {
	newBottle: async ({ request }) => {
		const form = await request.formData();
		const collectionId = asRowId(form.get('collectionId'));
		if (!collectionId) return fail(400, { on: 'bottle', message: 'No shelf to put it on.' });

		const read = bottleFrom(form, 1);
		if ('message' in read) return fail(400, { on: 'bottle', message: read.message });

		const id = await createBottle({
			collectionId,
			...read.fields,
			// Nothing is open the moment it is written down. Opening one is its
			// own control, and logging a tasting is what actually opens a bottle.
			opened: 0
		});

		redirect(303, `/collections/bottles/${id}`);
	}
};
