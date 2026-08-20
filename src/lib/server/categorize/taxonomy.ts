// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/**
 * Creating, renaming and deleting the category tree a household owns.
 *
 * The tree used to be a constant: seven groups and seventeen leaves chosen by
 * whoever wrote the file. A household with a pharmacy bill, or one that does
 * not drive, had no way to say so.
 */

import { count, eq } from 'drizzle-orm';
import { db, type Db } from '$lib/server/db';
import {
	category,
	categoryGroup,
	rule,
	transaction,
	transactionSplit
} from '$lib/server/db/schema';
import { isEnumValue, type EnumValue } from '$lib/enums';
import { CATEGORY_GROUP_SEED, RESERVE_COLOR_TOKENS, nextFreeColorToken } from '$lib/categories';

export type TaxonomyResult = { ok: true } | { ok: false; status: 400 | 404 | 409; message: string };

/**
 * A stable key for a name somebody typed.
 *
 * Keys are what categories point at and what rules are stored against, so they
 * are derived once at creation and never rewritten when a label is edited.
 */
export function taxonomyKey(label: string): string {
	return label
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

/** Every colour token the palette defines: the nine named, then the reserve. */
const PALETTE_TOKENS = [
	...CATEGORY_GROUP_SEED.map((group) => group.colorToken),
	...RESERVE_COLOR_TOKENS
];

interface CreateGroupInput {
	label: string;
	role: EnumValue<'category_group.role'>;
}

export async function createCategoryGroup(
	input: CreateGroupInput,
	handle: Db = db
): Promise<TaxonomyResult> {
	const label = input.label.trim();
	if (!label) return { ok: false, status: 400, message: 'The group needs a name.' };
	if (!isEnumValue('category_group.role', input.role)) {
		return {
			ok: false,
			status: 400,
			message: 'Choose whether this is income, spending or saving.'
		};
	}
	const key = taxonomyKey(label);
	if (!key) return { ok: false, status: 400, message: 'That name has no letters or digits in it.' };

	return handle.transaction(async (tx) => {
		const existing = await tx.select().from(categoryGroup);
		if (existing.some((group) => group.key === key)) {
			return { ok: false as const, status: 409, message: 'A group by that name already exists.' };
		}

		// Reserve colours are ranked by how well they separate from everything
		// else, so handing them out in order means the first group a household
		// adds gets the most legible one left rather than an arbitrary spare.
		const colorToken = nextFreeColorToken(existing.map((group) => group.colorToken));
		if (!colorToken) {
			return {
				ok: false as const,
				status: 409,
				// Honest about why, because the alternative — generating a colour —
				// produces two series nobody can tell apart and looks like a bug.
				message: 'Every distinct chart colour is in use. Rename or remove a group to free one.'
			};
		}

		const sort = existing.reduce((highest, group) => Math.max(highest, group.sort), 0) + 1;
		await tx.insert(categoryGroup).values({ key, label, colorToken, role: input.role, sort });
		return { ok: true as const };
	});
}

interface RenameGroupInput {
	label: string;
	colorToken: string;
}

/** Label and colour only. The key is what categories point at and never moves. */
export async function renameCategoryGroup(
	key: string,
	input: RenameGroupInput,
	handle: Db = db
): Promise<TaxonomyResult> {
	const label = input.label.trim();
	if (!label) return { ok: false, status: 400, message: 'The group needs a name.' };
	if (!PALETTE_TOKENS.includes(input.colorToken)) {
		// Never a free hex: each token carries a value per theme and the set was
		// validated for separation. An arbitrary colour is illegible in one theme
		// or indistinguishable from its neighbour in both.
		return { ok: false, status: 400, message: 'Choose a colour from the palette.' };
	}

	const [existing] = await handle.select().from(categoryGroup).where(eq(categoryGroup.key, key));
	if (!existing) return { ok: false, status: 404, message: 'Group not found.' };

	await handle
		.update(categoryGroup)
		.set({ label, colorToken: input.colorToken })
		.where(eq(categoryGroup.key, key));
	return { ok: true };
}

/**
 * Delete a group, which must already be empty.
 *
 * Nothing is privileged: a seeded group goes the same way a household's own
 * does, because a household that does not drive should be able to delete
 * Transport.
 */
export async function deleteCategoryGroup(key: string, handle: Db = db): Promise<TaxonomyResult> {
	return handle.transaction(async (tx) => {
		const [existing] = await tx
			.select()
			.from(categoryGroup)
			.where(eq(categoryGroup.key, key))
			.for('update');
		if (!existing) return { ok: false as const, status: 404, message: 'Group not found.' };

		const [{ value }] = await tx
			.select({ value: count() })
			.from(category)
			.where(eq(category.groupKey, key));
		if (value > 0) {
			return { ok: false as const, status: 409, message: 'Move or delete its categories first.' };
		}

		await tx.delete(categoryGroup).where(eq(categoryGroup.key, key));
		return { ok: true as const };
	});
}

interface CreateCategoryInput {
	groupKey: string;
	name: string;
}

export async function createCategory(
	input: CreateCategoryInput,
	handle: Db = db
): Promise<TaxonomyResult> {
	const name = input.name.trim();
	if (!name) return { ok: false, status: 400, message: 'The category needs a name.' };
	const id = taxonomyKey(name);
	if (!id) return { ok: false, status: 400, message: 'That name has no letters or digits in it.' };

	return handle.transaction(async (tx) => {
		const [group] = await tx
			.select()
			.from(categoryGroup)
			.where(eq(categoryGroup.key, input.groupKey));
		if (!group) return { ok: false as const, status: 404, message: 'Group not found.' };

		const siblings = await tx.select().from(category).where(eq(category.groupKey, input.groupKey));
		const [clash] = await tx.select().from(category).where(eq(category.id, id));
		if (clash) {
			return {
				ok: false as const,
				status: 409,
				message: 'A category by that name already exists.'
			};
		}

		const sort = siblings.reduce((highest, row) => Math.max(highest, row.sort), -1) + 1;
		await tx.insert(category).values({ id, groupKey: input.groupKey, name, sort });
		return { ok: true as const };
	});
}

/**
 * Delete a category, moving everything filed under it somewhere else.
 *
 * `reassignTo` is required rather than optional. Orphaning the rows would drop
 * them out of every total that filters on a category, which reads as money
 * vanishing — and the person deleting the category is the only one who knows
 * where its history belongs.
 */
export async function deleteCategory(
	id: string,
	reassignTo: string,
	handle: Db = db
): Promise<TaxonomyResult> {
	if (id === reassignTo) {
		return { ok: false, status: 400, message: 'Choose a different category to move them to.' };
	}

	return handle.transaction(async (tx) => {
		const [existing] = await tx.select().from(category).where(eq(category.id, id)).for('update');
		if (!existing) return { ok: false as const, status: 404, message: 'Category not found.' };

		const [target] = await tx.select().from(category).where(eq(category.id, reassignTo));
		if (!target) {
			return { ok: false as const, status: 404, message: 'That category is not there any more.' };
		}

		// Both places a category id is stored on money. A split line carries its
		// own, so updating only the transaction would leave half the ledger
		// pointing at a row that is about to disappear.
		await tx
			.update(transaction)
			.set({ categoryId: reassignTo })
			.where(eq(transaction.categoryId, id));
		await tx
			.update(transaction)
			.set({ suggestedCategoryId: reassignTo })
			.where(eq(transaction.suggestedCategoryId, id));
		await tx
			.update(transactionSplit)
			.set({ categoryId: reassignTo })
			.where(eq(transactionSplit.categoryId, id));
		// Rules too. The foreign key sets them to null on delete, which leaves a
		// learned rule that still matches and files nothing — the categoriser
		// quietly stops working and nothing says why.
		await tx.update(rule).set({ categoryId: reassignTo }).where(eq(rule.categoryId, id));

		await tx.delete(category).where(eq(category.id, id));
		return { ok: true as const };
	});
}
