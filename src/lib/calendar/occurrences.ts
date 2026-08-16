// Turning a stored series into the occurrences a screen draws.
//
// Pure: rows in, occurrences out. The month grid and the sync engine both go
// through here, because two expansions that disagreed would show one thing and
// send another.

import { expand } from '$lib/calendar/rrule';

export interface SeriesRow {
	id: string;
	title: string;
	notes: string | null;
	category: string | null;
	allDay: boolean;
	startsAt: string;
	endsAt: string;
	tz: string;
	rrule: string | null;
}

export interface ExceptionRow {
	recurrenceId: string;
	cancelled: boolean;
	title: string | null;
	startsAt: string | null;
	endsAt: string | null;
	notes: string | null;
}

export interface Occurrence {
	eventId: string;
	/** The occurrence's ORIGINAL start — its identity, and what an edit is keyed on. */
	recurrenceId: string;
	/** Where it actually falls, which differs from recurrenceId once moved. */
	startsAt: string;
	endsAt: string;
	title: string;
	notes: string | null;
	category: string | null;
	allDay: boolean;
	/** Whether this belongs to a series, so the editor knows to ask about scope. */
	recurring: boolean;
	/** Whether this particular occurrence has been overridden. */
	overridden: boolean;
}

/**
 * Occurrences of one series inside [from, to], with exceptions applied.
 *
 * A moved occurrence keeps its ORIGINAL start as `recurrenceId` and reports the
 * new time in `startsAt`. Those must stay separate: RFC 5545 keys an override on
 * where the occurrence was, not where it went, and collapsing the two makes a
 * rescheduled occurrence reappear at its old slot on the next sync.
 */
export function occurrencesFor(
	event: SeriesRow,
	exceptions: ExceptionRow[],
	from: string,
	to: string
): Occurrence[] {
	const byRecurrenceId = new Map(
		exceptions.map((e) => [new Date(e.recurrenceId).toISOString(), e])
	);
	const durationMs = new Date(event.endsAt).getTime() - new Date(event.startsAt).getTime();

	const starts = expand(event.rrule ?? '', event.startsAt, event.tz, from, to);

	// A moved occurrence may land inside the window from a recurrence that fell
	// outside it, so the overrides are swept too rather than only the expansion.
	const movedIn = exceptions.filter((e) => {
		if (e.cancelled || !e.startsAt) return false;
		const original = new Date(e.recurrenceId).toISOString();
		if (starts.includes(original)) return false;
		const day = e.startsAt.slice(0, 10);
		return day >= from && day <= to;
	});

	const out: Occurrence[] = [];

	for (const start of [...starts, ...movedIn.map((e) => new Date(e.recurrenceId).toISOString())]) {
		const override = byRecurrenceId.get(start);
		if (override?.cancelled) continue;

		const startsAt = override?.startsAt ?? start;
		const endsAt =
			override?.endsAt ?? new Date(new Date(startsAt).getTime() + durationMs).toISOString();

		out.push({
			eventId: event.id,
			recurrenceId: start,
			startsAt: new Date(startsAt).toISOString(),
			endsAt: new Date(endsAt).toISOString(),
			// Null on an override means "inherit", which is why it cannot be stored
			// as an empty string: an override to nothing is a different statement.
			title: override?.title ?? event.title,
			notes: override?.notes ?? event.notes,
			category: event.category,
			allDay: event.allDay,
			recurring: Boolean(event.rrule),
			overridden: Boolean(override)
		});
	}

	return out.sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0));
}

/** Every series' occurrences in the window, in time order. */
export function allOccurrences(
	events: SeriesRow[],
	exceptions: Map<string, ExceptionRow[]>,
	from: string,
	to: string
): Occurrence[] {
	return events
		.flatMap((event) => occurrencesFor(event, exceptions.get(event.id) ?? [], from, to))
		.sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0));
}
