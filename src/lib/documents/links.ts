// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What a save changes about a document's links, and nothing more.
 *
 * The inspector used to delete every `document_link` a document had and
 * re-insert what the form posted. That is only safe if the form knows about
 * every kind of link, and it did not: the picker offered people, property and
 * subjects, so opening a receipt and pressing Save destroyed the transaction it
 * evidenced, a tax attachment lost its statement, and a bank statement lost the
 * account it came from — silently, with nothing on screen to say a link had
 * been there.
 *
 * So the form now carries the whole set (pickable kinds as checkboxes, the rest
 * as hidden inputs behind read-only chips) and the save is a subtraction rather
 * than a replacement. A link the form does not name IS removed — that is what
 * unticking a chip means — but the removal is now a decision somebody made on
 * screen rather than a side effect of what the picker happened to offer.
 *
 * Pure, and here rather than in the action, because this is the arithmetic the
 * bug lived in and it has to be reachable by a test without a database.
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
 * Both sides are de-duplicated: a `Set` keeps first-seen order, so the output
 * still reads in the order each side was given in, and inserting the same pair
 * twice — which the composite primary key would refuse — cannot happen.
 */
export function linkDiff(current: string[], wanted: string[]): LinkDiff {
	const held = new Set(current);
	const asked = new Set(wanted);
	return {
		remove: [...held].filter((id) => !asked.has(id)),
		add: [...asked].filter((id) => !held.has(id))
	};
}
