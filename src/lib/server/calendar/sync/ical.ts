// SPDX-License-Identifier: AGPL-3.0-or-later
// iCalendar (RFC 5545) for the CalDAV adapter.
//
// Kept apart from the transport so the fiddly half — escaping, folding,
// RECURRENCE-ID, all-day versus timed — can be tested exhaustively without a
// server. Nearly every CalDAV interoperability problem is really a serialisation
// problem, and a server's response to a malformed body is a 400 with no useful
// detail.

import type { EventSeries, SeriesException } from '$lib/server/calendar/series';
import { instantOfWall, isKnownTimeZone } from '$lib/calendar/rrule';

const CRLF = '\r\n';
/** RFC 5545: a content line is at most 75 OCTETS, excluding the line break. */
const MAX_OCTETS = 75;

/**
 * Fold a content line to the octet limit.
 *
 * Counting octets rather than characters matters: "Č" is two bytes, so a
 * character-counted fold overshoots and a naive byte-counted one splits the
 * character in half and produces invalid UTF-8. Folding at a code-point boundary
 * while measuring bytes is what satisfies both.
 */
export function fold(line: string): string {
	if (Buffer.byteLength(line, 'utf8') <= MAX_OCTETS) return line;

	const out: string[] = [];
	let current = '';
	// A continuation line begins with one space, which counts towards its limit.
	let limit = MAX_OCTETS;

	for (const character of line) {
		const width = Buffer.byteLength(character, 'utf8');
		if (Buffer.byteLength(current, 'utf8') + width > limit) {
			out.push(current);
			current = '';
			limit = MAX_OCTETS - 1;
		}
		current += character;
	}
	if (current) out.push(current);

	return (
		out[0] +
		out
			.slice(1)
			.map((part) => `${CRLF} ${part}`)
			.join('')
	);
}

/** Undo folding: CRLF followed by one space or tab is a continuation. */
function unfold(text: string): string {
	return text.replace(/\r?\n[ \t]/g, '');
}

/** Escape the four characters that would otherwise end a property early. */
function escapeText(value: string): string {
	return value
		.replace(/\\/g, '\\\\')
		.replace(/;/g, '\\;')
		.replace(/,/g, '\\,')
		.replace(/\r?\n/g, '\\n');
}

/**
 * Reverse escapeText.
 *
 * One left-to-right pass rather than a chain of replaces: chained replacement
 * would turn an escaped backslash into the start of the next escape, so "c\\nd"
 * (a literal backslash, then n) would come back as a newline.
 */
export function unescapeText(value: string): string {
	let out = '';
	for (let i = 0; i < value.length; i++) {
		if (value[i] !== '\\') {
			out += value[i];
			continue;
		}
		const next = value[++i];
		if (next === 'n' || next === 'N') out += '\n';
		else if (next === undefined) out += '\\';
		else out += next;
	}
	return out;
}

/** 20260910T090000Z */
function utcStamp(iso: string): string {
	return new Date(iso)
		.toISOString()
		.replace(/[-:]/g, '')
		.replace(/\.\d{3}/, '');
}

/**
 * 20260910 — a date with no time, for all-day events.
 *
 * Reading the UTC date is correct because AN ALL-DAY EVENT IS HELD ANCHORED TO
 * UTC — 00:00:00.000Z through 23:59:59.000Z on its day — whatever zone the row
 * carries. That is the convention parseIcs below produces, the one the ledger's
 * generated events use, and (since this branch) the one the calendar form
 * writes. Anchoring an all-day event to the household's wall clock instead put
 * local midnight in the previous UTC day, and every consumer that reads a date
 * back off the instant then published it a day early.
 */
