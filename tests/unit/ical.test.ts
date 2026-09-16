import { describe, expect, it } from 'vitest';
import { fold, parseIcs, toIcs, toIcsCalendar, unescapeText } from '$lib/server/calendar/sync/ical';
import { hashSeries, type EventSeries, type SeriesException } from '$lib/server/calendar/series';

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

	// CalDAV shape: master plus one VEVENT per RECURRENCE-ID in one resource.
	it('writes the master and every exception into one resource', () => {
		const ics = toIcs(series);
		expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(3);
		expect((ics.match(/^UID:evt-2$/gm) ?? []).length).toBe(3);
		expect((ics.match(/RECURRENCE-ID/g) ?? []).length).toBe(2);
		expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=TU');
	});

	// RFC 5545: a removed occurrence is a cancelled RECURRENCE-ID, not a missing one.
	it('marks a cancelled occurrence rather than omitting it', () => {
		const ics = toIcs(series);
		expect(ics).toContain('STATUS:CANCELLED');
	});

	it('writes an all-day event as a DATE, not a DATE-TIME', () => {
		const ics = toIcs({ ...single, allDay: true });
		expect(ics).toMatch(/DTSTART;VALUE=DATE:\d{8}/);
		expect(ics).not.toMatch(/DTSTART;VALUE=DATE:\d{8}T/);
	});

	// RFC 5545 forbids TZID on a UTC value; a stricter client may refuse the resource.
	it('does not put a TZID on a UTC value', () => {
		const ics = toIcs(single);
		expect(ics).toContain('DTSTART:20260910T090000Z');
		expect(ics).not.toMatch(/DTSTART;[^:\r\n]*TZID/);
	});

	// Recurrence expands against wall-clock time; losing the zone drifts by an hour half the year.
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
	// RFC 5545: DTEND is EXCLUSIVE for a DATE value, so a one-day event on the
	// 10th carries DTEND of the 11th.
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
	// RFC 5545 caps a line at 75 octets; strict servers reject an unfolded one.
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

	// Folding counts OCTETS; splitting a multi-byte character mid-boundary breaks UTF-8.
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

	// Guards against reading the exclusive DTEND back as midnight, which shortened
	// every all-day event by a day and hashed as a false remote move.
	it('round-trips an all-day event', () => {
		const allDay = {
			...single,
			allDay: true,
			startsAt: '2026-02-28T00:00:00.000Z',
			endsAt: '2026-02-28T23:59:59.000Z'
		};
		const back = parseIcs(toIcs(allDay));
		expect(back!.allDay).toBe(true);
		expect({ startsAt: back!.startsAt, endsAt: back!.endsAt }).toEqual({
			startsAt: allDay.startsAt,
			endsAt: allDay.endsAt
		});
	});

	it('round-trips a long summary through folding', () => {
		const long = 'Č'.repeat(120);
		expect(parseIcs(toIcs({ ...single, title: long }))!.title).toBe(long);
	});

	it('returns null for something that is not a calendar', () => {
		expect(parseIcs('not an ics at all')).toBeNull();
	});
});

