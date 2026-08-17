import { describe, expect, it } from 'vitest';
import { expand, formatRrule, isKnownTimeZone, localDate, parseRrule } from '$lib/calendar/rrule';

describe('RRULE expansion', () => {
	it('expands a weekly rule on a chosen weekday', () => {
		const out = expand(
			'FREQ=WEEKLY;BYDAY=TU',
			'2026-09-01T09:00:00Z',
			'UTC',
			'2026-09-01',
			'2026-09-30'
		);
		expect(out).toEqual([
			'2026-09-01T09:00:00.000Z',
			'2026-09-08T09:00:00.000Z',
			'2026-09-15T09:00:00.000Z',
			'2026-09-22T09:00:00.000Z',
			'2026-09-29T09:00:00.000Z'
		]);
	});

	it('expands several weekdays in one rule, in date order', () => {
		const out = expand(
			'FREQ=WEEKLY;BYDAY=MO,WE',
			'2026-09-01T09:00:00Z',
			'UTC',
			'2026-09-01',
			'2026-09-14'
		);
		expect(out).toEqual([
			'2026-09-02T09:00:00.000Z',
			'2026-09-07T09:00:00.000Z',
			'2026-09-09T09:00:00.000Z',
			'2026-09-14T09:00:00.000Z'
		]);
	});

	// THE REASON tz IS A COLUMN. Europe/Prague leaves summer time on 2026-10-25.
	// A 09:00 local event must stay 09:00 local: 07:00Z while CEST (+02:00), then
	// 08:00Z once CET (+01:00). Expanding in UTC alone would keep emitting 07:00Z
	// and quietly shift the event an hour for half the year.
	it('holds local wall-clock time across a DST transition', () => {
		const out = expand(
			'FREQ=WEEKLY;BYDAY=SU',
			'2026-10-18T07:00:00Z',
			'Europe/Prague',
			'2026-10-18',
			'2026-11-01'
		);
		expect(out).toEqual([
			'2026-10-18T07:00:00.000Z',
			'2026-10-25T08:00:00.000Z',
			'2026-11-01T08:00:00.000Z'
		]);
	});

	it('applies INTERVAL', () => {
		const out = expand(
			'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU',
			'2026-09-01T09:00:00Z',
			'UTC',
			'2026-09-01',
			'2026-10-31'
		);
		expect(out).toEqual([
			'2026-09-01T09:00:00.000Z',
			'2026-09-15T09:00:00.000Z',
			'2026-09-29T09:00:00.000Z',
			'2026-10-13T09:00:00.000Z',
			'2026-10-27T09:00:00.000Z'
		]);
	});

	// RFC 5545: a BYMONTHDAY that a month does not have is SKIPPED, never rolled
	// forward. February has no 31st, so the February occurrence simply does not
	// exist — it must not appear on 1 or 3 March.
	it('skips a monthly-by-date occurrence in a month too short for it', () => {
		const out = expand(
			'FREQ=MONTHLY;BYMONTHDAY=31',
			'2026-01-31T09:00:00Z',
			'UTC',
			'2026-01-01',
			'2026-04-30'
		);
		expect(out).toEqual(['2026-01-31T09:00:00.000Z', '2026-03-31T09:00:00.000Z']);
	});

	it('expands monthly by weekday position — the second Tuesday', () => {
		const out = expand(
			'FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2',
			'2026-09-08T09:00:00Z',
			'UTC',
			'2026-09-01',
			'2026-11-30'
		);
		expect(out).toEqual([
			'2026-09-08T09:00:00.000Z',
			'2026-10-13T09:00:00.000Z',
			'2026-11-10T09:00:00.000Z'
		]);
	});

	it('expands the last Friday of the month with a negative BYSETPOS', () => {
		const out = expand(
			'FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1',
			'2026-09-25T09:00:00Z',
			'UTC',
			'2026-09-01',
			'2026-10-31'
		);
		expect(out).toEqual(['2026-09-25T09:00:00.000Z', '2026-10-30T09:00:00.000Z']);
	});

	it('treats UNTIL as inclusive', () => {
		const out = expand(
			'FREQ=DAILY;UNTIL=20260903T090000Z',
			'2026-09-01T09:00:00Z',
			'UTC',
			'2026-09-01',
			'2026-09-30'
		);
		expect(out).toEqual([
			'2026-09-01T09:00:00.000Z',
			'2026-09-02T09:00:00.000Z',
			'2026-09-03T09:00:00.000Z'
		]);
	});

	// COUNT counts occurrences from DTSTART, not occurrences inside the window.
	// Counting within the window would make a rule return different totals
	// depending on which month you happened to be looking at.
	it('counts COUNT from the series start, not from the window', () => {
		const all = expand(
			'FREQ=DAILY;COUNT=3',
			'2026-09-01T09:00:00Z',
			'UTC',
			'2026-09-01',
			'2026-09-30'
		);
		expect(all).toHaveLength(3);
		const later = expand(
			'FREQ=DAILY;COUNT=3',
			'2026-09-01T09:00:00Z',
			'UTC',
			'2026-09-03',
			'2026-09-30'
		);
		expect(later).toEqual(['2026-09-03T09:00:00.000Z']);
	});

	it('expands yearly', () => {
		const out = expand('FREQ=YEARLY', '2026-03-14T09:00:00Z', 'UTC', '2026-01-01', '2029-01-01');
		expect(out).toEqual([
			'2026-03-14T09:00:00.000Z',
			'2027-03-14T09:00:00.000Z',
			'2028-03-14T09:00:00.000Z'
		]);
	});

	it('returns the single start for an empty rule', () => {
		expect(expand('', '2026-09-01T09:00:00Z', 'UTC', '2026-09-01', '2026-09-30')).toEqual([
			'2026-09-01T09:00:00.000Z'
		]);
	});

	it('returns nothing when the series starts after the window', () => {
		expect(expand('FREQ=DAILY', '2026-12-01T09:00:00Z', 'UTC', '2026-09-01', '2026-09-30')).toEqual(
			[]
		);
	});

	// A daily rule with no COUNT and no UNTIL is infinite. The window bounds the
	// output, but a caller passing a decade-wide window must not hang the request
	// — it must fail loudly instead.
	it('refuses to walk an unbounded rule past its iteration cap', () => {
		expect(() =>
			expand('FREQ=DAILY', '1900-01-01T09:00:00Z', 'UTC', '1900-01-01', '2200-01-01')
		).toThrow(/too many occurrences/i);
	});

	// WEEKS RUN MONDAY→SUNDAY. The epoch is a Thursday, so bucketing by
	// `time / 604800000` put the Monday and the Friday of one calendar week into
	// different weeks — and with INTERVAL=2 that pushed every Friday a week late.
	// Only a single-weekday interval rule was covered before, which is exactly the
	// shape that cannot see it.
	it('measures a multi-weekday interval from Monday, not from the epoch', () => {
		expect(
			expand(
				'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR',
				'2026-01-05T09:00:00Z',
				'UTC',
				'2026-01-01',
				'2026-02-15'
			)
		).toEqual([
			'2026-01-05T09:00:00.000Z',
			'2026-01-09T09:00:00.000Z',
			'2026-01-19T09:00:00.000Z',
			'2026-01-23T09:00:00.000Z',
			'2026-02-02T09:00:00.000Z',
			'2026-02-06T09:00:00.000Z'
		]);
	});

	// Google and Apple both write "monthly on the second Tuesday" this way. The
	// ordinal prefix was filtered out as an unknown weekday code, which left the
	// rule with no BYDAY and no BYMONTHDAY — so it fell through to "the day of the
	// month the series started on" and an imported series recurred on the 13th.
	it('honours a BYDAY ordinal prefix', () => {
		expect(
			expand('FREQ=MONTHLY;BYDAY=2TU', '2026-01-13T09:00:00Z', 'UTC', '2026-03-01', '2026-03-31')
		).toEqual(['2026-03-10T09:00:00.000Z']);
	});

	it('honours a negative BYDAY ordinal', () => {
		expect(
			expand('FREQ=MONTHLY;BYDAY=-1FR', '2026-01-30T09:00:00Z', 'UTC', '2026-03-01', '2026-03-31')
		).toEqual(['2026-03-27T09:00:00.000Z']);
	});

	it('round-trips an ordinal BYDAY through parse and format', () => {
		expect(formatRrule(parseRrule('FREQ=MONTHLY;BYDAY=2TU')!)).toBe('FREQ=MONTHLY;BYDAY=2TU');
	});

	// Math.max(0, NaN) is NaN, and `emitted >= NaN` is false forever — so a
	// malformed COUNT silently REMOVED the limit rather than being ignored, and
	// formatRrule then wrote `COUNT=NaN` back out for a provider to reject.
	it('ignores a COUNT that is not a number', () => {
		expect(parseRrule('FREQ=DAILY;COUNT=x')?.count).toBeNull();
		expect(formatRrule(parseRrule('FREQ=DAILY;COUNT=x')!)).toBe('FREQ=DAILY');
	});

	// A zone name arrives from other people's calendars, not only from this app.
	// Intl throws a RangeError on one it does not know, and every read path
	// expands through here — so one imported Outlook event used to 500 the whole
	// calendar screen, with nothing on it to reach the event and correct it.
	it('falls back to UTC for a zone Intl does not recognise', () => {
		expect(isKnownTimeZone('Europe/Prague')).toBe(true);
		expect(isKnownTimeZone('W. Europe Standard Time')).toBe(false);
		expect(() =>
			expand(
				'FREQ=DAILY;COUNT=1',
				'2026-09-10T09:00:00Z',
				'W. Europe Standard Time',
				'2026-09-01',
				'2026-09-30'
			)
		).not.toThrow();
	});

	// The inverse of instantOfWall's date half, and the reason `slice(0, 10)` is
	// not it: in a zone ahead of UTC an event at local midnight reports the day
	// before.
	it('reads a calendar date on the event own clock', () => {
		expect(localDate('2026-09-09T22:00:00.000Z', 'Europe/Prague')).toBe('2026-09-10');
		expect(localDate('2026-09-09T22:00:00.000Z', 'UTC')).toBe('2026-09-09');
	});
});
