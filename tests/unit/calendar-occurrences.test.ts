import { describe, expect, it } from 'vitest';
import {
	occurrencesFor,
	type ExceptionRow,
	type Occurrence,
	type SeriesRow
} from '$lib/calendar/occurrences';

const weekly: SeriesRow = {
	id: 'e1',
	title: 'Bin day',
	notes: null,
	category: 'household',
	allDay: false,
	startsAt: '2026-09-01T09:00:00.000Z',
	endsAt: '2026-09-01T09:30:00.000Z',
	tz: 'Europe/Prague',
	rrule: 'FREQ=WEEKLY;BYDAY=TU'
};

const exception = (over: Partial<ExceptionRow>): ExceptionRow => ({
	recurrenceId: '2026-09-15T09:00:00.000Z',
	cancelled: false,
	title: null,
	startsAt: null,
	endsAt: null,
	notes: null,
	category: null,
	allDay: null,
	tz: null,
	...over
});

describe('expanding a series into occurrences', () => {
	it('expands a plain series', () => {
		const out = occurrencesFor(weekly, [], '2026-09-01', '2026-09-30');
		expect(out).toHaveLength(5);
		expect(out[0].recurrenceId).toBe('2026-09-01T09:00:00.000Z');
		expect(out.every((o) => o.recurring)).toBe(true);
		expect(out.every((o) => !o.overridden)).toBe(true);
	});

	it('carries the series duration onto every occurrence', () => {
		const out = occurrencesFor(weekly, [], '2026-09-01', '2026-09-30');
		for (const o of out) {
			expect(new Date(o.endsAt).getTime() - new Date(o.startsAt).getTime()).toBe(30 * 60_000);
		}
	});

	it('drops a cancelled occurrence', () => {
		const out = occurrencesFor(
			weekly,
			[exception({ cancelled: true })],
			'2026-09-01',
			'2026-09-30'
		);
		expect(out).toHaveLength(4);
		expect(out.map((o) => o.recurrenceId)).not.toContain('2026-09-15T09:00:00.000Z');
	});

	// recurrenceId is where the occurrence WAS; startsAt is where it went. Keeping
	// them apart is what lets a second edit find the same override instead of
	// creating another one — and what stops the moved occurrence reappearing at
	// its old slot on the next sync.
	it('keeps the original start as the identity of a moved occurrence', () => {
		const out = occurrencesFor(
			weekly,
			[exception({ startsAt: '2026-09-16T11:00:00.000Z' })],
			'2026-09-01',
			'2026-09-30'
		);
		const moved = out.find((o) => o.recurrenceId === '2026-09-15T09:00:00.000Z');
		expect(moved).toBeDefined();
		expect(moved!.startsAt).toBe('2026-09-16T11:00:00.000Z');
		expect(moved!.overridden).toBe(true);
	});

	it('takes an overridden title and leaves the rest inheriting', () => {
		const out = occurrencesFor(
			weekly,
			[exception({ title: 'Recycling only' })],
			'2026-09-01',
			'2026-09-30'
		);
		expect(out.find((o) => o.recurrenceId === '2026-09-15T09:00:00.000Z')!.title).toBe(
			'Recycling only'
		);
		expect(out.find((o) => o.recurrenceId === '2026-09-01T09:00:00.000Z')!.title).toBe('Bin day');
	});

	// An occurrence moved from 30 September into 1 October must appear in October,
	// not vanish because its ORIGINAL date fell outside the window.
	it('includes an occurrence moved into the window from outside it', () => {
		const out = occurrencesFor(
			weekly,
			[
				exception({
					recurrenceId: '2026-09-29T09:00:00.000Z',
					startsAt: '2026-10-02T09:00:00.000Z',
					endsAt: '2026-10-02T09:30:00.000Z'
				})
			],
			'2026-10-01',
			'2026-10-31'
		);
		expect(out.map((o) => o.startsAt)).toContain('2026-10-02T09:00:00.000Z');
	});

	// The same "null means inherit" rule the title has always followed. These
	// three used to be read off the series regardless, so a "this event only"
	// edit that retagged or un-all-dayed one occurrence was accepted by the form
	// and then drawn from the series values anyway — the screen contradicted the
	// save, and nothing was pushed.
	it.each([
		['category', { category: 'health' }, (o: Occurrence) => o.category, 'household'],
		['all-day', { allDay: true }, (o: Occurrence) => o.allDay, false],
		['timezone', { tz: 'UTC' }, (o: Occurrence) => o.tz, 'Europe/Prague']
	])('takes an overridden %s and leaves the rest inheriting', (_label, over, read, inherited) => {
		const out = occurrencesFor(weekly, [exception(over)], '2026-09-01', '2026-09-30');
		const overridden = out.find((o) => o.recurrenceId === '2026-09-15T09:00:00.000Z')!;
		const untouched = out.find((o) => o.recurrenceId === '2026-09-01T09:00:00.000Z')!;
		expect(read(overridden)).toEqual(Object.values(over)[0]);
		expect(read(untouched)).toEqual(inherited);
	});

	// The grid places an occurrence by its LOCAL date, and an override that
	// re-zones changes which day that is.
	it('sweeps a moved occurrence into the window on its own zone', () => {
		const out = occurrencesFor(
			weekly,
			[
				exception({
					recurrenceId: '2026-09-29T09:00:00.000Z',
					// 00:30 on 1 October in Prague is still 30 September in UTC.
					startsAt: '2026-09-30T22:30:00.000Z',
					endsAt: '2026-09-30T23:00:00.000Z',
					tz: 'Europe/Prague'
				})
			],
			'2026-10-01',
			'2026-10-31'
		);
		expect(out.map((o) => o.startsAt)).toContain('2026-09-30T22:30:00.000Z');
	});

	it('handles a single event with no rule', () => {
		const single: SeriesRow = { ...weekly, rrule: null };
		const out = occurrencesFor(single, [], '2026-09-01', '2026-09-30');
		expect(out).toHaveLength(1);
		expect(out[0].recurring).toBe(false);
	});

	it('returns occurrences in time order', () => {
		const out = occurrencesFor(
			weekly,
			[exception({ startsAt: '2026-09-02T08:00:00.000Z' })],
			'2026-09-01',
			'2026-09-30'
		);
		const starts = out.map((o) => o.startsAt);
		expect([...starts].sort()).toEqual(starts);
	});
});
