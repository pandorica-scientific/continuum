import { describe, expect, it } from 'vitest';
import { expand } from '$lib/calendar/rrule';

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
});
