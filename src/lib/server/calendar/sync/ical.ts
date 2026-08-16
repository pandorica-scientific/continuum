// iCalendar (RFC 5545) for the CalDAV adapter.
//
// Kept apart from the transport so the fiddly half — escaping, folding,
// RECURRENCE-ID, all-day versus timed — can be tested exhaustively without a
// server. Nearly every CalDAV interoperability problem is really a serialisation
// problem, and a server's response to a malformed body is a 400 with no useful
// detail.

import type { EventSeries, SeriesException } from '$lib/server/calendar/series';

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
export function escapeText(value: string): string {
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

/** 20260910 — a date with no time, for all-day events. */
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

function dateProperty(name: string, iso: string, allDay: boolean, tz: string): string {
	// All-day is a DATE, deliberately without a time or a zone: an all-day event
	// carrying an instant lands on the wrong day either side of the date line.
	if (allDay) return `${name};VALUE=DATE:${dateStamp(iso)}`;
	// TZID names the zone the wall-clock time belongs to. The value stays UTC so
	// a server that does not know the zone still places the instant correctly.
	return `${name};TZID=${tz}:${utcStamp(iso)}`;
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
		lines.push(dateProperty('RECURRENCE-ID', exception.recurrenceId, series.allDay, series.tz));
	}

	lines.push(dateProperty('DTSTART', startsAt, series.allDay, series.tz));
	lines.push(
		dateProperty('DTEND', series.allDay ? exclusiveEnd(endsAt) : endsAt, series.allDay, series.tz)
	);
	lines.push(`SUMMARY:${escapeText(title)}`);

	if (notes) lines.push(`DESCRIPTION:${escapeText(notes)}`);
	if (series.category) lines.push(`CATEGORIES:${escapeText(series.category)}`);
	if (!exception && series.rrule) lines.push(`RRULE:${series.rrule}`);
	// A removed occurrence is a CANCELLED override, not an absent one: leave it
	// out and the remote goes on expanding the rule and showing it.
	if (exception?.cancelled) lines.push('STATUS:CANCELLED');

	lines.push('END:VEVENT');
	return lines;
}

/** A whole series as one iCalendar resource. */
export function toIcs(series: EventSeries): string {
	const stamp = utcStamp(series.updatedAt);
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Continuum//calendar//EN',
		'CALSCALE:GREGORIAN',
		...eventBlock(series, null, stamp),
		...series.exceptions.flatMap((exception) => eventBlock(series, exception, stamp)),
		'END:VCALENDAR'
	];
	return lines.map(fold).join(CRLF) + CRLF;
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
		if (equals > 0) params.set(part.slice(0, equals).toUpperCase(), part.slice(equals + 1));
	}
	return { name: name.toUpperCase(), params, value };
}

/** An iCalendar date or date-time to an ISO instant. */
function parseStamp(property: Property): string {
	const value = property.value.trim();
	const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
	if (dateOnly) {
		const [, y, m, d] = dateOnly;
		return new Date(`${y}-${m}-${d}T00:00:00.000Z`).toISOString();
	}
	const full = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
	if (!full) return new Date(value).toISOString();
	const [, y, m, d, hh, mm, ss] = full;
	return new Date(`${y}-${m}-${d}T${hh}:${mm}:${ss}.000Z`).toISOString();
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

	const exceptions: SeriesException[] = blocks.filter(isOverride).map((block) => {
		const recurrence = find(block, 'RECURRENCE-ID')!;
		const overrideStart = find(block, 'DTSTART');
		const overrideEnd = find(block, 'DTEND');
		const summary = find(block, 'SUMMARY');
		const description = find(block, 'DESCRIPTION');
		return {
			recurrenceId: parseStamp(recurrence),
			cancelled: find(block, 'STATUS')?.value.trim().toUpperCase() === 'CANCELLED',
			title: summary ? unescapeText(summary.value) : null,
			startsAt: overrideStart ? parseStamp(overrideStart) : null,
			endsAt: overrideEnd ? parseStamp(overrideEnd) : null,
			notes: description ? unescapeText(description.value) : null
		};
	});

	// Undo the exclusive end, or every round trip shortens the event by a day.
	const endsAt = end ? parseStamp(end) : parseStamp(start);
	const inclusiveEnd = allDay
		? new Date(new Date(endsAt).getTime() - 86_400_000).toISOString()
		: endsAt;

	return {
		uid: unescapeText(find(master, 'UID')?.value ?? ''),
		title: unescapeText(find(master, 'SUMMARY')?.value ?? ''),
		notes: find(master, 'DESCRIPTION') ? unescapeText(find(master, 'DESCRIPTION')!.value) : null,
		category: find(master, 'CATEGORIES') ? unescapeText(find(master, 'CATEGORIES')!.value) : null,
		allDay,
		startsAt: parseStamp(start),
		endsAt: inclusiveEnd,
		tz: start.params.get('TZID') ?? 'UTC',
		rrule: find(master, 'RRULE')?.value.trim() ?? null,
		exceptions,
		updatedAt: find(master, 'DTSTAMP')
			? parseStamp(find(master, 'DTSTAMP')!)
			: new Date(0).toISOString()
	};
}
