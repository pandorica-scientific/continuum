import { describe, expect, it } from 'vitest';
import { fold, parseIcs, toIcs, unescapeText } from '$lib/server/calendar/sync/ical';
import type { EventSeries } from '$lib/server/calendar/series';

const single: EventSeries = {
	uid: 'evt-1',
	title: 'Dentist',
	notes: null,
	category: null,
	allDay: false,
	startsAt: '2026-09-10T09:00:00.000Z',
	endsAt: '2026-09-10T10:00:00.000Z',
	tz: 'Europe/Prague',
	rrule: null,
	exceptions: [],
	updatedAt: '2026-09-01T00:00:00.000Z'
};

const series: EventSeries = {
	...single,
	uid: 'evt-2',
	title: 'Bin day',
	rrule: 'FREQ=WEEKLY;BYDAY=TU',
	exceptions: [
		{
			recurrenceId: '2026-09-15T09:00:00.000Z',
			cancelled: false,
			title: 'Bin day (moved)',
			startsAt: '2026-09-16T11:00:00.000Z',
			endsAt: '2026-09-16T11:30:00.000Z',
			notes: null
		},
		{ recurrenceId: '2026-09-22T09:00:00.000Z', cancelled: true }
	]
};

describe('serialising a series', () => {
	it('writes one VCALENDAR with one VEVENT for a single event', () => {
		const ics = toIcs(single);
		expect(ics).toContain('BEGIN:VCALENDAR');
		expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(1);
		expect(ics).toContain('UID:evt-1');
		expect(ics).toContain('SUMMARY:Dentist');
	});

	// THE CalDAV SHAPE: a recurring event and every override live in ONE resource,
	// master plus one VEVENT per RECURRENCE-ID. Google splits these into separate
	// resources; keeping the transfer unit a whole series is what confines that
	// difference to the two adapters.
	it('writes the master and every exception into one resource', () => {
		const ics = toIcs(series);
		expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(3);
		expect((ics.match(/^UID:evt-2$/gm) ?? []).length).toBe(3);
		expect((ics.match(/RECURRENCE-ID/g) ?? []).length).toBe(2);
		expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=TU');
	});

	// RFC 5545 says a removed occurrence is a cancelled RECURRENCE-ID, not a
	// missing one. Simply omitting it leaves the remote expanding the rule and
	// showing the occurrence anyway.
	it('marks a cancelled occurrence rather than omitting it', () => {
		const ics = toIcs(series);
		expect(ics).toContain('STATUS:CANCELLED');
	});

	it('writes an all-day event as a DATE, not a DATE-TIME', () => {
		const ics = toIcs({ ...single, allDay: true });
		expect(ics).toMatch(/DTSTART;VALUE=DATE:\d{8}/);
		expect(ics).not.toMatch(/DTSTART;VALUE=DATE:\d{8}T/);
	});

	// RFC 5545 forbids TZID on a UTC value — the two say contradictory things
	// about what the digits mean — and no VTIMEZONE was written to define the zone
	// either. Continuum's own round trip hid it because parseStamp reads the Z; a
	// stricter client may refuse the whole resource.
	it('does not put a TZID on a UTC value', () => {
		const ics = toIcs(single);
		expect(ics).toContain('DTSTART:20260910T090000Z');
		expect(ics).not.toMatch(/DTSTART;[^:\r\n]*TZID/);
	});

	// The zone still has to travel: recurrence expands against wall-clock time, so
	// a series that comes back as UTC drifts by an hour for half the year.
	it('carries the timezone on a timed event', () => {
		expect(toIcs(single)).toContain('X-CONTINUUM-TZID:Europe/Prague');
		expect(parseIcs(toIcs(single))?.tz).toBe('Europe/Prague');
	});

	// A comma, semicolon or backslash left raw ends the property early, and
	// everything after it is parsed as iCalendar. A newline is worse.
	it('escapes the characters that would end a property early', () => {
		const ics = toIcs({ ...single, title: 'A, b; c\\ d', notes: 'line one\nline two' });
		expect(ics).toContain('SUMMARY:A\\, b\\; c\\\\ d');
		expect(ics).toContain('\\n');
		expect(ics).not.toMatch(/SUMMARY:A, b; c/);
	});

	it('separates lines with CRLF, as the format requires', () => {
		expect(toIcs(single)).toContain('\r\n');
	});
});

