// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The three figures a shelf's banner shows, counted once.
 *
 * One flat shape for every shelf rather than a query per shelf, because the
 * decision about WHICH three a shelf shows already lives in
 * `$lib/documents/banner` and belongs in exactly one place. This module fills
 * what it can and leaves the rest at zero; nothing here chooses a label.
 *
 * Every count goes through `visibleDocumentPredicate`, the same rule the list
 * and the search use. A banner counting a document a member cannot see would be
 * telling them it exists, which is the one fact the restriction protects — and
 * a second reading of that rule here would be a second place for the first one
 * to drift.
 */
import { and, eq, sql } from 'drizzle-orm';
import { db, type Queryable } from '$lib/server/db';
import {
	account,
	document,
	documentLink,
	documentType,
	entity,
	property,
	shelf
} from '$lib/server/db/schema';
import { visibleDocumentPredicate, type Actor } from './visibility';
import { SOON_DAYS } from '$lib/documents/view';
import type { BannerFacts } from '$lib/documents/banner';

/**
 * How long a lapsed document stays red.
 *
 * The same thirty days `expiryTreatment` paints with. Held here as its own
 * constant rather than imported because `view.ts` keeps it private, and the
 * duplication is named so it can be found: the two must agree, or the banner
 * counts a document the row beneath it is no longer colouring.
 */
const EXPIRED_RED_DAYS = 30;

/** How far ahead money owed is worth counting. Matches `DUE_SOON_DAYS`. */
const DUE_SOON_DAYS = 30;

const EMPTY: BannerFacts = {
	people: 0,
	subjects: 0,
	documents: 0,
	records: 0,
	expired: 0,
	inReminderWindow: 0,
	addresses: 0,
	recurring: 0,
	institutions: 0,
	paymentsDue: 0,
	inWarranty: 0,
	lastEntry: null,
	nextDate: null,
	anyDated: false,
	accounts: 0,
	gaps: 0
};

/**
 * Everything a banner might show for one shelf.
 *
 * `accounts` and `gaps` are left at zero and filled by the Statements loader: a
 * gap is a fact about the coverage ribbon, computed from periods, and answering
 * it a second time from document rows would be a second answer to one question.
 */
export async function shelfFacts(
	shelfKey: string,
	viewer: Actor | null,
	handle: Queryable = db
): Promise<BannerFacts> {
	const today = new Date().toISOString().slice(0, 10);
	const onShelf = and(eq(shelf.key, shelfKey), visibleDocumentPredicate(viewer));

	// One pass over the shelf for everything a document row can answer. The
	// amber window is joined off the TYPE, so Identity's six months apply here
	// exactly as they apply to the pill on the row beneath.
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
			recurring: sql<number>`count(*) filter (where ${document.expiryVerb} = 'renews')::int`,
			paymentsDue: sql<number>`count(*) filter (
				where ${document.expiryVerb} = 'due'
				  and ${document.expiresOn} >= ${today}::date
				  and ${document.expiresOn} <= ${today}::date + ${DUE_SOON_DAYS}::int
			)::int`,
			inWarranty: sql<number>`count(*) filter (
				where ${document.type} = 'warranty' and ${document.expiresOn} > ${today}::date
			)::int`,
			lastEntry: sql<string | null>`max(coalesce(${document.periodOn}, ${document.addedOn}))`,
			nextDate: sql<string | null>`min(${document.expiresOn}) filter (
				where ${document.expiresOn} >= ${today}::date
			)`,
			anyDated: sql<boolean>`coalesce(bool_or(${document.expiresOn} is not null), false)`
		})
		.from(document)
		.innerJoin(shelf, eq(shelf.id, document.shelfId))
		.innerJoin(documentType, eq(documentType.key, document.type))
		.where(onShelf);

	// People and subjects separately. The far end of a document link is an
	// `entity`, so what a target IS decides nothing about the join and
	// everything about which figure it feeds.
	const [linked] = await handle
		.select({
			people: sql<number>`count(distinct ${entity.id}) filter (where ${entity.kind} = 'person')::int`,
			subjects: sql<number>`count(distinct ${entity.id}) filter (where ${entity.kind} = 'subject')::int`,
			institutions: sql<number>`count(distinct ${account.bank})::int`
		})
		.from(document)
		.innerJoin(shelf, eq(shelf.id, document.shelfId))
		.innerJoin(documentLink, eq(documentLink.documentId, document.id))
		.innerJoin(entity, eq(entity.id, documentLink.targetId))
		.leftJoin(account, eq(account.id, documentLink.targetId))
		.where(onShelf);

	// Addresses are a fact about the household and not about what is filed: a
	// flat with no paperwork yet is still a flat this shelf is for.
	const [addresses] = await handle.select({ count: sql<number>`count(*)::int` }).from(property);

	return {
		...EMPTY,
		documents: totals?.documents ?? 0,
		records: totals?.documents ?? 0,
		expired: totals?.expired ?? 0,
		inReminderWindow: totals?.inReminderWindow ?? 0,
		recurring: totals?.recurring ?? 0,
		paymentsDue: totals?.paymentsDue ?? 0,
		inWarranty: totals?.inWarranty ?? 0,
		lastEntry: totals?.lastEntry ?? null,
		nextDate: totals?.nextDate ?? null,
		anyDated: totals?.anyDated ?? false,
		people: linked?.people ?? 0,
		subjects: linked?.subjects ?? 0,
		institutions: linked?.institutions ?? 0,
		addresses: addresses?.count ?? 0
	};
}
