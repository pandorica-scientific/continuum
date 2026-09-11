// SPDX-License-Identifier: AGPL-3.0-or-later
import { error, fail, redirect } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { asOptionalRowId, asRowId } from '$lib/ids';
import { db } from '$lib/server/db';
import { bottle, person, tastingNote } from '$lib/server/db/schema';
import { saveUpload } from '$lib/server/system/files';
import { bottleFrom, optionalInt } from '$lib/server/life/bottle-form';
import { getBaseCurrency } from '$lib/server/settings';
import { localToday } from '$lib/dates';
import { add, openOne, remove } from '$lib/life/collections/ownership';
import {
	currentCounts,
	deleteBottle,
	deleteTasting,
	loadBottle,
	logTasting,
	setCounts,
	updateBottle
} from '$lib/server/life/cellar';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const id = asRowId(params.id);
	if (!id) error(404, 'No such bottle');

	const today = localToday();
	const [found, people, flavours, baseCurrency] = await Promise.all([
		loadBottle(id, Number(today.slice(0, 4))),
		db.select({ id: person.id, name: person.name }).from(person).orderBy(asc(person.name)),
		// Every flavour word the cellar has ever used, so typing one that exists
		// finds it rather than minting a second chip for the same taste.
		db.selectDistinct({ note: tastingNote.note }).from(tastingNote).orderBy(asc(tastingNote.note)),
		getBaseCurrency()
	]);
	if (!found) error(404, 'No such bottle');

	return {
		bottle: found,
		people,
		today,
		baseCurrency,
		knownFlavours: flavours.map((row) => row.note)
	};
};

/**
 * Put an uploaded picture on the data volume.
 *
 * Shared by the two upload actions, which differ only in the field they read and
 * the column they write. `saveUpload` refuses anything that is not a picture or
 * a PDF, and it throws to say so — caught here so a wrong file is a message
 * rather than a 500.
 */
async function storeUpload(
	file: FormDataEntryValue | null
): Promise<{ name: string } | { message: string }> {
	if (!(file instanceof File) || file.size === 0) return { message: 'Choose a photograph.' };
	try {
		return { name: await saveUpload(file) };
	} catch (cause) {
		return { message: cause instanceof Error ? cause.message : 'That file cannot be used.' };
	}
}

/** Flavour words, de-duplicated case-insensitively so "Plum, plum" is one. */
function flavoursFrom(form: FormData): string[] {
	const seen = new Set<string>();
	const words: string[] = [];
	for (const field of form.getAll('flavours').map(String)) {
		for (const raw of field.split(',')) {
			const word = raw.trim();
			if (!word) continue;
			const key = word.toLowerCase();
			if (seen.has(key)) continue;
			seen.add(key);
			words.push(word);
		}
	}
	return words;
}

export const actions: Actions = {
	/**
	 * One of the three ownership controls.
	 *
	 * The browser posts which control was pressed; the rule that turns that into
	 * a new pair lives in `ownership.ts` and runs here. Posting the new numbers
	 * instead would put a second implementation of `opened <= owned` in a place
	 * nothing tests.
	 */
	count: async ({ request, params }) => {
		const id = asRowId(params.id);
		const form = await request.formData();
		const move = String(form.get('move') ?? '');

		const counts = await currentCounts(id);
		if (!counts) return fail(404, { on: 'count', message: 'No such bottle.' });

		const next =
			move === 'add'
				? add(counts)
				: move === 'remove'
					? remove(counts)
					: move === 'open'
						? openOne(counts)
						: null;
		if (!next) return fail(400, { on: 'count', message: 'Nothing to do.' });

		await setCounts(id, next);
		return { counted: true };
	},

	logTasting: async ({ request, params }) => {
		const id = asRowId(params.id);
		const form = await request.formData();
		const tastedOn = String(form.get('tastedOn') ?? '').trim();
		if (!tastedOn) return fail(400, { on: 'tasting', message: 'When was it opened?' });

		const counts = await currentCounts(id);
		if (!counts) return fail(404, { on: 'tasting', message: 'No such bottle.' });

		const score = optionalInt(form.get('score'));
		await logTasting(
			{
				bottleId: id,
				tastedOn,
				personId: asOptionalRowId(form.get('personId')) ?? null,
				// A score outside the scale is a typo, not an opinion.
				score: score === null ? null : Math.min(100, Math.max(0, score)),
				note: String(form.get('note') ?? '').trim(),
				flavours: flavoursFrom(form)
			},
			// Tasting a bottle opens it — up to what is owned, which is the rule.
			openOne(counts)
		);
		return { logged: true };
	},

	deleteTasting: async ({ request }) => {
		const form = await request.formData();
		const tastingId = asRowId(form.get('tastingId'));
		if (!tastingId) return fail(400, { on: 'tasting', message: 'No such tasting.' });
		// The open count is deliberately left alone: deleting the note somebody
		// wrote does not put the cork back in.
		await deleteTasting(tastingId);
		return { removed: true };
	},

	edit: async ({ request, params }) => {
		const id = asRowId(params.id);
		const form = await request.formData();

		const counts = await currentCounts(id);
		if (!counts) return fail(404, { on: 'bottle', message: 'No such bottle.' });

		const read = bottleFrom(form, counts.owned);
		if ('message' in read) return fail(400, { on: 'bottle', message: read.message });

		await updateBottle(id, {
			...read.fields,
			// Lowering how many are owned cannot leave more open than exist — the
			// CHECK would refuse it, and refusing an edit over a number the form
			// does not show would be unexplainable.
			opened: Math.min(counts.opened, read.fields.owned)
		});
		return { edited: true };
	},

	/**
	 * One photograph of the bottle, kept twice.
	 *
	 * The crop the household dragged the corners onto goes on the label plate,
	 * which is what every card in the cellar draws. The whole frame it came out
	 * of goes on this page. Same picture, two jobs — so nobody photographs the
	 * same bottle twice, and the page never shows two bottles.
	 *
	 * The uncropped file is optional: a photograph that arrived without the
	 * editor has no separate original, and then the one file is both.
	 */
	photo: async ({ request, params }) => {
		const id = asRowId(params.id);
		const form = await request.formData();

		const cropped = await storeUpload(form.get('photo'));
		if ('message' in cropped) return fail(400, { on: 'photo', message: cropped.message });

		const whole = await storeUpload(form.get('photoOriginal'));

		await db
			.update(bottle)
			.set({
				labelPhoto: cropped.name,
				photo: 'name' in whole ? whole.name : cropped.name
			})
			.where(eq(bottle.id, id));
		return { photographed: true };
	},

	/** Both of them: they are one photograph and they go together. */
	removePhoto: async ({ params }) => {
		await db
			.update(bottle)
			.set({ photo: null, labelPhoto: null })
			.where(eq(bottle.id, asRowId(params.id)));
		return { removed: true };
	},

	delete: async ({ params }) => {
		await deleteBottle(asRowId(params.id));
		redirect(303, '/collections');
	}
};
