// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Why a row is in the queue, as one colour along the top of its card.
 *
 * The queue mixes questions that are not the same question. "Confirm this
 * pairing" and "two rules disagree about this" and "I have never seen this
 * payee" all arrived as identical grey cards, so a queue of fifty had to be
 * read one card at a time to find the ones worth thinking about. The colour
 * groups them, and the reason text under the name still says the rest.
 *
 * Deliberately a small closed set: five lanes people can learn, not one hue
 * per review reason. A reason that does not map to a lane of its own is
 * `unknown` — the honest answer, and the one whose colour says "look at me".
 */

export type ReviewLane = 'transfer' | 'suggested' | 'conflict' | 'returned' | 'unknown';

export interface LaneInput {
	/** This row is half of a proposed transfer pair awaiting confirmation. */
	isTransfer?: boolean;
	/** The categoriser's guess, if it had one. */
	suggestedCategoryId?: string | null;
	/** `transaction.review_reason`, as the matcher or a decision wrote it. */
	reason?: string | null;
}

export interface LaneStyle {
	lane: ReviewLane;
	/** The CSS custom property holding this lane's colour. */
	colour: string;
	/** What the lane means, for the legend and the card's accessible label. */
	label: string;
}

/**
 * Reasons a row is back in the queue because of a decision somebody made,
 * rather than because the app could not decide.
 *
 * Matched as a set rather than by substring: these strings are written in one
 * place each and a rename should show up here as a lane going quiet, not as a
 * silent partial match. All three are spelled out inline rather than
 * imported, because this module is also loaded by the Import page's client
 * bundle and their owners live under `$lib/server`, out of client code's
 * reach. Keep them in step by hand with `src/lib/server/import/transfer-decisions.ts`
 * (the first two reasons) and `src/lib/server/splits/index.ts` (the third).
 */
const RETURNED_REASONS = new Set([
	'not the same movement — give each a category',
	'no longer a transfer — pick a category',
	'split removed'
]);

const STYLES: Record<ReviewLane, Omit<LaneStyle, 'lane'>> = {
	// Confirming a match between two rows that already exist — a yes/no, not a
	// choice among categories, so it reads as its own kind of question.
	transfer: { colour: '--purple', label: 'transfer to confirm' },
	// The categoriser filled it in; the card is asking you to agree.
	suggested: { colour: '--green', label: 'category suggested' },
	// Two rules claim it and disagree. The one lane that cannot be cleared by
	// agreeing with the screen, so it gets the colour that stops the eye.
	conflict: { colour: '--red', label: 'rules disagree' },
	// Waiting on you because of an earlier decision of yours, not because
	// anything is unsure.
	returned: { colour: '--blue', label: 'sent back by you' },
	// Nothing recognised it.
	unknown: { colour: '--yellow', label: 'nothing recognised' }
};

export function reviewLane(row: LaneInput): ReviewLane {
	// A proposed pairing outranks everything: the question on the card is
	// "are these two the same movement", whatever else is known about the row.
	if (row.isTransfer) return 'transfer';
	const reason = row.reason ?? '';
	// The matcher writes the conflicting categories into the reason, so this is
	// a prefix rather than an equality.
	if (reason.startsWith('rules disagree')) return 'conflict';
	if (RETURNED_REASONS.has(reason)) return 'returned';
	if (row.suggestedCategoryId) return 'suggested';
	return 'unknown';
}

export function laneStyle(row: LaneInput): LaneStyle {
	const lane = reviewLane(row);
	return { lane, ...STYLES[lane] };
}

/**
 * The order the queue is worked in, best first.
 *
 * A transfer leads: it is a yes/no about two rows that already exist, and
 * answering it removes two cards rather than one. Then the rows that arrive
 * already filled in, which are a glance and a click each. A rule conflict and
 * a row sent back need real thought, so they sit behind the quick ones. The
 * unrecognised rows go last and stay last: there are hundreds of them, they
 * are the slowest to answer, and left in date order they buried everything
 * else.
 */
export const LANE_ORDER: readonly ReviewLane[] = [
	'transfer',
	'suggested',
	'conflict',
	'returned',
	'unknown'
];

const RANK = new Map(LANE_ORDER.map((lane, index) => [lane, index]));

/** Where a row sorts. Lower is nearer the top. */
export function laneRank(row: LaneInput): number {
	return RANK.get(reviewLane(row)) ?? LANE_ORDER.length;
}

/** Every lane with its colour, in the order the queue is worked in. */
export const LANE_LEGEND: LaneStyle[] = LANE_ORDER.map((lane) => ({ lane, ...STYLES[lane] }));