function dateStamp(iso: string): string {
	return new Date(iso).toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * The END of an all-day event, which RFC 5545 also treats as EXCLUSIVE: a
 * one-day event on the 1st carries DTEND of the 2nd. iCloud tolerates the same
 * date on both, but it is a zero-length event and other clients need not.
 */
function exclusiveEnd(iso: string): string {
	const day = new Date(iso);
	day.setUTCDate(day.getUTCDate() + 1);
	return day.toISOString();
}

/**
 * The exact inverse of exclusiveEnd, for reading a DTEND back.
 *
 * END OF THAT DAY, not its midnight: an all-day event is held internally as
 * 00:00:00 through 23:59:59. Landing on midnight makes every all-day event come
 * back twenty-four hours short, which hashes differently, which the engine reads
 * as a remote DATE MOVE — and for a generated event that writes a new payment
 * day into the loan on every single pass.
 */
function inclusiveEnd(iso: string, allDay: boolean): string {
	if (!allDay) return iso;
	const day = new Date(new Date(iso).getTime() - 86_400_000);
	return `${day.toISOString().slice(0, 10)}T23:59:59.000Z`;
}

/** Where the event's zone travels, since a UTC value may not carry a TZID. */
const TZ_PROPERTY = 'X-CONTINUUM-TZID';

function dateProperty(name: string, iso: string, allDay: boolean): string {
	// All-day is a DATE, deliberately without a time or a zone: an all-day event
	// carrying an instant lands on the wrong day either side of the date line.
	if (allDay) return `${name};VALUE=DATE:${dateStamp(iso)}`;
	// A bare UTC value, and NO TZID. RFC 5545 forbids TZID on a UTC value — the
	// two say contradictory things about what the digits mean — and this file was
	// emitting `DTSTART;TZID=Europe/Prague:20260910T070000Z` with no VTIMEZONE
	// component to define the zone either. Continuum's own round trip hid it
	// because parseStamp reads the Z and ignores the rest; a stricter client has
	// every right to refuse the whole resource.
	//
	// The zone still has to travel: recurrence expands against wall-clock time,
	// so a series that comes back as UTC drifts by an hour for half the year. It
	// goes in an X- property, which is the RFC's own extension mechanism.
	return `${name}:${utcStamp(iso)}`;
}

function eventBlock(
	series: EventSeries,
	exception: SeriesException | null,
	stamp: string
): string[] {
	const startsAt = exception?.startsAt ?? series.startsAt;
	const endsAt = exception?.endsAt ?? series.endsAt;
	const title = exception?.title ?? series.title;
	const notes = exception?.notes ?? series.notes;
	// An override may differ from its series in these three as well, and each one
	// changes how the block is WRITTEN rather than just what it says: all-day
	// picks DATE over DATE-TIME, and the zone decides what the digits mean. Taking
	// them from the series regardless published the occurrence in the wrong shape,
	// and there was nothing in the resource for the next pull to read them back
	// from — so the override was lost on the round trip.
	const allDay = exception?.allDay ?? series.allDay;
	const tz = exception?.tz ?? series.tz;
	const category = exception?.category ?? series.category;

	const lines = [
		'BEGIN:VEVENT',
		// The SAME uid on the master and every override. That is what ties them
		// together as one event; a distinct uid per override makes each one a
		// separate event that happens to fall on the same day.
		`UID:${escapeText(series.uid)}`,
		`DTSTAMP:${stamp}`
	];

	if (exception) {
		// The ORIGINAL start, never where the occurrence moved to.
		lines.push(dateProperty('RECURRENCE-ID', exception.recurrenceId, series.allDay));
	}

	lines.push(dateProperty('DTSTART', startsAt, allDay));
	lines.push(dateProperty('DTEND', allDay ? exclusiveEnd(endsAt) : endsAt, allDay));
	// On an all-day event too, even though its DATE value carries no time. The
	// zone is part of what the content hash covers, so an event authored in
	// Prague that comes back saying UTC compares as changed on every single pass —
	// push, echo, push — which is the exact loop this design exists to avoid.
	if (tz) lines.push(`${TZ_PROPERTY}:${escapeText(tz)}`);
	lines.push(`SUMMARY:${escapeText(title)}`);

	if (notes) lines.push(`DESCRIPTION:${escapeText(notes)}`);
	if (category) lines.push(`CATEGORIES:${escapeText(category)}`);
	if (!exception && series.rrule) lines.push(`RRULE:${series.rrule}`);
	// A removed occurrence is a CANCELLED override, not an absent one: leave it
	// out and the remote goes on expanding the rule and showing it.
	if (exception?.cancelled) lines.push('STATUS:CANCELLED');

	lines.push('END:VEVENT');
	return lines;
}

/**
 * Any number of series as ONE iCalendar document.
 *
 * The published feed used to build its own — its own PRODID, its own DTSTAMP,
 * its own idea of how to escape a summary (replace commas with spaces) and no
 * DTEND at all. Two serialisers for one format is two sets of interoperability
 * bugs, and only one of them had a matching parser: everything learned about
 * folding, escaping and exclusive all-day ends applied to the events we push and
 * not to the ones the household actually subscribes to.
 */
export function toIcsCalendar(all: EventSeries[], calendarName?: string): string {
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Continuum//calendar//EN',
		'CALSCALE:GREGORIAN',
		...(calendarName ? [`X-WR-CALNAME:${escapeText(calendarName)}`] : []),
		...all.flatMap((series) => {
			const stamp = utcStamp(series.updatedAt);
			return [
				...eventBlock(series, null, stamp),
				...series.exceptions.flatMap((exception) => eventBlock(series, exception, stamp))
			];
		}),
		'END:VCALENDAR'
	];
	return lines.map(fold).join(CRLF) + CRLF;
}

