// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Putting one payee's queued rows on one card.
 *
 * The queue arrives in date order, so four payments to the same place land in
 * four separate cards with three other merchants in between, and the same
 * decision gets made four times without ever looking like the same decision.
 * Grouping does not make the decision for anybody — every row keeps its own
 * picker and its own Save — it just stops them being scattered.
 *
 * A repeated amount inside a group is called out, because that is what a
 * standing payment looks like from the ledger's side: the same sum to the same
 * place, month after month. It is a hint to read the group as a series, not a
 * claim that the rows are duplicates.
 */

/** The fields grouping reads. A superset of this is what the screen sends. */
export interface GroupableRow {
	id: string;
	/** Display name, already resolved by the caller. */
	merchant: string;
	/** Destination account number as printed, when the statement carried one. */
	counterpartyAccount?: string | null;
	/** Raw counterparty, before any display fallback. */
	counterparty?: string | null;
	/** Signed minor units, as a string so it survives the wire. */
	amountKey: string;
}

export interface ReviewGroup<T extends GroupableRow> {
	/** Stable across renders, for the keyed each block. */
	key: string;
	/** What the card is headed with. */
	label: string;
	rows: T[];
	/** Rows whose amount occurs more than once here, by row id. */
	repeated: Set<string>;
}

/**
 * Fold case, accents and punctuation away so one payee is one key.
 *
 * "ALBERT VAM DEKUJE" and "Albert vam dekuje" are the same shop; a statement
 * is not consistent about which it prints.
 */
function fold(text: string): string {
	return text
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

/**
 * What makes two rows the same payee.
 *
 * The destination account number when there is one — it is the thing that does
 * not change between months, where the printed name often does. Otherwise the
 * name. Deliberately the same order of preference `conditionFor` uses when it
 * decides what a learned rule should key on, so a group is exactly the set of
 * rows one rule would go on to cover.
 */
export function groupKeyFor(row: GroupableRow): string | null {
	const account = (row.counterpartyAccount ?? '').replace(/\s/g, '');
	if (account) return `account:${account}`;
	const name = fold(row.counterparty ?? row.merchant ?? '');
	// A one- or two-character name is noise, not an identity: the ledger holds
	// counterparties literally called "1" and "2", and grouping on those would
	// collect unrelated payments under a heading that says nothing.
	return name.length >= 3 ? `name:${name}` : null;
}

/**
 * The queue as cards, in the order the rows arrived.
 *
 * A group takes the position of its FIRST row, so the ranking the caller
 * already applied is preserved: a group led by a pre-filled row stays where
 * that row was. Rows that group with nothing are single-row groups rather than
 * a separate shape, so the screen has one thing to render.
 */
export function groupReviewRows<T extends GroupableRow>(rows: T[]): ReviewGroup<T>[] {
	const groups: ReviewGroup<T>[] = [];
	const byKey = new Map<string, ReviewGroup<T>>();

	for (const row of rows) {
		const key = groupKeyFor(row);
		const existing = key === null ? undefined : byKey.get(key);
		if (existing) {
			existing.rows.push(row);
			continue;
		}
		const group: ReviewGroup<T> = {
			// An ungroupable row still needs a key for the each block, and its own
			// id is the only thing guaranteed unique.
			key: key ?? `row:${row.id}`,
			label: row.merchant,
			rows: [row],
			repeated: new Set()
		};
		groups.push(group);
		if (key !== null) byKey.set(key, group);
	}

	for (const group of groups) {
		const seen = new Map<string, string[]>();
		for (const row of group.rows) {
			const ids = seen.get(row.amountKey) ?? [];
			ids.push(row.id);
			seen.set(row.amountKey, ids);
		}
		for (const ids of seen.values()) {
			if (ids.length > 1) for (const id of ids) group.repeated.add(id);
		}
	}

	return groups;
}

/**
 * Whole groups, up to a budget of rows.
 *
 * Cutting the list at a row count would split a group across the boundary and
 * show a card saying "3 rows" with one of them missing. At least one group is
 * always returned, or a single payee with more rows than the budget would
 * empty the screen.
 */
export function takeGroups<T extends GroupableRow>(
	groups: ReviewGroup<T>[],
	rowBudget: number
): ReviewGroup<T>[] {
	const taken: ReviewGroup<T>[] = [];
	let used = 0;
	for (const group of groups) {
		if (taken.length > 0 && used + group.rows.length > rowBudget) break;
		taken.push(group);
		used += group.rows.length;
	}
	return taken;
}
