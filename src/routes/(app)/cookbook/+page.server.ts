// SPDX-License-Identifier: AGPL-3.0-or-later
import { fail, redirect } from '@sveltejs/kit';
import { asRowId } from '$lib/ids';
import {
	addCategory,
	createRecipe,
	listCategories,
	listRecipes,
	listTags,
	upsertTag
} from '$lib/server/life/recipes';
import { clampServings } from '$lib/life/cookbook/scale';
import { linesFrom, tagNamesFrom } from '$lib/server/life/recipe-form';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [categories, recipes, tags] = await Promise.all([
		listCategories(),
		listRecipes(),
		listTags()
	]);
	return { categories, recipes, tags };
};

export const actions: Actions = {
	newRecipe: async ({ request }) => {
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
		// Tags are made on the way in, so typing a new one is not a second errand.
		const tagIds = await Promise.all(
			tagNamesFrom(form).map(async (tag) => (await upsertTag(tag)).id)
		);

		const id = await createRecipe({
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

		redirect(303, `/cookbook/${id}`);
	},

	newCategory: async ({ request }) => {
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (!name) return fail(400, { on: 'category', message: 'A shelf needs a name.' });
		await addCategory(name, String(form.get('emoji') ?? '🍽️'));
		return { added: true };
	}
};
