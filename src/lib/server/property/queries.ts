// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { asc } from 'drizzle-orm';
import { db, type Db } from '$lib/server/db';
import { property } from '$lib/server/db/schema';

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
