// SPDX-License-Identifier: AGPL-3.0-or-later
import { asc } from 'drizzle-orm';
import { db, type Db } from '$lib/server/db';
import {
	document,
	loan,
	loanFixationPeriod,
	loanProperty,
	property,
	propertyBill,
	tag,
	tenancy
} from '$lib/server/db/schema';
import { visibleDocumentPredicate, type Actor } from '$lib/server/documents/visibility';

/**
 * Every property, in a stable order.
 *
 * The tiebreak is the point. Properties created together — by the setup wizard,
 * or the demo seed — share a `created_at` to the microsecond, and ordering by
 * that column alone is not a total order: PostgreSQL may return tied rows in
 * any order, and an UPDATE moves a row in the heap, which changes it.
 *
 * The property screen selects `properties[0]` when the URL names no property,
 * so an unstable order meant saving a floor plan switched the page to the other
 * flat — the plan looked as though it had been lost, and the editor reopened
 * empty because it was now editing a different property. Saving again flipped
 * the order back and the plan "returned".
 */
export function listProperties(handle: Db = db) {
	return handle.select().from(property).orderBy(asc(property.createdAt), asc(property.id));
}

/**
 * Everything the Property screen reads, in one round of queries.
 *
 * Here rather than in `+page.server.ts` because it is a domain read. The route
 * built eleven selects of its own beside this module, which is how a screen
 * becomes the second place that knows how a property is stored — and how the
 * read rule on the document half comes to be applied by whoever remembers.
 *
 * What it returns is rows. Turning them into cards, allocations and pills is
 * presentation and stays with the markup.
 */
export async function readPropertyScreen(actor: Actor | null, handle: Db = db) {
	const [properties, tenancies, bills, loans, periods, links, docs, allTags] = await Promise.all([
		listProperties(handle),
		handle.select().from(tenancy),
		handle.select().from(propertyBill).orderBy(propertyBill.sort),
		handle.select().from(loan),
		handle.select().from(loanFixationPeriod),
		handle.select().from(loanProperty),
		// Only what a BILL's row needs — whether the file behind it is one this
		// actor may open at all. The documents card is loaded by `documentsAbout`,
		// which is where the shelf label and the read rule both come from.
		// Restricted here too: a bill's scan is paper like any other, so a member
		// sees the amount with no paperclip behind it.
		handle.select({ id: document.id }).from(document).where(visibleDocumentPredicate(actor)),
		// For the tag field's suggestion list, the same way the Loans screen offers
		// its own known tags: typing "Renovation" here and "renovation" there
		// should land on the one tag, not two differently-cased ones.
		handle.select().from(tag)
	]);
	return { properties, tenancies, bills, loans, periods, links, docs, allTags };
}