/** A whole series as one iCalendar resource — what CalDAV stores per event. */
export function toIcs(series: EventSeries): string {
	return toIcsCalendar([series]);
}

interface Property {
	name: string;
	params: Map<string, string>;
	value: string;
}

function parseLine(line: string): Property | null {
	const colon = line.indexOf(':');
	if (colon < 0) return null;
	const head = line.slice(0, colon);
	const value = line.slice(colon + 1);

	const [name, ...paramParts] = head.split(';');
	const params = new Map<string, string>();
	for (const part of paramParts) {
		const equals = part.indexOf('=');
		if (equals < 1) continue;
		// RFC 5545 lets a parameter value be quoted, and clients that write zone
		// names with spaces do quote them. Keeping the quotes stored the zone as
		// `"Europe/Prague"`, which Intl refuses.
		params.set(part.slice(0, equals).toUpperCase(), part.slice(equals + 1).replace(/^"|"$/g, ''));
	}
	return { name: name.toUpperCase(), params, value };
}

/**
 * An iCalendar date or date-time to an ISO instant.
 *
 * A value ending in Z is UTC and says so. A value with neither Z nor TZID is
 * floating local time, which has no better reading than UTC here. A value with a
 * TZID and no Z is wall-clock time in that zone — which is what most CalDAV
 * clients send — and reading its digits as UTC puts the event out by the offset.
 */
function parseStamp(property: Property): string | null {
	const value = property.value.trim();
	const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
	if (dateOnly) {
		const [, y, m, d] = dateOnly;
		return isoOrNull(`${y}-${m}-${d}T00:00:00.000Z`);
	}
	const full = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
	// Anything else is read as best it can be, and refused rather than thrown.
	// `new Date('').toISOString()` raises a RangeError, and parseIcs is called in
	// a bare loop over every pulled resource — so one VEVENT another client wrote
	// with a value these two patterns do not cover aborted the WHOLE pull, and
	// went on aborting it every pass until someone deleted that event by hand.
	if (!full) return isoOrNull(value);
	const [, y, m, d, hh, mm, ss, zulu] = full;

	const tzid = property.params.get('TZID');
	if (!zulu && tzid && isKnownTimeZone(tzid)) {
		try {
			return instantOfWall(
				{
					year: Number(y),
					month: Number(m),
					day: Number(d),
					hour: Number(hh),
					minute: Number(mm),
					second: Number(ss)
				},
				tzid
			).toISOString();
		} catch {
			// An unknown zone name. Fall through to the UTC reading rather than
			// dropping the event.
		}
	}

	return isoOrNull(`${y}-${m}-${d}T${hh}:${mm}:${ss}.000Z`);
}

