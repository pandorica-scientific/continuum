import { createHash } from 'node:crypto';
import { strip } from '$lib/calendar/markers';

// The unit of sync: a series and every one of its exceptions, moved atomically.
//
// This is the shape both provider adapters speak, and it exists because the two
// providers disagree about exactly one thing. CalDAV keeps a recurring event and
// all its overrides in ONE resource — a single .ics with the master VEVENT plus
// one VEVENT per RECURRENCE-ID. Google gives each override its own event
// resource, tied back by recurringEventId. Making the transfer unit "the whole
// series" maps one-to-one onto CalDAV and turns Google's fan-out into the Google
// adapter's private problem, instead of a fork in the engine.
//
// Server-side: hashing uses node:crypto. Nothing in the browser needs either the
// hash or the canonical form — the merge (which is pure and client-safe) takes
// hashes as plain strings.

export interface SeriesException {
	/** The occurrence's ORIGINAL start; its identity, per RFC 5545. */
	recurrenceId: string;
	cancelled: boolean;
	title?: string | null;
	startsAt?: string | null;
	endsAt?: string | null;
	notes?: string | null;
	/** Null on all three means "inherit from the series", as it does above. */
	category?: string | null;
	allDay?: boolean | null;
	tz?: string | null;
}

export interface EventSeries {
	uid: string;
	title: string;
	notes: string | null;
	category: string | null;
	allDay: boolean;
	startsAt: string;
	endsAt: string;
	tz: string;
	rrule: string | null;
	exceptions: SeriesException[];
	/** The merge clock. Deliberately NOT part of the content hash. */
	updatedAt: string;
}

/** '' and null both mean "nothing here"; one spelling keeps the hash stable. */
function text(value: string | null | undefined): string {
	// \r\n → \n first: iCalendar folds with CRLF and Google returns LF, so the
	// same note round-trips through two providers with different line endings.
	return (value ?? '').replace(/\r\n/g, '\n').trim();
}

/** An instant, not the string it arrived as: one provider sends Z, another +00:00. */
function instant(value: string | null | undefined): string {
	if (!value) return '';
	const at = new Date(value);
	return Number.isNaN(at.getTime()) ? '' : at.toISOString();
}

/**
 * A deterministic string standing for everything about a series that counts as
 * content.
 *
 * `marker` is the decoration WE added on the way out, and is removed before
 * hashing. Passing it explicitly rather than stripping any leading emoji is what
 * lets an author's own emoji stay part of the content — otherwise renaming
 * "🎂 Birthday" to "🎈 Birthday" hashes the same, the merge sees nothing, and
 * the edit is silently lost.
 */
export function canonical(series: EventSeries, marker: string | null = null): string {
	const exceptions = series.exceptions
		.map((exception) => ({
			r: instant(exception.recurrenceId),
			c: exception.cancelled,
			t: text(exception.title),
			s: instant(exception.startsAt),
			e: instant(exception.endsAt),
			n: text(exception.notes),
			// Present ONLY when the occurrence actually overrides them. Adding three
			// unconditional keys would have changed the canonical form of every
			// series that has ever been pushed, so on the first pass after the
			// upgrade no stored hash would match, both sides would read as changed,
			// and the whole calendar would arrive as conflicts. An override to null
			// is not expressible here, and does not need to be: null IS inherit.
			...(exception.category != null ? { ca: text(exception.category) } : {}),
			...(exception.allDay != null ? { ad: exception.allDay } : {}),
			...(exception.tz != null ? { z: text(exception.tz) } : {})
		}))
		// Sorted, because Google returns overrides in no particular order and two
		// orderings of the same set are the same series.
		.sort((a, b) => (a.r < b.r ? -1 : a.r > b.r ? 1 : 0));

	// A fixed field order rather than JSON.stringify over the object: key order in
	// an object literal is not something to depend on across engines or providers.
	return JSON.stringify([
		text(strip(series.title, marker)),
		text(series.notes),
		text(series.category),
		series.allDay,
		instant(series.startsAt),
		instant(series.endsAt),
		text(series.tz),
		text(series.rrule),
		exceptions
	]);
}

/** sha256 of the canonical form, hex. The merge base and the change detector. */
export function hashSeries(series: EventSeries, marker: string | null = null): string {
	return createHash('sha256').update(canonical(series, marker)).digest('hex');
}