// A "this event only" edit can change more than the title and time; all-day and
// timezone overrides each change the SHAPE of the VEVENT block too.
describe('an occurrence that overrides more than its time', () => {
	const tagged: EventSeries = { ...series, category: 'household', exceptions: [] };
	const override = {
		recurrenceId: '2026-09-15T09:00:00.000Z',
		cancelled: false,
		startsAt: '2026-09-15T09:00:00.000Z',
		endsAt: '2026-09-15T09:30:00.000Z'
	};
	const withOverride = (over: Partial<SeriesException>): EventSeries => ({
		...tagged,
		exceptions: [{ ...override, ...over }]
	});

	it('writes an all-day override as a DATE while the series stays timed', () => {
		const block = toIcs(withOverride({ allDay: true, endsAt: '2026-09-15T23:59:59.000Z' }))
			.split('BEGIN:VEVENT')
			.find((part) => part.includes('RECURRENCE-ID'))!;
		expect(block).toContain('DTSTART;VALUE=DATE:20260915');
		// Exclusive end, same as the master: the 16th for a one-day event on the 15th.
		expect(block).toContain('DTEND;VALUE=DATE:20260916');
	});

	it.each([
		['a category', { category: 'health' } as Partial<SeriesException>],
		['a timezone', { tz: 'UTC' } as Partial<SeriesException>],
		['all-day', { allDay: true, endsAt: '2026-09-15T23:59:59.000Z' } as Partial<SeriesException>]
	])('round-trips %s the occurrence overrides', (_label, over) => {
		const back = parseIcs(toIcs(withOverride(over)));
		const [exception] = back!.exceptions;
		for (const [field, value] of Object.entries(over)) {
			if (field === 'endsAt') continue;
			expect({ [field]: exception[field as keyof SeriesException] }).toEqual({ [field]: value });
		}
	});

	// Guards against phantom overrides: a standalone VEVENT carries a zone and
	// category even when inherited, which reading them back as overrides would
	// falsely surface as a remote edit on the next pull.
	it('does not invent overrides for what the occurrence only inherited', () => {
		const [exception] = parseIcs(toIcs(withOverride({})))!.exceptions;
		expect({
			category: exception.category,
			allDay: exception.allDay,
			tz: exception.tz
		}).toEqual({ category: null, allDay: null, tz: null });
	});

	it('keeps the content hash stable across a full round trip', () => {
		for (const over of [{}, { category: 'health' }, { tz: 'UTC' }, { title: 'Recycling' }]) {
			const sent = withOverride(over);
			expect(hashSeries(parseIcs(toIcs(sent))!)).toBe(hashSeries(sent));
		}
	});

	// iCalendar can't distinguish "overrides to the same value" from inheriting,
	// so this reads back as inherit to keep the hash stable.
	it('reads an override equal to the series as inheriting it', () => {
		const [exception] = parseIcs(toIcs(withOverride({ title: tagged.title })))!.exceptions;
		expect(exception.title).toBeNull();
	});

	// Regression: an override's exclusive all-day end was not undone on parse,
	// unlike the master's, shortening it by a day and hashing as a remote edit.
	it('undoes the exclusive all-day end on an override too', () => {
		const allDaySeries: EventSeries = {
			...tagged,
			allDay: true,
			startsAt: '2026-09-01T00:00:00.000Z',
			endsAt: '2026-09-01T23:59:59.000Z',
			exceptions: [
				{
					recurrenceId: '2026-09-15T00:00:00.000Z',
					cancelled: false,
					startsAt: '2026-09-16T00:00:00.000Z',
					endsAt: '2026-09-16T23:59:59.000Z'
				}
			]
		};
		const [exception] = parseIcs(toIcs(allDaySeries))!.exceptions;
		expect(exception.endsAt).toBe('2026-09-16T23:59:59.000Z');
	});
});

describe('serialising many series as one document', () => {
	const feed = toIcsCalendar([single, { ...single, uid: 'evt-3', title: 'Vet' }], 'Continuum');

	it('wraps every event in one calendar', () => {
		expect(feed.match(/BEGIN:VCALENDAR/g)).toHaveLength(1);
		expect(feed.match(/BEGIN:VEVENT/g)).toHaveLength(2);
		expect(feed).toContain('X-WR-CALNAME:Continuum');
	});

	it('is the same serialiser a single resource goes through', () => {
		expect(toIcsCalendar([single])).toBe(toIcs(single));
	});

	it('gives every event an end, which the hand-rolled feed never did', () => {
		expect(feed.match(/DTEND/g)).toHaveLength(2);
	});

	it('escapes a comma in a title rather than replacing it', () => {
		const titled = toIcsCalendar([{ ...single, title: 'Vet, then dentist' }]);
		expect(titled).toContain('SUMMARY:Vet\\, then dentist');
		expect(parseIcs(titled)!.title).toBe('Vet, then dentist');
	});
});

describe('unescaping', () => {
	it('reverses each escape exactly once', () => {
		expect(unescapeText('A\\, b\\; c\\\\ d')).toBe('A, b; c\\ d');
		expect(unescapeText('one\\ntwo')).toBe('one\ntwo');
	});

	// An escaped backslash followed by an n is a literal backslash and an n, not a newline.
	it('does not treat an escaped backslash as starting a new escape', () => {
		expect(unescapeText('c\\\\nd')).toBe('c\\nd');
	});
});
