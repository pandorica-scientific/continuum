// What "this event / this and following / all events" actually means to the data.
//
// Pure: given a scope, a rule and which occurrence was touched, it returns the
// shape of the change. The caller performs it. Keeping the decision separate
// from the writing is what makes the awkward middle case testable without a
// database — and the middle case is where this normally goes wrong.

import { expand, formatRrule, parseRrule, toBasicUtc } from '$lib/calendar/rrule';

export type EditScope = 'this' | 'following' | 'all';

type ScopePlan =
	/** Override or cancel one occurrence; the series is untouched. */
	| { kind: 'exception'; recurrenceId: string }
	/** Truncate the original series and begin a second one at the split. */
	| {
			kind: 'split';
			truncatedRrule: string;
			/** The rule the TAIL should carry — not the original one. */
			newSeriesRrule: string;
			newSeriesStart: string;
	  }
	/** Edit the series itself. */
	| { kind: 'series' };

/** YYYY-MM-DD, a whole number of days either side of an instant. */
function dayNear(iso: string, offsetDays: number): string {
	return new Date(new Date(iso).getTime() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

/**
 * How many occurrences the series had before the split.
 *
 * Only needed for a COUNTed rule, and only so the tail can carry what is LEFT of
 * that count. Copying the original rule onto the tail restarted the count from
 * zero, so a ten-occurrence series split after the second gave twelve.
 */
function occurrencesBefore(rrule: string, seriesStart: string, split: string, tz: string): number {
	const splitAt = new Date(split).getTime();
	return expand(rrule, seriesStart, tz, dayNear(seriesStart, -1), dayNear(split, 1)).filter(
		(at) => new Date(at).getTime() < splitAt
	).length;
}

/**
 * How to carry out an edit at the given scope.
 *
 * @param scope        what the person chose
 * @param rrule        the series' rule, or null/'' for a single event
 * @param recurrenceId the ORIGINAL start of the occurrence being edited
 * @param seriesStart  the series' first occurrence, when known
 * @param tz           the zone the rule is written in; only affects COUNT maths
 */
export function planScopeChange(
	scope: EditScope,
	rrule: string | null,
	recurrenceId: string,
	seriesStart?: string,
	tz = 'UTC'
): ScopePlan {
	// A single event has no occurrences to distinguish, so every scope means the
	// same thing. Returning 'exception' here would create an exception row
	// pointing at a series that does not recur.
	if (!rrule) return { kind: 'series' };
	if (scope === 'all') return { kind: 'series' };
	if (scope === 'this') return { kind: 'exception', recurrenceId };

	// Splitting at the first occurrence would leave the original with an UNTIL
	// before its own start — a series with no occurrences, which still has to be
	// carried and synced. Editing from the beginning is editing the whole thing.
	if (seriesStart && new Date(seriesStart).getTime() >= new Date(recurrenceId).getTime()) {
		return { kind: 'series' };
	}

	const parsed = parseRrule(rrule);
	if (!parsed) return { kind: 'series' };

	// UNTIL is inclusive, so it lands one second BEFORE the split occurrence.
	// Setting it to the occurrence itself would leave that occurrence in the old
	// series as well as starting the new one — the same event twice on one day.
	const until = new Date(new Date(recurrenceId).getTime() - 1000).toISOString();

	// What the tail still owes. A COUNT is a property of the whole series, so the
	// half that comes after the split carries the remainder — never the original
	// number, which is how ten occurrences became twelve.
	const taken =
		parsed.count === null || !seriesStart
			? 0
			: occurrencesBefore(rrule, seriesStart, recurrenceId, tz);

	return {
		kind: 'split',
		truncatedRrule: formatRrule({
			...parsed,
			// RFC 5545 forbids COUNT and UNTIL together. A counted series being
			// truncated has to give up its count, or the rule is invalid and a
			// strict CalDAV server rejects the event outright.
			count: null,
			until
		}),
		newSeriesRrule: formatRrule({
			...parsed,
			count: parsed.count === null ? null : Math.max(0, parsed.count - taken)
		}),
		newSeriesStart: recurrenceId
	};
}

/** Re-export so callers building an UNTIL by hand use the same formatting. */
export { toBasicUtc };
