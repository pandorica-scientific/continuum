// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What the Tags panel's delete confirmation says, taken out of the markup.
 *
 * `reach` only ever renders once a person has clicked the delete button, and
 * there is no browser suite in this repository to drive that click — so, the
 * way `documentExpiryTone` in `documents-view.ts` is, it is a pure function
 * with its own test rather than something only reachable through a page.
 */

interface TagReach {
	/** Documents, properties and loans — exactly what the item list shows. */
	tagged: number;
	/** Whole transactions carrying the tag directly — no card of their own. */
	transactions: number;
	/** Transaction splits carrying the tag — also no card of their own. */
	splitLines: number;
	/** Rules that apply the tag; the invisible half — one stops applying it. */
	rules: number;
}

/**
 * What a delete would reach, so the confirmation can say it rather than
 * leaving the reader to guess.
 *
 * The untag total counts every carrier the delete actually removes —
 * `tagged` plus the two kinds with no chip in the item list — never gated on
 * whether `tagged` itself is positive. A tag used only on a whole transaction
 * or only on a split line used to render nothing here at all, reading as
 * "nothing to lose" while `deleteTag`'s cascade quietly removed it anyway; a
 * total of zero now says so explicitly, "untags nothing", rather than leaving
 * the reader looking at a blank space beside "Delete?".
 */
export function reach(t: TagReach): string {
	const total = t.tagged + t.transactions + t.splitLines;
	const parts = [total > 0 ? `untags ${total}` : 'untags nothing'];
	if (t.rules > 0) parts.push(`${t.rules} ${t.rules === 1 ? 'rule' : 'rules'} stop applying it`);
	return parts.join(' · ');
}
