import { describe, expect, it } from 'vitest';
import { expand } from '$lib/calendar/rrule';
import { merge } from '$lib/calendar/merge';
import { fromRemoteId, isGeneratedKey, overrideRemoteId, toRemoteId } from '$lib/calendar/keys';
import { parseIcs, toIcs } from '$lib/server/calendar/sync/ical';
import { toGoogleEvents } from '$lib/server/calendar/sync/google';
import type { EventSeries } from '$lib/server/calendar/series';

// Every case here is one that shipped broken and that the suite did not catch.
// Grouped by the thing that goes wrong rather than by the module, because what
// makes them worth keeping is the failure, not the function.

describe('recurrence expansion', () => {
	// FREQ=WEEKLY with no BYDAY is valid RFC 5545 and is what Apple Calendar and
	// several CalDAV clients emit. Matching on day-of-MONTH instead of weekday
	// made it expand roughly monthly, so a weekly event pulled from a connected
	// calendar lost three of every four occurrences — on screen and in the
	// published feed alike.
	it('expands a weekly rule with no BYDAY once a week, not once a month', () => {
		const out = expand('FREQ=WEEKLY', '2026-09-10T09:00:00Z', 'UTC', '2026-09-01', '2026-09-30');
		expect(out).toEqual([
			'2026-09-10T09:00:00.000Z',
			'2026-09-17T09:00:00.000Z',
			'2026-09-24T09:00:00.000Z'
		]);
	});

	it('honours INTERVAL on a weekly rule with no BYDAY', () => {
		const out = expand(
			'FREQ=WEEKLY;INTERVAL=2',
			'2026-09-10T09:00:00Z',
			'UTC',
			'2026-09-01',
			'2026-09-30'
		);
		expect(out).toEqual(['2026-09-10T09:00:00.000Z', '2026-09-24T09:00:00.000Z']);
	});

	// The window's two ends were read on different clocks: UTC midnight at the
	// start, zone-local end of day at the finish. That opens a hole the width of
	// the offset at the start of every window — in Prague an event at 00:30 on the
	// 1st appeared in neither that month nor the one before.
	it('sees an event in the offset gap at the start of a month exactly once', () => {
		const at = '2026-08-31T22:30:00Z'; // 00:30 on 1 September in Prague
		const september = expand('', at, 'Europe/Prague', '2026-09-01', '2026-09-30');
		const august = expand('', at, 'Europe/Prague', '2026-08-01', '2026-08-31');
		expect(september).toEqual([at.replace('Z', '.000Z')]);
		expect(august).toEqual([]);
	});
});

describe('merge', () => {
	const base = {
		localUpdatedAt: '2026-09-01T00:00:00.000Z',
		remoteUpdatedAt: '2026-09-01T00:00:00.000Z',
		dateOnlyChange: false,
		newDate: null,
		binding: null
	};

	// The trailing horizon moving is not a statement about the past. Pushing a
	// deletion when a generated event ages out of it removed one event per loan
	// per month from the household's own calendar, for good.
	it('leaves the remote alone when a generated event ages past the horizon', () => {
		expect(
			merge({ ...base, baseHash: 'h1', localHash: null, remoteHash: 'h1', generated: true })
		).toEqual({ kind: 'drop-link' });
	});

	// An authored event that was deleted here still has its deletion pushed —
	// the horizon rule must not have quietly disabled that.
	it('still pushes the deletion of an authored event', () => {
		expect(
			merge({ ...base, baseHash: 'h1', localHash: null, remoteHash: 'h1', generated: false })
		).toEqual({ kind: 'push-delete' });
	});

	it('still applies a genuine remote deletion of an authored event', () => {
		expect(
			merge({ ...base, baseHash: 'h1', localHash: 'h1', remoteHash: null, generated: false })
		).toEqual({ kind: 'apply-delete' });
	});
});

