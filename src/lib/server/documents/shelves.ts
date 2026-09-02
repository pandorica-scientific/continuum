// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The only place a shelf key becomes a UUID.
 *
 * Domain code used to write `shelf: 'payslips'` in four places, which meant the
 * set of shelves was a code enum three modules could disagree about — and did.
 * Now shelves are rows a household owns, so `payslips` may not exist, and the
 * salary tracker has no business knowing that. It asks for the Income & Tax key
 * from `SYSTEM_SHELF_KEYS` and files a document of `type='payslip'`; behaviour
 * hangs off type, never off shelf.
 *
 * Unknown keys THROW. A fallback to inbox would file a payslip somewhere nobody
 * looks and nothing would say so; a key this repo asks for and the database does
 * not have is a defect in this repo.
 */
import { asc, count, eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { DocumentTypeKey, EnumValue } from '$lib/enums';
import type { WrittenShelfKey } from '$lib/documents/shelves';
import {
	templateDefaults,
	unitsForTemplate,
	type LaneSeed,
	type ShelfTemplate,
	type ShelfUnit
} from '$lib/documents/templates';
import { db, type Db, type Queryable } from '$lib/server/db';
import { document, shelf, shelfType } from '$lib/server/db/schema';

export interface ShelfRow {
	id: string;
	key: string;
	label: string;
	emoji: string;
	sortOrder: number;
	system: boolean;
	/** One of seven names; `templateEngine` maps it to the component that draws. */
	template: EnumValue<'shelf.template'>;
	/** What a card on this shelf is. */
	unit: EnumValue<'shelf.unit'>;
	/** The caption under the screen title. */
	question: string;
	/** What a new card here starts with. */
	laneSeeds: LaneSeed[];
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

/**
 * `inbox` and `statements` are looked up through this typed helper because
 * their keys are spelled out directly in route code. `finance` and `property`
 * are system shelves too (see `shelf.system`) — payslips, tax attachments,
 * and bills file to them by key — but those writers already asked for them
 * through the untyped `shelfIdByKey`, so they keep doing that.
 */
export async function systemShelfId(
	key: WrittenShelfKey,
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
			system: shelf.system,
			template: shelf.template,
			unit: shelf.unit,
			question: shelf.question,
			laneSeeds: shelf.laneSeeds
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

/**
 * A new shelf, keyed by a slug derived from its label.
 *
 * A shelf is one question, one unit, one template — so making one asks for all
 * three rather than just a name and an emoji. The lanes a card on it starts
 * with come from the template, exactly as its type list comes from the seed:
 * both are the household's the moment the shelf exists.
 */
export async function addShelf(
	input: {
		label: string;
		emoji?: string;
		template: ShelfTemplate;
		unit: ShelfUnit;
		question?: string;
	},
	handle: Queryable = db
): Promise<ShelfRow> {
	const trimmed = input.label.trim();
	if (!trimmed) throw new Error('A shelf needs a name.');
	// A wallet of accounts and a ribbon of people are not layouts anybody could
	// draw. Refused here rather than in the dialog, because the dialog is not the
	// only caller and a shelf that cannot be drawn is a screen that cannot open.
	if (!unitsForTemplate(input.template).includes(input.unit))
		throw new Error(`A ${input.template} shelf cannot be organised by ${input.unit}.`);
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
	const [row] = await handle
		.insert(shelf)
		.values({
			id,
			key,
			label: trimmed,
			emoji: input.emoji?.trim() || '🗂️',
			sortOrder: next,
			template: input.template,
			unit: input.unit,
			// A shelf with no question written for it still HAS one, so the screen
			// never draws a blank caption. It is prose the household can replace.
			question: input.question?.trim() || 'What is filed here?',
			laneSeeds: templateDefaults(input.template).laneSeeds
		})
		.returning({
			id: shelf.id,
			key: shelf.key,
			label: shelf.label,
			emoji: shelf.emoji,
			sortOrder: shelf.sortOrder,
			system: shelf.system,
			template: shelf.template,
			unit: shelf.unit,
			question: shelf.question,
			laneSeeds: shelf.laneSeeds
		});
	return row;
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
 * A system shelf is refused outright. Eight of the ten seeded shelves carry the
 * flag, for two different reasons:
 *
 * `inbox`, `statements`, `finance` and `property` are referred to by key from
 * code — capture files into inbox, an accepted import files into statements,
 * the salary tracker files payslips and tax attachments into finance, and
 * billing files bills into property — so deleting one breaks the next upload.
 *
 * `identity`, `family`, `health` and `household` are not referred to by key by
 * anything, and deleting one would break nothing that runs. They are fixed for
 * the other reason a thing is fixed: they are the product's answer to where a
 * passport, a birth certificate, a test result or a boiler warranty goes, and
 * an answer a household can delete is not an answer. The guard reads the
 * column, so it does not care which of the two reasons put the flag there.
 *
 * `tenancy` and `vehicles` are seeded and deletable — not every household
 * rents, not every household drives.
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

/**
 * The types each shelf offers first, by shelf key.
 *
 * Read whole: there are ten shelves and a handful of types each, and the two
 * screens that want this — the review form and the documents type filter —
 * both want every shelf's list at once.
 */
export async function shelfTypesByKey(
	handle: Queryable = db
): Promise<Map<string, DocumentTypeKey[]>> {
	const rows = await handle
		.select({ key: shelf.key, type: shelfType.type, ordinal: shelfType.ordinal })
		.from(shelfType)
		.innerJoin(shelf, eq(shelf.id, shelfType.shelfId))
		.orderBy(asc(shelfType.ordinal));
	const byKey = new Map<string, DocumentTypeKey[]>();
	for (const row of rows) byKey.set(row.key, [...(byKey.get(row.key) ?? []), row.type]);
	return byKey;
}

/**
 * Replace a shelf's list with exactly what was chosen.
 *
 * A replacement, not a merge: the picker shows every type with the shelf's own
 * ticked, so what comes back IS the intended list and an unticked one was
 * unticked on purpose. Ordinals are re-issued so the order is the order given.
 */
export async function setShelfTypes(
	shelfId: string,
	types: DocumentTypeKey[],
	handle: Db = db
): Promise<void> {
	// Both halves or neither. As two loose statements, a failure between them —
	// a type somebody else removed a moment earlier — left the shelf with an
	// empty list rather than the one it had, which reads as data loss for what
	// was only a refused edit.
	await handle.transaction(async (tx) => {
		await tx.delete(shelfType).where(eq(shelfType.shelfId, shelfId));
		if (types.length === 0) return;
		await tx.insert(shelfType).values(types.map((type, ordinal) => ({ shelfId, type, ordinal })));
	});
}
