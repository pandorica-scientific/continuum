// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Which lane a document belongs in.
 *
 * The vocabulary is deliberately `rule.conditions`' — `[{ field, op, value }]`
 * ANDed — so a household that has learnt what a transaction rule is does not
 * have to learn a second thing for paper. In this release these decide which
 * lane an already-linked document falls into; in the next they propose the
 * organisation link itself, with the same accepted-and-corrected evidence the
 * transaction rules already keep.
 */

/** One test against a document. Deliberately `rule.conditions`' shape. */
export interface Condition {
	field: 'type' | 'tag' | 'name';
	op: 'is' | 'contains';
	value: string;
}

/** The little of a document a lane looks at. */
export interface LaneCandidate {
	id: string;
	name: string;
	type: string;
	tags: string[];
}

const fold = (value: string): string => value.trim().toLowerCase();

function satisfies(doc: LaneCandidate, condition: Condition): boolean {
	const wanted = fold(condition.value);
	switch (condition.field) {
		case 'type':
			return condition.op === 'is' ? doc.type === condition.value : fold(doc.type).includes(wanted);
		case 'name':
			return condition.op === 'is' ? fold(doc.name) === wanted : fold(doc.name).includes(wanted);
		case 'tag':
			return doc.tags.some((tag) =>
				condition.op === 'is' ? fold(tag) === wanted : fold(tag).includes(wanted)
			);
		default:
			// FAILS CLOSED. Conditions live in jsonb and the next release adds
			// fields to them, so a lane written by a newer version will be read by
			// this code. Treating an unknown field as "no opinion" would make that
			// lane claim every document filed against the organisation — which is
			// a far worse answer than claiming none.
			return false;
	}
}

/**
 * Whether this lane holds this document.
 *
 * ANDed, so a second condition always NARROWS. An empty list claims everything,
 * which is what makes a no-cadence lane at the end of an organisation's list
 * mean "whatever the lanes above did not take" — the lanes are tried in order
 * and the first match wins, so nothing can fall into two.
 */
export function matchesLane(doc: LaneCandidate, conditions: unknown): boolean {
	if (!Array.isArray(conditions)) return false;
	return conditions.every((condition) => {
		if (typeof condition !== 'object' || condition === null) return false;
		const { field, op, value } = condition as Partial<Condition>;
		if (typeof field !== 'string' || typeof value !== 'string') return false;
		if (op !== 'is' && op !== 'contains') return false;
		return satisfies(doc, { field, op, value } as Condition);
	});
}
