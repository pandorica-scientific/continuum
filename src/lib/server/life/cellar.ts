// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Reading and writing the Cellar.
 *
 * The screens call these; no `+page.server.ts` writes SQL of its own. The two
 * things that can be wrong in a way somebody notices — the ownership counts and
 * the drink-by window — are pure arithmetic in `$lib/life/collections/`, and
 * this layer only stores what they decide.
 */
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { db, type Db } from '$lib/server/db';
import { bottle, collection, person, tasting, tastingNote } from '$lib/server/db/schema';
import type { EnumValue } from '$lib/enums';
import { openOne, type Counts } from '$lib/life/collections/ownership';
import { bottleSvg, labelInitials } from '$lib/life/art';

/** The one shelf v0.9.0 ships. Books and records are the next two. */
export const CELLAR_KEY = 'cellar';

export interface ShelfView {
	id: string;
	key: string;
	name: string;
	emoji: string;
	question: string;
	/** How many bottlings stand on it — rows, not bottles. */
	count: number;
}

/** Every shelf, with how much is on it. A list from the start, not a heading. */
export async function listShelves(handle: Db = db): Promise<ShelfView[]> {
	return handle
		.select({
			id: collection.id,
			key: collection.key,
			name: collection.name,
			emoji: collection.emoji,
			question: collection.question,
			count: sql<number>`count(${bottle.id})::int`
		})
		.from(collection)
		.leftJoin(bottle, eq(bottle.collectionId, collection.id))
		.groupBy(collection.id)
		.orderBy(asc(collection.sortOrder), asc(collection.name));
}

export async function shelfIdByKey(key: string, handle: Db = db): Promise<string | null> {
	const [row] = await handle
		.select({ id: collection.id })
		.from(collection)
		.where(eq(collection.key, key))
		.limit(1);
	return row?.id ?? null;
}

export interface BottleCardView {
	id: string;
	type: EnumValue<'bottle.type'>;
	producer: string;
	name: string;
	vintage: number | null;
	ageYears: number | null;
	country: string | null;
	region: string;
	grapeOrCask: string;
	abv: string | null;
	sizeMl: number | null;
	drinkFrom: number | null;
	drinkTo: number | null;
	owned: number;
	opened: number;
	labelPhoto: string | null;
	/** The silhouette, already `currentColor`. Null if it cannot be drawn. */
	art: string | null;
	/** Shown on the label plate until a photograph replaces it. */
	initials: string;
	/** The best score anybody has given it, or null if nobody has. */
	score: number | null;
	tastings: number;
	/** How many tastings were logged this calendar year. Drives the tile. */
	tastingsThisYear: number;
}

const artOf = (row: {
	id: string;
	type: EnumValue<'bottle.type'>;
	producer: string;
	name: string;
}): string | null => {
	try {
		return bottleSvg(row);
	} catch {
		// A silhouette this generator cannot draw. The card falls back to the
		// label plate, which beats a screen that will not render.
		return null;
	}
};

/**
 * Scores and counts per bottle, in one pass.
 *
 * A query per card would be one round trip per bottle, and a cellar is exactly
 * the kind of screen that grows to fifty rows without anybody noticing.
 */
async function tastingSummary(
	bottleIds: string[],
	year: number,
	handle: Db
): Promise<Map<string, { score: number | null; tastings: number; thisYear: number }>> {
	if (bottleIds.length === 0) return new Map();
	const rows = await handle
		.select({
			bottleId: tasting.bottleId,
			score: sql<number | null>`max(${tasting.score})`,
			tastings: sql<number>`count(*)::int`,
			thisYear: sql<number>`count(*) filter (
				where extract(year from ${tasting.tastedOn}) = ${year}
			)::int`
		})
		.from(tasting)
		.where(inArray(tasting.bottleId, bottleIds))
		.groupBy(tasting.bottleId);

	const byBottle = new Map<string, { score: number | null; tastings: number; thisYear: number }>();
	for (const row of rows) {
		byBottle.set(row.bottleId, {
			score: row.score === null ? null : Number(row.score),
			tastings: row.tastings,
			thisYear: row.thisYear
		});
	}
	return byBottle;
}

