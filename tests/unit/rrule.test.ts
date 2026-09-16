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

	// A 09:00 local event must stay 09:00 local across the DST transition: 07:00Z
	// while CEST, then 08:00Z once CET. Expanding in UTC alone would shift it an hour.
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

	// RFC 5545: a BYMONTHDAY a month doesn't have is SKIPPED, never rolled forward.
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

	// An unbounded rule with a decade-wide window must fail loudly, not hang.
	it('refuses to walk an unbounded rule past its iteration cap', () => {
		expect(() =>
			expand('FREQ=DAILY', '1900-01-01T09:00:00Z', 'UTC', '1900-01-01', '2200-01-01')
		).toThrow(/too many occurrences/i);
	});

	// Regression: bucketing weeks by `time / 604800000` (epoch is a Thursday) split
	// a Mon/Fri week across two buckets, pushing every Friday a week late under INTERVAL=2.
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

	// Regression: the BYDAY ordinal prefix was filtered out as an unknown weekday
	// code, so an imported "second Tuesday" series fell back to the start date's day.
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

	// Regression: `emitted >= NaN` is always false, so a malformed COUNT silently
	// removed the limit instead of being ignored, and round-tripped as COUNT=NaN.
	it('ignores a COUNT that is not a number', () => {
		expect(parseRrule('FREQ=DAILY;COUNT=x')?.count).toBeNull();
		expect(formatRrule(parseRrule('FREQ=DAILY;COUNT=x')!)).toBe('FREQ=DAILY');
	});

	// Regression: Intl throws on an unrecognized zone name (e.g. from Outlook),
	// and every read path expands through here, so it must fall back instead of 500ing.
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

	// `slice(0, 10)` is wrong here: in a zone ahead of UTC, local midnight reports the day before.
	it('reads a calendar date on the event own clock', () => {
		expect(localDate('2026-09-09T22:00:00.000Z', 'Europe/Prague')).toBe('2026-09-10');
		expect(localDate('2026-09-09T22:00:00.000Z', 'UTC')).toBe('2026-09-09');
	});
});
