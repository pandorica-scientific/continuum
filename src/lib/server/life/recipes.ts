// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Reading and writing the cookbook.
 *
 * The screens call these; no `+page.server.ts` writes SQL of its own. The
 * scaling itself is not here — it is pure arithmetic in
 * `$lib/life/cookbook/scale`, and the stored quantity is what reaches the
 * browser so the stepper can rescale without asking the server again.
 */
import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { db, type Db } from '$lib/server/db';
import {
	recipe,
	recipeCategory,
	recipeIngredient,
	recipeStep,
	recipeTag,
	recipeTagLink
} from '$lib/server/db/schema';
import { dishSvg, resolveDish, type ArtDefinition } from '$lib/life/art';

export interface CategoryView {
	id: string;
	name: string;
	emoji: string;
	/** How many recipes are on it, for the rail's count. */
	count: number;
}

export interface TagView {
	id: string;
	name: string;
	/** A `--series-*` token, so the chip's colour survives a theme switch. */
	series: string;
}

export interface RecipeCard {
	id: string;
	name: string;
	emoji: string;
	description: string;
	servings: number;
	minutes: number | null;
	categoryId: string;
	photo: string | null;
	/** The line drawing, already `currentColor`. Null if it cannot be drawn. */
	art: string | null;
	tags: TagView[];
}

const artOf = (art: unknown): string | null => {
	if (!art || typeof art !== 'object') return null;
	try {
		return dishSvg(art as ArtDefinition);
	} catch {
		// A definition an older generator wrote that this one cannot draw. The
		// card falls back to its emoji, which beats a screen that will not render.
		return null;
	}
};

/** The rail: every category, with how much is on it. */
export async function listCategories(handle: Db = db): Promise<CategoryView[]> {
	// `sortOrder` orders the result without being selected into it: a column in
	// GROUP BY may be ordered by, and the rail has no use for the number itself.
	return handle
		.select({
			id: recipeCategory.id,
			name: recipeCategory.name,
			emoji: recipeCategory.emoji,
			count: sql<number>`count(${recipe.id})::int`
		})
		.from(recipeCategory)
		.leftJoin(recipe, eq(recipe.categoryId, recipeCategory.id))
		.groupBy(recipeCategory.id)
		.orderBy(asc(recipeCategory.sortOrder), asc(recipeCategory.name));
}

/** Every tag the household has made, for the filter row. */
export async function listTags(handle: Db = db): Promise<TagView[]> {
	return handle
		.select({ id: recipeTag.id, name: recipeTag.name, series: recipeTag.series })
		.from(recipeTag)
		.orderBy(asc(recipeTag.name));
}

async function tagsByRecipe(recipeIds: string[], handle: Db): Promise<Map<string, TagView[]>> {
	if (recipeIds.length === 0) return new Map();
	const rows = await handle
		.select({
			recipeId: recipeTagLink.recipeId,
			id: recipeTag.id,
			name: recipeTag.name,
			series: recipeTag.series
		})
		.from(recipeTagLink)
		.innerJoin(recipeTag, eq(recipeTag.id, recipeTagLink.tagId))
		.where(inArray(recipeTagLink.recipeId, recipeIds))
		.orderBy(asc(recipeTag.name));

	const byRecipe = new Map<string, TagView[]>();
	for (const row of rows) {
		const list = byRecipe.get(row.recipeId) ?? [];
		list.push({ id: row.id, name: row.name, series: row.series });
		byRecipe.set(row.recipeId, list);
	}
	return byRecipe;
}

/** Every recipe, newest last — a cookbook reads in the order it was written. */
export async function listRecipes(handle: Db = db): Promise<RecipeCard[]> {
	const rows = await handle.select().from(recipe).orderBy(asc(recipe.createdAt));
	const tags = await tagsByRecipe(
		rows.map((row) => row.id),
		handle
	);

	return rows.map((row) => ({
		id: row.id,
		name: row.name,
		emoji: row.emoji,
		description: row.description,
		servings: row.servings,
		minutes: row.minutes,
		categoryId: row.categoryId,
		photo: row.photo,
		art: artOf(row.art),
		tags: tags.get(row.id) ?? []
	}));
}

export interface IngredientView {
	id: string;
	/** The STORED quantity, so the browser can rescale without asking again. */
	quantity: string | null;
	unit: string;
	name: string;
}

export interface StepView {
	id: string;
	body: string;
}

export interface RecipeDetail extends RecipeCard {
	categoryName: string;
	ingredients: IngredientView[];
	steps: StepView[];
}

export async function loadRecipe(id: string, handle: Db = db): Promise<RecipeDetail | null> {
	const [row] = await handle
		.select({
			recipe,
			categoryName: recipeCategory.name
		})
		.from(recipe)
		.innerJoin(recipeCategory, eq(recipeCategory.id, recipe.categoryId))
		.where(eq(recipe.id, id));
	if (!row) return null;

	const [tags, ingredients, steps] = await Promise.all([
		tagsByRecipe([id], handle),
		handle
			.select()
			.from(recipeIngredient)
			.where(eq(recipeIngredient.recipeId, id))
			.orderBy(asc(recipeIngredient.ordinal)),
		handle
			.select()
			.from(recipeStep)
			.where(eq(recipeStep.recipeId, id))
			.orderBy(asc(recipeStep.ordinal))
	]);

	return {
		id: row.recipe.id,
		name: row.recipe.name,
		emoji: row.recipe.emoji,
		description: row.recipe.description,
		servings: row.recipe.servings,
		minutes: row.recipe.minutes,
		categoryId: row.recipe.categoryId,
		categoryName: row.categoryName,
		photo: row.recipe.photo,
		art: artOf(row.recipe.art),
		tags: tags.get(id) ?? [],
		ingredients: ingredients.map((line) => ({
			id: line.id,
			quantity: line.quantity,
			unit: line.unit,
			name: line.name
		})),
		steps: steps.map((step) => ({ id: step.id, body: step.body }))
	};
}

