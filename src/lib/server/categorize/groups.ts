// SPDX-License-Identifier: AGPL-3.0-or-later
import { asc } from 'drizzle-orm';
import { db, type Queryable } from '$lib/server/db';
import { categoryGroup } from '$lib/server/db/schema';
import type { EnumValue } from '$lib/enums';

export interface GroupRow {
	key: string;
	label: string;
	colorToken: string;
	role: EnumValue<'category_group.role'>;
	sort: number;
}

/**
 * The category groups, in waterfall order.
 *
 * A group a household adds appears in the charts, filters and review queue
 * without a deploy.
 */
export async function loadCategoryGroups(handle: Queryable = db): Promise<GroupRow[]> {
	return handle
		.select()
		.from(categoryGroup)
		.orderBy(asc(categoryGroup.sort), asc(categoryGroup.key)) as Promise<GroupRow[]>;
}

/**
 * Groups that are stages of the waterfall — everything that is neither the
 * income that opens it nor the savings that close it.
 *
 * Keyed on `role`, not on well-known keys: a household can rename or add
 * groups and the waterfall still classifies them correctly.
 */
export function expenseGroups(groups: GroupRow[]): GroupRow[] {
	return groups.filter((group) => group.role === 'expense');
}
