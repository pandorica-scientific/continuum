// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/**
 * Settings → Shelves: rename, reorder, add, and reassign-then-delete.
 *
 * Deleting a shelf is never a delete. `ON DELETE RESTRICT` on
 * `document.shelf_id` refuses one that still holds paper, so the dialog's
 * "move them to" is the mechanism rather than a courtesy.
 */
import { count, eq } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { document } from '$lib/server/db/schema';
import {
	addShelf,
	listShelves,
	reassignAndDelete,
	renameShelf,
	reorderShelves
} from '$lib/server/documents/shelves';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [shelves, counts] = await Promise.all([
		listShelves(),
		db.select({ shelfId: document.shelfId, n: count() }).from(document).groupBy(document.shelfId)
	]);
	// Deliberately NOT filtered by visibility: this is an admin surface about
	// where paper lives, and a delete dialog that under-reported how much has to
	// move would move it anyway and surprise someone.
	const byShelf = new Map(counts.map((c) => [c.shelfId, c.n]));
	return {
		shelves: shelves.map((s) => ({ ...s, count: byShelf.get(s.id) ?? 0 }))
	};
};

export const actions: Actions = {
	rename: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const label = String(form.get('label') ?? '').trim();
		if (!id || !label) return fail(400, { message: 'A shelf needs a name.' });
		await renameShelf(id, { label, emoji: String(form.get('emoji') ?? '') }, db);
		return { ok: true };
	},

	add: async ({ request }) => {
		const form = await request.formData();
		try {
			await addShelf(String(form.get('label') ?? ''), String(form.get('emoji') ?? '🗂️'), db);
		} catch (error) {
			return fail(400, { message: error instanceof Error ? error.message : 'Could not add it.' });
		}
		return { ok: true };
	},

	reorder: async ({ request }) => {
		const form = await request.formData();
		const order = String(form.get('order') ?? '')
			.split(',')
			.filter(Boolean);
		if (order.length === 0) return fail(400, { message: 'Nothing to reorder.' });
		await reorderShelves(order, db);
		return { ok: true };
	},

	remove: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const reassignTo = String(form.get('reassignTo') ?? '');
		try {
			await reassignAndDelete(id, reassignTo, db);
		} catch (error) {
			return fail(400, {
				message: error instanceof Error ? error.message : 'Could not delete that shelf.'
			});
		}
		return { ok: true };
	},

	/** A count for the delete dialog, so it can say how much has to move. */
	count: async ({ request }) => {
		const form = await request.formData();
		const [row] = await db
			.select({ n: count() })
			.from(document)
			.where(eq(document.shelfId, String(form.get('id') ?? '')));
		return { ok: true, count: row?.n ?? 0 };
	}
};