// ---- Writes ----

export interface NewRecipe {
	categoryId: string;
	name: string;
	emoji: string;
	description: string;
	servings: number;
	minutes: number | null;
	tagIds: string[];
	/** `[quantity, unit, name]`, in the order they were typed. */
	ingredients: [string | null, string, string][];
	steps: string[];
}

export async function createRecipe(input: NewRecipe, handle: Db = db): Promise<string> {
	const id = uuidv7();
	await handle.transaction(async (tx) => {
		await tx.insert(recipe).values({
			id,
			categoryId: input.categoryId,
			name: input.name,
			emoji: input.emoji,
			description: input.description,
			servings: input.servings,
			minutes: input.minutes,
			// Resolved once, here, and stored — so renaming the recipe later does
			// not silently repaint it.
			art: resolveDish({
				name: input.name,
				ingredients: input.ingredients.map(([, , name]) => name)
			})
		});

		if (input.tagIds.length) {
			await tx.insert(recipeTagLink).values(input.tagIds.map((tagId) => ({ recipeId: id, tagId })));
		}
		if (input.ingredients.length) {
			await tx.insert(recipeIngredient).values(
				input.ingredients.map(([quantity, unit, name], ordinal) => ({
					id: uuidv7(),
					recipeId: id,
					ordinal,
					quantity,
					unit,
					name
				}))
			);
		}
		if (input.steps.length) {
			await tx.insert(recipeStep).values(
				input.steps.map((body, ordinal) => ({
					id: uuidv7(),
					recipeId: id,
					ordinal,
					body
				}))
			);
		}
	});
	return id;
}

/**
 * Replace a recipe's ingredients and steps wholesale.
 *
 * Both are lists the household edits as a whole — a line inserted in the middle
 * renumbers everything after it — and a merge would need a per-row identity the
 * form does not carry. The artwork is deliberately left alone.
 */
export async function updateRecipe(id: string, input: NewRecipe, handle: Db = db): Promise<void> {
	await handle.transaction(async (tx) => {
		await tx
			.update(recipe)
			.set({
				categoryId: input.categoryId,
				name: input.name,
				emoji: input.emoji,
				description: input.description,
				servings: input.servings,
				minutes: input.minutes
			})
			.where(eq(recipe.id, id));

		await tx.delete(recipeTagLink).where(eq(recipeTagLink.recipeId, id));
		if (input.tagIds.length) {
			await tx.insert(recipeTagLink).values(input.tagIds.map((tagId) => ({ recipeId: id, tagId })));
		}

		await tx.delete(recipeIngredient).where(eq(recipeIngredient.recipeId, id));
		if (input.ingredients.length) {
			await tx.insert(recipeIngredient).values(
				input.ingredients.map(([quantity, unit, name], ordinal) => ({
					id: uuidv7(),
					recipeId: id,
					ordinal,
					quantity,
					unit,
					name
				}))
			);
		}

		await tx.delete(recipeStep).where(eq(recipeStep.recipeId, id));
		if (input.steps.length) {
			await tx
				.insert(recipeStep)
				.values(
					input.steps.map((body, ordinal) => ({ id: uuidv7(), recipeId: id, ordinal, body }))
				);
		}
	});
}

export async function deleteRecipe(id: string, handle: Db = db): Promise<void> {
	await handle.delete(recipe).where(eq(recipe.id, id));
}

export async function addCategory(name: string, emoji: string, handle: Db = db): Promise<string> {
	const id = uuidv7();
	const [last] = await handle
		.select({ sortOrder: recipeCategory.sortOrder })
		.from(recipeCategory)
		.orderBy(desc(recipeCategory.sortOrder))
		.limit(1);

	await handle
		.insert(recipeCategory)
		.values({ id, name, emoji, sortOrder: (last?.sortOrder ?? -1) + 1 });
	return id;
}

/**
 * A tag, made on the way in if it is new.
 *
 * Case-insensitive, so typing "Guests" when "guests" exists finds that one
 * rather than minting a second chip in a different colour.
 */
export async function upsertTag(name: string, handle: Db = db): Promise<TagView> {
	const trimmed = name.trim();
	const [existing] = await handle
		.select({ id: recipeTag.id, name: recipeTag.name, series: recipeTag.series })
		.from(recipeTag)
		.where(sql`lower(${recipeTag.name}) = lower(${trimmed})`)
		.limit(1);
	if (existing) return existing;

	// The reserve series slots, handed out in order. Not the named ones:
	// `--series-income` means income on a cash-flow chart, and a tag borrowing
	// it would be the one place a series colour means two things.
	const [{ count }] = await handle.select({ count: sql<number>`count(*)::int` }).from(recipeTag);
	const series = `series-r${(count % 10) + 1}`;

	const id = uuidv7();
	await handle.insert(recipeTag).values({ id, name: trimmed, series });
	return { id, name: trimmed, series };
}