/** An ISO instant, or null when the value is not a date at all. */
function isoOrNull(value: string): string | null {
	const at = new Date(value);
	return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

/**
 * Parse one iCalendar resource back into a series.
 *
 * The VEVENT carrying no RECURRENCE-ID is the master; every other one is an
 * override of it. Returns null for anything that is not a calendar at all,
 * because a server occasionally answers a REPORT with an error document.
 */
export function parseIcs(text: string): EventSeries | null {
	if (!text.includes('BEGIN:VCALENDAR')) return null;

	const lines = unfold(text).split(/\r?\n/);
	const blocks: Property[][] = [];
	let current: Property[] | null = null;

	for (const raw of lines) {
		const line = raw.trimEnd();
		if (line === 'BEGIN:VEVENT') current = [];
		else if (line === 'END:VEVENT') {
			if (current) blocks.push(current);
			current = null;
		} else if (current) {
			const property = parseLine(line);
			if (property) current.push(property);
		}
	}
	if (blocks.length === 0) return null;

	const find = (block: Property[], name: string) => block.find((p) => p.name === name);
	const isOverride = (block: Property[]) => Boolean(find(block, 'RECURRENCE-ID'));

	const master = blocks.find((block) => !isOverride(block)) ?? blocks[0];
	const start = find(master, 'DTSTART');
	if (!start) return null;

	const allDay = start.params.get('VALUE') === 'DATE';
	const end = find(master, 'DTEND');

	// A zone Intl does not recognise — a Windows name like "W. Europe Standard
	// Time", say — is worse than none: it is stored on the row, and every later
	// expansion reads it back, so one imported event made the calendar screen
	// throw with nothing on it to reach the event and correct it.
	//
	// TZID first, for an event another client wrote; our own X- property next,
	// since a UTC value may not legally carry a TZID.
	const readTz = (block: Property[], stamp: Property | undefined): string => {
		const declared = stamp?.params.get('TZID') ?? find(block, TZ_PROPERTY)?.value.trim() ?? 'UTC';
		return isKnownTimeZone(declared) ? declared : 'UTC';
	};
	const masterTz = readTz(master, start);
	const masterCategory = find(master, 'CATEGORIES')
		? unescapeText(find(master, 'CATEGORIES')!.value)
		: null;
	const masterTitle = unescapeText(find(master, 'SUMMARY')?.value ?? '');
	const masterNotes = find(master, 'DESCRIPTION')
		? unescapeText(find(master, 'DESCRIPTION')!.value)
		: null;

	const exceptions: SeriesException[] = [];
	for (const block of blocks.filter(isOverride)) {
		const recurrenceId = parseStamp(find(block, 'RECURRENCE-ID')!);
		// An override whose RECURRENCE-ID cannot be read names no occurrence, so it
		// is dropped rather than stored against an empty key.
		if (!recurrenceId) continue;
		const overrideStart = find(block, 'DTSTART');
		const overrideEndProperty = find(block, 'DTEND');
		const summary = find(block, 'SUMMARY');
		const description = find(block, 'DESCRIPTION');

		// Stored ONLY where the override genuinely departs from the master.
		//
		// Every override block carries a summary, a zone and a category, because it
		// has to stand alone as a VEVENT — including the ones it merely inherited.
		// Reading them back as overrides turns our own push into a difference on
		// the very next pull: the hash we stored says "inherits", the hash of what
		// came back says "overrides", and the merge can only call that a remote
		// edit. It then writes the inherited values in as real overrides, so a
		// later rename of the series stops reaching that occurrence — a cancelled
		// occurrence, which never carries a title of its own, acquired one on the
		// first pass after it was created. Diffing against the master closes it.
		const overrideAllDay = overrideStart ? overrideStart.params.get('VALUE') === 'DATE' : allDay;
		const overrideTz = readTz(block, overrideStart);
		const overrideCategory = find(block, 'CATEGORIES')
			? unescapeText(find(block, 'CATEGORIES')!.value)
			: null;

		// Undone on an override too, not only on the master. An all-day occurrence
		// is written with the same exclusive DTEND, so reading it raw made every
		// override of an all-day series come back a day short of what we sent.
		const rawOverrideEnd = overrideEndProperty ? parseStamp(overrideEndProperty) : null;
		const overrideTitle = summary ? unescapeText(summary.value) : null;
		const overrideNotes = description ? unescapeText(description.value) : null;

		exceptions.push({
			recurrenceId,
			cancelled: find(block, 'STATUS')?.value.trim().toUpperCase() === 'CANCELLED',
			title: overrideTitle === masterTitle ? null : overrideTitle,
			startsAt: overrideStart ? parseStamp(overrideStart) : null,
			endsAt: rawOverrideEnd ? inclusiveEnd(rawOverrideEnd, overrideAllDay) : null,
			notes: overrideNotes === masterNotes ? null : overrideNotes,
			category: overrideCategory === masterCategory ? null : overrideCategory,
			allDay: overrideAllDay === allDay ? null : overrideAllDay,
			tz: overrideTz === masterTz ? null : overrideTz
		});
	}

	const startsAt = parseStamp(start);
	// A start that cannot be read is not an event. Returning null here refuses
	// the one resource instead of throwing out of the whole pull.
	if (!startsAt) return null;

	// DTEND is OPTIONAL. RFC 5545 says a DATE-valued DTSTART with no DTEND is a
	// ONE-DAY event — so the end is the start plus a day, and subtracting a day
	// from the start (which is what falling back to DTSTART did) produced an
	// event ending twenty-four hours before it began. Any client that omits
	// DTEND, or sends DURATION instead, hit it.
	const rawEnd = end ? parseStamp(end) : null;
	const endsAt = rawEnd ?? (allDay ? exclusiveEnd(startsAt) : startsAt);

	return {
		uid: unescapeText(find(master, 'UID')?.value ?? ''),
		title: masterTitle,
		notes: masterNotes,
		category: masterCategory,
		allDay,
		startsAt,
		// Undo the exclusive end, or every round trip shortens the event by a day.
		endsAt: inclusiveEnd(endsAt, allDay),
		tz: masterTz,
		rrule: find(master, 'RRULE')?.value.trim() ?? null,
		exceptions,
		updatedAt:
			(find(master, 'DTSTAMP') ? parseStamp(find(master, 'DTSTAMP')!) : null) ??
			new Date(0).toISOString()
	};
}