/** Everything on one shelf, newest last. */
export async function listBottles(
	collectionId: string,
	year: number,
	handle: Db = db
): Promise<BottleCardView[]> {
	const rows = await handle
		.select()
		.from(bottle)
		.where(eq(bottle.collectionId, collectionId))
		.orderBy(asc(bottle.producer), asc(bottle.name));

	const summary = await tastingSummary(
		rows.map((row) => row.id),
		year,
		handle
	);

	return rows.map((row) => {
		const seen = summary.get(row.id);
		return {
			id: row.id,
			type: row.type,
			producer: row.producer,
			name: row.name,
			vintage: row.vintage,
			ageYears: row.ageYears,
			country: row.country,
			region: row.region,
			grapeOrCask: row.grapeOrCask,
			abv: row.abv,
			sizeMl: row.sizeMl,
			drinkFrom: row.drinkFrom,
			drinkTo: row.drinkTo,
			owned: row.owned,
			opened: row.opened,
			labelPhoto: row.labelPhoto,
			art: artOf(row),
			initials: labelInitials(row.producer, row.name),
			score: seen?.score ?? null,
			tastings: seen?.tastings ?? 0,
			tastingsThisYear: seen?.thisYear ?? 0
		};
	});
}

export interface TastingView {
	id: string;
	tastedOn: string;
	score: number | null;
	note: string;
	personId: string | null;
	personName: string | null;
	/** Flavour chips, each in its own `--series-*` colour. */
	notes: { id: string; note: string; series: string }[];
}

export interface BottleDetail extends BottleCardView {
	collectionId: string;
	photo: string | null;
	barcode: string | null;
	boughtOn: string | null;
	boughtWhere: string;
	boughtMinor: bigint | null;
	boughtCurrency: string | null;
	transactionId: string | null;
	tastingList: TastingView[];
}

export async function loadBottle(
	id: string,
	year: number,
	handle: Db = db
): Promise<BottleDetail | null> {
	const [row] = await handle.select().from(bottle).where(eq(bottle.id, id));
	if (!row) return null;

	const [summary, tastingRows] = await Promise.all([
		tastingSummary([id], year, handle),
		handle
			.select({
				id: tasting.id,
				tastedOn: tasting.tastedOn,
				score: tasting.score,
				note: tasting.note,
				personId: tasting.personId,
				personName: person.name
			})
			.from(tasting)
			.leftJoin(person, eq(person.id, tasting.personId))
			.where(eq(tasting.bottleId, id))
			.orderBy(desc(tasting.tastedOn))
	]);

	const flavours = await flavoursByTasting(
		tastingRows.map((one) => one.id),
		handle
	);
	const seen = summary.get(id);

	return {
		id: row.id,
		collectionId: row.collectionId,
		type: row.type,
		producer: row.producer,
		name: row.name,
		vintage: row.vintage,
		ageYears: row.ageYears,
		country: row.country,
		region: row.region,
		grapeOrCask: row.grapeOrCask,
		abv: row.abv,
		sizeMl: row.sizeMl,
		drinkFrom: row.drinkFrom,
		drinkTo: row.drinkTo,
		owned: row.owned,
		opened: row.opened,
		photo: row.photo,
		labelPhoto: row.labelPhoto,
		barcode: row.barcode,
		boughtOn: row.boughtOn,
		boughtWhere: row.boughtWhere,
		boughtMinor: row.boughtMinor,
		boughtCurrency: row.boughtCurrency,
		transactionId: row.transactionId,
		art: artOf(row),
		initials: labelInitials(row.producer, row.name),
		score: seen?.score ?? null,
		tastings: seen?.tastings ?? 0,
		tastingsThisYear: seen?.thisYear ?? 0,
		tastingList: tastingRows.map((one) => ({
			id: one.id,
			tastedOn: one.tastedOn,
			score: one.score,
			note: one.note,
			personId: one.personId,
			personName: one.personName,
			notes: flavours.get(one.id) ?? []
		}))
	};
}

async function flavoursByTasting(
	tastingIds: string[],
	handle: Db
): Promise<Map<string, { id: string; note: string; series: string }[]>> {
	if (tastingIds.length === 0) return new Map();
	const rows = await handle
		.select()
		.from(tastingNote)
		.where(inArray(tastingNote.tastingId, tastingIds))
		.orderBy(asc(tastingNote.note));

	const byTasting = new Map<string, { id: string; note: string; series: string }[]>();
	for (const row of rows) {
		const list = byTasting.get(row.tastingId) ?? [];
		list.push({ id: row.id, note: row.note, series: row.series });
		byTasting.set(row.tastingId, list);
	}
	return byTasting;
}

// ---- Writes ----

export interface NewBottle {
	collectionId: string;
	type: EnumValue<'bottle.type'>;
	producer: string;
	name: string;
	vintage: number | null;
	ageYears: number | null;
	country: string | null;
	region: string;
	grapeOrCask: string;
	abv: string | null;
	sizeMl: number | null;
	drinkFrom: number | null;
	drinkTo: number | null;
	owned: number;
	opened: number;
	boughtOn: string | null;
	boughtWhere: string;
	boughtMinor: bigint | null;
	boughtCurrency: string | null;
}

export async function createBottle(input: NewBottle, handle: Db = db): Promise<string> {
	const id = uuidv7();
	await handle.insert(bottle).values({ id, ...input });
	return id;
}

