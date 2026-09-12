// SPDX-License-Identifier: AGPL-3.0-or-later
import { error, fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { asRowId } from '$lib/ids';
import { db } from '$lib/server/db';
import { recipe } from '$lib/server/db/schema';
import { saveUpload } from '$lib/server/system/files';
import {
	deleteRecipe,
	listCategories,
	listTags,
	loadRecipe,
	updateRecipe,
	upsertTag
} from '$lib/server/life/recipes';
import { clampServings } from '$lib/life/cookbook/scale';
import { linesFrom, tagNamesFrom } from '$lib/server/life/recipe-form';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const id = asRowId(params.id);
	if (!id) error(404, 'No such recipe');

	const [found, categories, tags] = await Promise.all([
		loadRecipe(id),
		listCategories(),
		listTags()
	]);
	if (!found) error(404, 'No such recipe');

	return { recipe: found, categories, tags };
};

export const actions: Actions = {
	edit: async ({ request, params }) => {
		const id = asRowId(params.id);
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const categoryId = asRowId(form.get('categoryId'));

		if (!name) return fail(400, { on: 'recipe', message: 'A recipe needs a name.' });
		if (!categoryId) return fail(400, { on: 'recipe', message: 'Pick which shelf it goes on.' });

		const { ingredients, steps } = linesFrom(form);
		if (ingredients.length === 0) {
			return fail(400, { on: 'recipe', message: 'A recipe needs at least one ingredient.' });
		}

		const minutes = Number(form.get('minutes'));
		const tagIds = await Promise.all(
			tagNamesFrom(form).map(async (tag) => (await upsertTag(tag)).id)
		);

		await updateRecipe(id, {
			categoryId,
			name,
			emoji: String(form.get('emoji') ?? ''),
			description: String(form.get('description') ?? '').trim(),
			servings: clampServings(Number(form.get('servings')) || 2),
			minutes: Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : null,
			tagIds,
			ingredients,
			steps
		});
		return { edited: true };
	},

	/**
	 * The photograph of the finished dish, taken by whoever cooked it.
	 *
	 * Stored on the data volume beside the property photos rather than filed as
	 * a document: it is a picture of dinner, not paper, and putting it in the
	 * archive would be one more thing in a search for a receipt.
	 */
	photo: async ({ request, params }) => {
		const id = asRowId(params.id);
		const form = await request.formData();
		const file = form.get('photo');
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { on: 'photo', message: 'Choose a photograph.' });
		}

		let storedName: string;
		try {
			storedName = await saveUpload(file);
		} catch (cause) {
			return fail(400, {
				on: 'photo',
				message: cause instanceof Error ? cause.message : 'That file cannot be used.'
			});
		}

		await db.update(recipe).set({ photo: storedName }).where(eq(recipe.id, id));
		return { photographed: true };
	},

	removePhoto: async ({ params }) => {
		await db
			.update(recipe)
			.set({ photo: null })
			.where(eq(recipe.id, asRowId(params.id)));
		return { removed: true };
	},

	delete: async ({ params }) => {
		await deleteRecipe(asRowId(params.id));
		redirect(303, '/cookbook');
	}
};
