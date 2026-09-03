// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The figures a shelf's summary band shows, counted once.
 *
 * One flat shape for every shelf rather than a query per shelf, because the
 * decision about WHICH three a shelf shows lives in `$lib/documents/shelf-tiles`
 * and belongs in exactly one place. This module fills what a document row can
 * answer and leaves the rest to the loader that owns it: `missing` on a dossier
 * comes from the cells, and on the ribbon from the gaps, because a hole is a
 * fact about periods and answering it a second time from document rows would be
 * a second answer to one question.
 *
 * Every count goes through `visibleDocumentPredicate`, the same rule the list
 * and the search use. A band counting a document a member cannot see would be
 * telling them it exists, which is the one fact the restriction protects — and
 * a second reading of that rule here would be a second place for the first one
 * to drift.
 */
import { and, eq, sql } from 'drizzle-orm';
import { db, type Queryable } from '$lib/server/db';
import { document, documentLink, documentType, entity, shelf } from '$lib/server/db/schema';
import { visibleDocumentPredicate, type Actor } from './visibility';
import { SOON_DAYS } from '$lib/documents/view';
import { daysBetween } from '$lib/dates';
import { EMPTY_FACTS, type ShelfFacts } from '$lib/documents/shelf-tiles';
import { templateEngine } from '$lib/documents/templates';
import type { ShelfRow } from './shelves';

/** A lapsed document stays red for a month, then falls quiet. */
const EXPIRED_RED_DAYS = 30;
/** Money owed runs on a shorter clock than paperwork. */
const DUE_SOON_DAYS = 30;

/**
 * Everything a shelf's band might show, for one shelf.
 *
 * `today` is an argument rather than a call to the clock, so a test can state
 * the date it is asking about instead of arranging for one.
 */
export async function shelfFacts(
	shelfRow: ShelfRow,
	viewer: Actor | null,
	handle: Queryable = db,
	today: string = new Date().toISOString().slice(0, 10)
): Promise<ShelfFacts> {
	const onShelf = and(eq(shelf.key, shelfRow.key), visibleDocumentPredicate(viewer));
	const engine = templateEngine(shelfRow.template);

	// One pass over the shelf for everything a document row can answer. The
	// amber window is joined off the TYPE, so an identity document's six months
	// apply here exactly as they apply to the pill on the row beneath.
	const [totals] = await handle
		.select({
			documents: sql<number>`count(*)::int`,
			expired: sql<number>`count(*) filter (
				where ${document.expiresOn} < ${today}::date
				  and ${document.expiresOn} >= ${today}::date - ${EXPIRED_RED_DAYS}::int
			)::int`,
			inReminderWindow: sql<number>`count(*) filter (
				where ${document.expiresOn} >= ${today}::date
				  and ${document.expiresOn} <= ${today}::date
				      + coalesce(${documentType.reminderDays}, ${SOON_DAYS}::int)
			)::int`,
			// Money owed and paperwork run on different clocks, and the soonest of
			// either is what "next due" means.
			nextDate: sql<string | null>`least(
				min(${document.expiresOn}) filter (where ${document.expiresOn} >= ${today}::date),
				min(${document.expiresOn}) filter (
					where ${document.expiryVerb} = 'due'
					  and ${document.expiresOn} >= ${today}::date
					  and ${document.expiresOn} <= ${today}::date + ${DUE_SOON_DAYS}::int
				)
			)`,
			oldestAdded: sql<string | null>`min(${document.addedOn})`
		})
		.from(document)
		.innerJoin(shelf, eq(shelf.id, document.shelfId))
		.innerJoin(documentType, eq(documentType.key, document.type))
		.where(onShelf);

	// How many cards the shelf draws. A person shelf draws one per household
	// member whether or not anything is filed against them, so those two are
	// counted from their own tables; the rest are counted from what is linked,
	// and the loader corrects the figure when it knows better.
	const cards = await countCards(shelfRow, viewer, handle);

	const documents = totals?.documents ?? 0;
	return {
		...EMPTY_FACTS,
		documents,
		cards,
		expired: totals?.expired ?? 0,
		inReminderWindow: totals?.inReminderWindow ?? 0,
		nextDate: totals?.nextDate ?? null,
		// The Inbox is the one shelf whose figure IS its document count: paper
		// waiting is paper on it.
		waiting: engine === 'queue' ? documents : 0,
		oldestDays:
			engine === 'queue' && totals?.oldestAdded ? daysBetween(totals.oldestAdded, today) : null
	};
}

/** Cards drawn on a shelf, by what its unit is. */
async function countCards(
	shelfRow: ShelfRow,
	viewer: Actor | null,
	handle: Queryable
): Promise<number> {
	if (shelfRow.unit === 'document') return 0;
	const [row] = await handle
		.select({
			n: sql<number>`count(distinct ${entity.id})::int`
		})
		.from(document)
		.innerJoin(shelf, eq(shelf.id, document.shelfId))
		.innerJoin(documentLink, eq(documentLink.documentId, document.id))
		.innerJoin(entity, eq(entity.id, documentLink.targetId))
		.where(and(eq(shelf.key, shelfRow.key), visibleDocumentPredicate(viewer)));
	return row?.n ?? 0;
}

/** Everything: the archive's own three figures, across every shelf. */
export async function archiveFacts(
	viewer: Actor | null,
	handle: Queryable = db,
	today: string = new Date().toISOString().slice(0, 10)
): Promise<{ documents: number; shelves: number; nextDate: string | null }> {
	const [totals] = await handle
		.select({
			documents: sql<number>`count(*)::int`,
			nextDate: sql<string | null>`min(${document.expiresOn}) filter (
				where ${document.expiresOn} >= ${today}::date
			)`
		})
		.from(document)
		.where(visibleDocumentPredicate(viewer));
	const [shelves] = await handle.select({ n: sql<number>`count(*)::int` }).from(shelf);
	return {
		documents: totals?.documents ?? 0,
		shelves: shelves?.n ?? 0,
		nextDate: totals?.nextDate ?? null
	};
}