describe('all-day events', () => {
	// RFC 5545 treats DTEND as EXCLUSIVE for a DATE value: a one-day event on the
	// 10th carries DTEND of the 11th. iCloud tolerates the same date on both, but
	// it describes a zero-length event and other clients need not accept it.
	it('ends on the following day', () => {
		const ics = toIcs({ ...single, allDay: true });
		expect(ics).toContain('DTSTART;VALUE=DATE:20260910');
		expect(ics).toContain('DTEND;VALUE=DATE:20260911');
	});

	// And back: read as inclusive, every round trip would shorten it by a day.
	it('round-trips without losing a day', () => {
		const back = parseIcs(toIcs({ ...single, allDay: true }))!;
		expect(back.allDay).toBe(true);
		expect(back.startsAt.slice(0, 10)).toBe('2026-09-10');
		expect(back.endsAt.slice(0, 10)).toBe('2026-09-10');
	});

	it('survives several round trips unchanged', () => {
		let current = { ...single, allDay: true };
		for (let i = 0; i < 3; i++) current = parseIcs(toIcs(current))!;
		expect(current.startsAt.slice(0, 10)).toBe('2026-09-10');
		expect(current.endsAt.slice(0, 10)).toBe('2026-09-10');
	});

	it('leaves the end of a timed event alone', () => {
		const back = parseIcs(toIcs(single))!;
		expect(new Date(back.endsAt).toISOString()).toBe(single.endsAt);
	});
});

describe('line folding', () => {
	// RFC 5545 caps a line at 75 octets. A long summary that is not folded is
	// rejected outright by strict servers.
	it('folds a line longer than 75 octets', () => {
		const folded = fold('SUMMARY:' + 'x'.repeat(200));
		for (const line of folded.split('\r\n')) {
			expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
		}
	});

	it('continues a folded line with a single space', () => {
		const folded = fold('SUMMARY:' + 'x'.repeat(200));
		for (const line of folded.split('\r\n').slice(1)) {
			expect(line.startsWith(' ')).toBe(true);
		}
	});

	// Folding counts OCTETS, and a multi-byte character split across the boundary
	// produces bytes that are not valid UTF-8.
	it('never splits a multi-byte character', () => {
		const folded = fold('SUMMARY:' + 'č'.repeat(100));
		for (const line of folded.split('\r\n')) {
			expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
			expect(line).not.toContain('�');
		}
		expect(folded.replace(/\r\n /g, '')).toBe('SUMMARY:' + 'č'.repeat(100));
	});
});

describe('round trip', () => {
	it('parses back what it wrote, for a single event', () => {
		const back = parseIcs(toIcs(single));
		expect(back).not.toBeNull();
		expect(back!.uid).toBe('evt-1');
		expect(back!.title).toBe('Dentist');
		expect(new Date(back!.startsAt).toISOString()).toBe(single.startsAt);
		expect(back!.allDay).toBe(false);
	});

	it('parses back a series with its exceptions', () => {
		const back = parseIcs(toIcs(series));
		expect(back!.rrule).toBe('FREQ=WEEKLY;BYDAY=TU');
		expect(back!.exceptions).toHaveLength(2);

		const moved = back!.exceptions.find((e) => !e.cancelled);
		expect(moved!.title).toBe('Bin day (moved)');
		expect(new Date(moved!.recurrenceId).toISOString()).toBe('2026-09-15T09:00:00.000Z');
		expect(new Date(moved!.startsAt!).toISOString()).toBe('2026-09-16T11:00:00.000Z');

		expect(back!.exceptions.find((e) => e.cancelled)).toBeDefined();
	});

	it('round-trips text that needed escaping', () => {
		const awkward = { ...single, title: 'A, b; c\\ d', notes: 'one\ntwo' };
		const back = parseIcs(toIcs(awkward));
		expect(back!.title).toBe('A, b; c\\ d');
		expect(back!.notes).toBe('one\ntwo');
	});

	it('round-trips an all-day event', () => {
		const back = parseIcs(toIcs({ ...single, allDay: true }));
		expect(back!.allDay).toBe(true);
	});

	it('round-trips a long summary through folding', () => {
		const long = 'Č'.repeat(120);
		expect(parseIcs(toIcs({ ...single, title: long }))!.title).toBe(long);
	});

	it('returns null for something that is not a calendar', () => {
		expect(parseIcs('not an ics at all')).toBeNull();
	});
});

describe('unescaping', () => {
	it('reverses each escape exactly once', () => {
		expect(unescapeText('A\\, b\\; c\\\\ d')).toBe('A, b; c\\ d');
		expect(unescapeText('one\\ntwo')).toBe('one\ntwo');
	});

	// An escaped backslash followed by an n is a literal backslash and an n, not
	// a newline. Unescaping left to right in one pass is what gets this right.
	it('does not treat an escaped backslash as starting a new escape', () => {
		expect(unescapeText('c\\\\nd')).toBe('c\\nd');
	});
});