describe('remote ids', () => {
	// CalDAV reports a deletion as a path and nothing else. Turning that back into
	// the key it was built from is what stops the deletion matching nothing and
	// being dropped while the cursor advances past it.
	it('decodes a remote id back into the local key it came from', () => {
		for (const key of [
			'gen:loanPayments:loan:2f1c-4d:paymentDay:2026-09',
			'8f14e45f-ceea-467a-9575-1c1e3b0f5f01'
		]) {
			expect(fromRemoteId(toRemoteId(key))).toBe(key);
		}
	});

	// A resource another client named is not ours to decode. Inventing a key from
	// it would be worse than not matching at all.
	it('refuses a remote id it did not build', () => {
		expect(fromRemoteId('AB-CD-EF.ics')).toBeNull();
		expect(fromRemoteId('')).toBeNull();
	});

	it('tells a generated key from an authored one', () => {
		expect(isGeneratedKey('gen:loanPayments:loan:1:paymentDay:2026-09')).toBe(true);
		expect(isGeneratedKey('8f14e45f-ceea-467a-9575-1c1e3b0f5f01')).toBe(false);
	});

	// Google requires base32hex and refuses anything else with a bare 400, which
	// used to reject every recurring event that had an exception.
	it('builds override ids inside the alphabet Google accepts', () => {
		const id = overrideRemoteId(toRemoteId('evt-1'), '2026-09-15T09:00:00.000Z');
		expect(id).toMatch(/^[0-9a-v]+$/);
		expect(id.length).toBeGreaterThanOrEqual(5);
		expect(id.length).toBeLessThanOrEqual(1024);
	});

	// Keyed on the occurrence, so removing one override does not rename the
	// others and strand the events they used to name.
	it('keys an override id on the occurrence, not its position', () => {
		const remoteId = toRemoteId('evt-1');
		const second = overrideRemoteId(remoteId, '2026-09-22T09:00:00.000Z');
		expect(overrideRemoteId(remoteId, '2026-09-22T09:00:00.000Z')).toBe(second);
		expect(overrideRemoteId(remoteId, '2026-09-15T09:00:00.000Z')).not.toBe(second);
	});
});

describe('all-day round trip', () => {
	const generated: EventSeries = {
		uid: 'gen:loanPayments:loan:1:paymentDay:2026-02',
		title: 'Mortgage payment',
		notes: null,
		category: null,
		allDay: true,
		startsAt: '2026-02-28T00:00:00.000Z',
		endsAt: '2026-02-28T23:59:59.000Z',
		tz: 'UTC',
		rrule: null,
		exceptions: [],
		updatedAt: '2026-02-01T00:00:00.000Z'
	};

	// DTEND is exclusive, so a one-day event on the 28th is written as the 1st.
	// Reading it back as midnight rather than end of day made every generated
	// all-day event come back a day short — which hashed differently, which the
	// engine read as a remote DATE MOVE, which wrote a new payment day into the
	// loan on every single pass.
	it('reads its own DTEND back to the instant it was written from', () => {
		const back = parseIcs(toIcs(generated));
		expect(back?.startsAt).toBe(generated.startsAt);
		expect(back?.endsAt).toBe(generated.endsAt);
	});

	// The zone is part of the content hash, so an all-day event authored in Prague
	// that comes back saying UTC compares as changed on every pass.
	it('keeps the zone of an all-day event across a round trip', () => {
		const prague = { ...generated, tz: 'Europe/Prague' };
		expect(parseIcs(toIcs(prague))?.tz).toBe('Europe/Prague');
	});

	// The same event through Google's adapter, which was always correct — the two
	// providers have to agree or one of them invents a change on every pass.
	it('agrees with what the Google adapter writes and reads', () => {
		const [master] = toGoogleEvents(generated, 'abc12');
		expect(master.start?.date).toBe('2026-02-28');
		expect(master.end?.date).toBe('2026-03-01');
	});
});

describe('iCalendar timezones', () => {
	const timed: EventSeries = {
		uid: 'evt-1',
		title: 'Dentist',
		notes: null,
		category: null,
		allDay: false,
		startsAt: '2026-09-10T07:00:00.000Z', // 09:00 in Prague
		endsAt: '2026-09-10T08:00:00.000Z',
		tz: 'Europe/Prague',
		rrule: null,
		exceptions: [],
		updatedAt: '2026-09-01T00:00:00.000Z'
	};

	it('round-trips a timed event without an illegal TZID on a UTC value', () => {
		const ics = toIcs(timed);
		expect(ics).not.toMatch(/DTSTART;[^:\r\n]*TZID/);

		const back = parseIcs(ics);
		expect(back?.startsAt).toBe(timed.startsAt);
		expect(back?.tz).toBe('Europe/Prague');
	});

	// What most CalDAV clients actually send: wall-clock digits plus a TZID, with
	// no Z. Reading those digits as UTC puts the event out by the offset.
	it('reads another client TZID-plus-local-time correctly', () => {
		const foreign = [
			'BEGIN:VCALENDAR',
			'BEGIN:VEVENT',
			'UID:evt-2',
			'DTSTART;TZID=Europe/Prague:20260910T090000',
			'DTEND;TZID=Europe/Prague:20260910T100000',
			'SUMMARY:Dentist',
			'END:VEVENT',
			'END:VCALENDAR'
		].join('\r\n');

		const back = parseIcs(foreign);
		expect(back?.startsAt).toBe('2026-09-10T07:00:00.000Z');
		expect(back?.tz).toBe('Europe/Prague');
	});
});
