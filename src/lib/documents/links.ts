// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What a save changes about a document's links, and nothing more.
 *
 * The form must carry the whole link set (pickable kinds as checkboxes, the
 * rest as hidden inputs behind read-only chips): a save that replaced every
 * link with only what the picker offered silently dropped links of kinds the
 * picker didn't know about. A link the form doesn't name IS removed — that's
 * what unticking a chip means — but only as a decision made on screen.
 *
 * Pure and here rather than in the action, so it's reachable by a test
 * without a database.
 */

interface LinkDiff {
	/** Links the document has that the form did not send back. */
	remove: string[];
	/** Links the form sent that the document does not have yet. */
	add: string[];
}

/**
 * `current` is what the row holds, `wanted` is what the form posted.
 *
 * Both sides are de-duplicated via `Set`, which also keeps first-seen order.
 */
export function linkDiff(current: string[], wanted: string[]): LinkDiff {
	const held = new Set(current);
	const asked = new Set(wanted);
	return {
		remove: [...held].filter((id) => !asked.has(id)),
		add: [...asked].filter((id) => !held.has(id))
	};
}
