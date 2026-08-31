// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The categories, in the one order every screen shows them in.
 *
 * Four screens each wrote `orderBy(category.groupKey, category.sort)` for
 * themselves, which was fine while there was only one rule. There are two now —
 * a household's own order, and a catch-all pinned beneath it — and a rule
 * spelled out in four places is a rule that will hold in three.
 */

import { asc, sql } from 'drizzle-orm';
import { db, type Queryable } from '$lib/server/db';
import { category } from '$lib/server/db/schema';

/**
 * `is_catch_all` first, so the flag beats `sort` always: nothing a household
 * drags can land beneath its catch-all, and a category added later cannot
 * either. `name` breaks a tie between two categories sharing a sort value,
 * which is only reachable if a group holds more than one catch-all.
 */
export function loadCategories(handle: Queryable = db) {
	return handle
		.select()
		.from(category)
		.orderBy(
			asc(category.groupKey),
			asc(category.isCatchAll),
			asc(category.sort),
			asc(category.name)
		);
}

/** The next free sort value in a group, so a new category lands at the end of
 *  the draggable ones rather than on top of an existing position. */
export async function nextSortInGroup(groupKey: string, handle: Queryable = db): Promise<number> {
	const [row] = await handle
		.select({ next: sql<number>`coalesce(max(${category.sort}), -1) + 1` })
		.from(category)
		.where(sql`${category.groupKey} = ${groupKey} and ${category.isCatchAll} = false`);
	return row?.next ?? 0;
}
