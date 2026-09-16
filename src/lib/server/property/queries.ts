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

/**
 * Every property, in a stable order.
 *
 * The `id` tiebreak matters: properties created together share `created_at`
 * to the microsecond, so ordering by that column alone is not a total order —
 * PostgreSQL can return tied rows differently after an UPDATE moves one in the
 * heap. The property screen picks `properties[0]` by default, so an unstable
 * order flipped which flat a saved floor plan appeared to belong to.
 */
export function listProperties(handle: Db = db) {
	return handle.select().from(property).orderBy(asc(property.createdAt), asc(property.id));
}

/**
 * Everything the Property screen reads, in one round of queries.
 *
 * Lives here, not in `+page.server.ts`, so the route isn't a second place that
 * knows how a property is stored. Returns rows; turning them into cards,
 * allocations and pills is presentation and stays with the markup.
 */
export async function readPropertyScreen(handle: Db = db) {
	const [properties, tenancies, bills, loans, periods, links, docs, allTags] = await Promise.all([
		listProperties(handle),
		handle.select().from(tenancy),
		handle.select().from(propertyBill).orderBy(propertyBill.sort),
		handle.select().from(loan),
		handle.select().from(loanFixationPeriod),
		handle.select().from(loanProperty),
		// Only whether a file exists behind a bill; `documentsAbout` loads the shelf label.
		handle.select({ id: document.id }).from(document),
		// Tag suggestion list, like the Loans screen: avoids "Renovation" and
		// "renovation" becoming two different tags.
		handle.select().from(tag)
	]);
	return { properties, tenancies, bills, loans, periods, links, docs, allTags };
}