export async function updateBottle(
	id: string,
	input: Omit<NewBottle, 'collectionId'>,
	handle: Db = db
): Promise<void> {
	await handle.update(bottle).set(input).where(eq(bottle.id, id));
}

/**
 * Read the counts, decide the new pair, write it — with the row held.
 *
 * The arithmetic still lives in `$lib/life/collections/ownership` and is passed
 * in: splitting it the other way — an `openOne` here that did its own
 * arithmetic — is how the counts and the CHECK drift apart.
 *
 * What this adds is the LOCK. Read-then-write across two round trips loses one
 * of two updates that overlap, and the two that overlap in a household are the
 * ones most likely to: somebody presses `+` on their phone while the same
 * bottle is being logged as tasted on the laptop, and one of the two simply
 * does not happen. `for update` makes the second wait for the first, so it
 * decides from what the first left rather than from what it found.
 *
 * `move` returning null means "nothing to do", and nothing is written.
 */
export async function moveCounts(
	id: string,
	move: (counts: Counts) => Counts | null,
	handle: Db = db
): Promise<Counts | null> {
	return handle.transaction(async (tx) => {
		const held = await lockedCounts(id, tx);
		if (!held) return null;

		const next = move(held);
		if (!next) return null;

		await tx.update(bottle).set(next).where(eq(bottle.id, id));
		return next;
	});
}

/** The counts, with the row held for the rest of the transaction. */
async function lockedCounts(id: string, tx: Db): Promise<Counts | null> {
	const [row] = await tx
		.select({ owned: bottle.owned, opened: bottle.opened })
		.from(bottle)
		.where(eq(bottle.id, id))
		.for('update');
	return row ?? null;
}

export async function currentCounts(id: string, handle: Db = db): Promise<Counts | null> {
	const [row] = await handle
		.select({ owned: bottle.owned, opened: bottle.opened })
		.from(bottle)
		.where(eq(bottle.id, id));
	return row ?? null;
}

export async function deleteBottle(id: string, handle: Db = db): Promise<void> {
	await handle.delete(bottle).where(eq(bottle.id, id));
}

export interface NewTasting {
	bottleId: string;
	tastedOn: string;
	personId: string | null;
	score: number | null;
	note: string;
	/** Flavour words, as typed. Colours are handed out here. */
	flavours: string[];
}

/**
 * Log a tasting.
 *
 * Opening a bottle and logging a tasting are one act: nobody tastes a bottle
 * they did not open, and asking them to press two buttons is how the counts end
 * up wrong. So the open count rises here too — up to what is owned, which is
 * the rule in `openOne`.
 *
 * The count is read inside the transaction with the row held, for the reason
 * `moveCounts` gives: a tasting logged while somebody else is pressing `+` used
 * to write back a pair decided before their press and undo it.
 */
export async function logTasting(input: NewTasting, handle: Db = db): Promise<string | null> {
	const id = uuidv7();
	let missing = false;
	await handle.transaction(async (tx) => {
		const held = await lockedCounts(input.bottleId, tx);
		if (!held) {
			missing = true;
			return;
		}

		await tx.insert(tasting).values({
			id,
			bottleId: input.bottleId,
			tastedOn: input.tastedOn,
			personId: input.personId,
			score: input.score,
			note: input.note
		});

		if (input.flavours.length) {
			// De-duplicated before it reaches here, so the unique index on
			// (tasting, note) is a backstop rather than something to handle.
			await tx.insert(tastingNote).values(
				input.flavours.map((note, at) => ({
					id: uuidv7(),
					tastingId: id,
					note,
					// The reserve series slots, handed out around the ring. Not the
					// named ones: `--series-income` means income on a cash-flow chart.
					series: `series-r${(at % 10) + 1}`
				}))
			);
		}

		// Tasting a bottle opens it — up to what is owned, which is the rule.
		await tx.update(bottle).set(openOne(held)).where(eq(bottle.id, input.bottleId));
	});
	return missing ? null : id;
}

export async function deleteTasting(id: string, handle: Db = db): Promise<void> {
	await handle.delete(tasting).where(eq(tasting.id, id));
}

/** How many tastings the household logged this year, across a whole shelf. */
export async function openedThisYear(
	collectionId: string,
	year: number,
	handle: Db = db
): Promise<number> {
	const [{ count }] = await handle
		.select({ count: sql<number>`count(*)::int` })
		.from(tasting)
		.innerJoin(bottle, eq(bottle.id, tasting.bottleId))
		.where(
			and(
				eq(bottle.collectionId, collectionId),
				sql`extract(year from ${tasting.tastedOn}) = ${year}`
			)
		);
	return count;
}
