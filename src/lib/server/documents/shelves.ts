// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/**
 * The only place a shelf key becomes a UUID.
 *
 * Domain code used to write `shelf: 'payslips'` in four places, which meant the
 * set of shelves was a code enum three modules could disagree about — and did.
 * Now shelves are rows a household owns, so `payslips` may not exist, and the
 * salary tracker has no business knowing that. It asks for `finance` and files
 * a document of `type='payslip'`; behaviour hangs off type, never off shelf.
 *
 * Unknown keys THROW. A fallback to inbox would file a payslip somewhere nobody
 * looks and nothing would say so; a key this repo asks for and the database does
 * not have is a defect in this repo.
 */
import { count, eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { db, type Db, type Queryable } from '$lib/server/db';
import { document, shelf } from '$lib/server/db/schema';

export interface ShelfRow {
	id: string;
	key: string;
	label: string;
	emoji: string;
	sortOrder: number;
	system: boolean;
}

export async function shelfIdByKey(key: string, handle: Queryable = db): Promise<string> {
	const [row] = await handle
		.select({ id: shelf.id })
		.from(shelf)
		.where(eq(shelf.key, key))
		.limit(1);
	if (!row) throw new Error(`No shelf with key "${key}".`);
	return row.id;
}

/** `inbox` and `statements` — the two rows the application refers to by name. */
export async function systemShelfId(
	key: 'inbox' | 'statements',
	handle: Queryable = db
): Promise<string> {
	return shelfIdByKey(key, handle);
}

export async function listShelves(handle: Queryable = db): Promise<ShelfRow[]> {
	return handle
		.select({
			id: shelf.id,
			key: shelf.key,
			label: shelf.label,
			emoji: shelf.emoji,
			sortOrder: shelf.sortOrder,
			system: shelf.system
		})
		.from(shelf)
		.orderBy(shelf.sortOrder, shelf.label);
}

/**
 * Rename a shelf, or give it a different emoji.
 *
 * The KEY is never touched: it is what code refers to, and a system shelf whose
 * key moved would silently unhook capture or statement filing. The label is the
 * household's — "K vyřízení" is a perfectly good name for the inbox.
 */
export async function renameShelf(
	id: string,
	changes: { label?: string; emoji?: string },
	handle: Queryable = db
): Promise<void> {
	const label = changes.label?.trim();
	await handle
		.update(shelf)
		.set({
			...(label ? { label } : {}),
			...(changes.emoji !== undefined ? { emoji: changes.emoji.trim() || '🗂️' } : {})
		})
		.where(eq(shelf.id, id));
}

/** Put the shelves in the order the household dragged them into. */
export async function reorderShelves(order: string[], handle: Queryable = db): Promise<void> {
	for (const [index, id] of order.entries()) {
		await handle
			.update(shelf)
			.set({ sortOrder: index * 10 })
			.where(eq(shelf.id, id));
	}
}

/** A new shelf, keyed by a slug derived from its label. */
export async function addShelf(
	label: string,
	emoji: string,
	handle: Queryable = db
): Promise<string> {
	const trimmed = label.trim();
	if (!trimmed) throw new Error('A shelf needs a name.');
	// The key is derived once and then immutable, exactly like a category's:
	// renaming the shelf later must not change what code refers to.
	const base =
		trimmed
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '') || 'shelf';
	const taken = new Set((await listShelves(handle)).map((s) => s.key));
	let key = base;
	for (let n = 2; taken.has(key); n++) key = `${base}-${n}`;

	const [{ next }] = await handle
		.select({ next: sql<number>`coalesce(max(${shelf.sortOrder}), 0) + 10` })
		.from(shelf);
	const id = uuidv7();
	await handle
		.insert(shelf)
		.values({ id, key, label: trimmed, emoji: emoji.trim() || '🗂️', sortOrder: next });
	return id;
}

/** How much paper is on a shelf — the number the delete dialog has to say. */
export async function documentsOnShelf(id: string, handle: Queryable = db): Promise<number> {
	const [row] = await handle.select({ n: count() }).from(document).where(eq(document.shelfId, id));
	return row?.n ?? 0;
}

/**
 * Move everything off a shelf and then delete it, or do neither.
 *
 * The only legal delete. `ON DELETE RESTRICT` on `document.shelf_id` is what
 * makes that "always" rather than "in the UI" — a delete that skipped the move
 * is refused by the database, not by a screen.
 *
 * A system shelf is refused outright: `inbox` and `statements` are referred to
 * by key from code, and a household that deleted the inbox would have capture
 * fail on the next upload.
 */
export async function reassignAndDelete(
	id: string,
	reassignTo: string,
	handle: Db = db
): Promise<void> {
	if (id === reassignTo) throw new Error('A shelf cannot be moved onto itself.');
	await handle.transaction(async (tx) => {
		const [row] = await tx
			.select({ system: shelf.system })
			.from(shelf)
			.where(eq(shelf.id, id))
			.limit(1);
		if (!row) throw new Error('That shelf is no longer there.');
		if (row.system) throw new Error('A system shelf cannot be deleted.');

		const [target] = await tx
			.select({ id: shelf.id })
			.from(shelf)
			.where(eq(shelf.id, reassignTo))
			.limit(1);
		if (!target) throw new Error('Pick a shelf to move them to.');

		await tx.update(document).set({ shelfId: reassignTo }).where(eq(document.shelfId, id));
		await tx.delete(shelf).where(eq(shelf.id, id));
	});
}
