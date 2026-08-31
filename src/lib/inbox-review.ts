// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The Inbox review session: which document is in front of you, and what
 * happens when you skip it.
 *
 * Pure on purpose. There is no browser suite in this repository, and the two
 * behaviours worth holding — that a lap of skipping changes nothing, and that
 * the counter stops lying once everything left has been skipped — are exactly
 * the kind that rot silently inside a component.
 *
 * Skip NEVER files and never deletes. That is what makes it safe to press at
 * speed, which is the whole cadence this screen is built for.
 */

import { mayProposeType } from '$lib/documents';

/** The fields that carry over from the previous `File & next`. */
export type StickyField = 'shelf' | 'type';

export interface ReviewSession {
	/** Everything still waiting, in the order it will be offered. */
	queue: string[];
	/** Offered and passed over this session, in the order they were passed. */
	skipped: string[];
	/** Filed this session, oldest first. */
	filed: string[];
	/** What the next document starts with, carried from the last filing. */
	sticky: Partial<Record<StickyField, string>>;
	/** Which sticky values are still untouched, so the `kept` mark is honest. */
	kept: StickyField[];
	/** Which values the SHELF proposed rather than a person choosing them. */
	suggested: StickyField[];
	/** True once there is nothing left but documents already skipped. */
	done: boolean;
}

export function startSession(ids: string[]): ReviewSession {
	return {
		queue: [...ids],
		skipped: [],
		filed: [],
		sticky: {},
		kept: [],
		suggested: [],
		done: ids.length === 0
	};
}

export const currentId = (session: ReviewSession): string | null => session.queue[0] ?? null;

/**
 * Pass over the document in front of you.
 *
 * At the end of the queue it wraps to the first document skipped this session,
 * so a person who deferred three of them gets those three back rather than an
 * empty screen. Skipping one of those again ends the session: everything left
 * has now been looked at twice, and the Inbox keeps them.
 */
export function skip(session: ReviewSession): ReviewSession {
	const id = currentId(session);
	if (id === null) return { ...session, done: true };

	const rest = session.queue.slice(1);
	if (rest.length > 0) {
		return { ...session, queue: rest, skipped: [...session.skipped, id] };
	}

	// Nothing fresh left. Offer the skipped ones once more, in the order they
	// were skipped — unless this document was itself already skipped, in which
	// case the lap is complete.
	if (session.skipped.includes(id))
		return { ...session, queue: [], skipped: session.skipped, done: true };
	const wrapped = [...session.skipped];
	if (wrapped.length === 0) return { ...session, queue: [], skipped: [id], done: true };
	return { ...session, queue: wrapped, skipped: [...session.skipped, id] };
}

/**
 * File the document in front of you, and carry its shelf and type forward.
 *
 * A folder import is twenty near-identical documents, and sticky defaults make
 * that twenty presses of Enter. They cost nothing when the documents differ,
 * because changing a field clears its mark and the next one starts from the
 * value you actually chose.
 */
export function fileAndNext(
	session: ReviewSession,
	values: { shelfKey?: string; type?: string }
): ReviewSession {
	const id = currentId(session);
	if (id === null) return { ...session, done: true };
	const sticky = {
		...session.sticky,
		...(values.shelfKey ? { shelf: values.shelfKey } : {}),
		...(values.type ? { type: values.type } : {})
	};
	const kept = (['shelf', 'type'] as StickyField[]).filter((field) => sticky[field] !== undefined);
	const queue = session.queue.slice(1);
	return {
		...session,
		queue,
		filed: [...session.filed, id],
		sticky,
		kept,
		// A filing is a choice made; nothing carried into the next document was
		// proposed by a shelf.
		suggested: [],
		done: queue.length === 0 && session.skipped.length === 0
	};
}

/** Touching a sticky field is what clears its `kept` mark — nothing else does. */
export function setField(session: ReviewSession, field: StickyField, value: string): ReviewSession {
	return {
		...session,
		sticky: { ...session.sticky, [field]: value },
		kept: session.kept.filter((f) => f !== field),
		suggested: session.suggested.filter((f) => f !== field)
	};
}

/**
 * The type the chosen shelf expects, offered rather than imposed.
 *
 * Only fills a type nobody has decided yet — unset, or the `other` a fresh
 * session starts on. A value carried from the last filing is a choice somebody
 * made, and a shelf must not overwrite it: picking Identity for the second of
 * twenty certificates should not retype the first one's answer.
 *
 * Marked `suggested` rather than `kept`, because those are different claims:
 * one says "you chose this before", the other says "the shelf thinks so".
 */
export function proposeType(session: ReviewSession, type: string | undefined): ReviewSession {
	if (!type) return session;
	// The rule itself lives in `$lib/documents`, because the inspector's own
	// shelf picker has to follow it too and two spellings of "may I fill this
	// in" is two places for it to drift.
	if (!mayProposeType(session.sticky.type, session.suggested.includes('type'))) return session;
	return {
		...session,
		sticky: { ...session.sticky, type },
		kept: session.kept.filter((f) => f !== 'type'),
		suggested: [...session.suggested.filter((f) => f !== 'type'), 'type']
	};
}

export const suggestedFields = (session: ReviewSession): StickyField[] => session.suggested;

export const keptFields = (session: ReviewSession): StickyField[] => session.kept;

/**
 * What the counter says.
 *
 * Once everything left has been skipped, "0 remaining" would be a lie and
 * "3 remaining" would invite another lap. It says what is true instead.
 */
export function counterLabel(session: ReviewSession): string {
	const remaining = session.queue.filter((id) => !session.skipped.includes(id)).length;
	if (remaining > 0) return `${remaining} remaining`;
	if (session.skipped.length > 0) return `${session.skipped.length} skipped`;
	return 'Inbox is clear';
}
