import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '$lib/server/db/schema';
import { createEvent, deleteEvent, updateEvent } from '$lib/server/calendar/mutations';
import { expand } from '$lib/calendar/rrule';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';

let harness: Harness;
let testDb: TestDb;

const WEEKLY = 'FREQ=WEEKLY;BYDAY=TU';
const base = {
	title: 'Bin day',
	notes: null,
	category: 'household',
	allDay: false,
	startsAt: new Date('2026-09-01T09:00:00.000Z'),
	endsAt: new Date('2026-09-01T09:30:00.000Z'),
	tz: 'Europe/Prague',
	rrule: WEEKLY
};

beforeAll(async () => {
	harness = await startPostgres('calendar-mutations');
	testDb = harness.db;
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 60_000);

afterAll(async () => {
	await harness?.stop();
});

beforeEach(async () => {
	await harness.sql.unsafe('delete from calendar_event_exception; delete from calendar_event;');
});

async function seed() {
	const result = await createEvent(base, null, testDb);
	if (!result.ok) throw new Error(result.message);
	return result.id;
}

/** Occurrences the screen would draw for September, exceptions applied. */
async function septemberOccurrences(id: string): Promise<string[]> {
	const [row] = await testDb
		.select()
		.from(schema.calendarEvent)
		.where(eq(schema.calendarEvent.id, id));
	if (!row || row.deletedAt) return [];
	const exceptions = await testDb
		.select()
		.from(schema.calendarEventException)
		.where(eq(schema.calendarEventException.eventId, id));

	const cancelled = new Set(
		exceptions.filter((e) => e.cancelled).map((e) => new Date(e.recurrenceId).toISOString())
	);
	const moved = new Map(
		exceptions
			.filter((e) => !e.cancelled && e.startsAt)
			.map((e) => [new Date(e.recurrenceId).toISOString(), e.startsAt!.toISOString()])
	);

	return expand(row.rrule ?? '', row.startsAt.toISOString(), row.tz, '2026-09-01', '2026-09-30')
		.filter((at) => !cancelled.has(at))
		.map((at) => moved.get(at) ?? at);
}

describe('editing one occurrence', () => {
	it('moves only that occurrence and leaves the rest', async () => {
		const id = await seed();
		const before = await septemberOccurrences(id);
		expect(before).toHaveLength(5);

		const moved = await updateEvent(
			id,
			{
				...base,
				startsAt: new Date('2026-09-16T11:00:00.000Z'),
				endsAt: new Date('2026-09-16T11:30:00.000Z')
			},
			'this',
			'2026-09-15T09:00:00.000Z',
			testDb
		);
		expect(moved.ok).toBe(true);

		const after = await septemberOccurrences(id);
		expect(after).toHaveLength(5);
		expect(after).toContain('2026-09-16T11:00:00.000Z');
		expect(after).not.toContain('2026-09-15T09:00:00.000Z');
		// The other four are untouched.
		expect(after).toContain('2026-09-01T09:00:00.000Z');
		expect(after).toContain('2026-09-29T09:00:00.000Z');
	});

	// Moving the same occurrence twice must edit the existing override rather than
	// hit the (event_id, recurrence_id) unique index.
	it('can move the same occurrence twice', async () => {
		const id = await seed();
		for (const hour of ['11', '13']) {
			const result = await updateEvent(
				id,
				{
					...base,
					startsAt: new Date(`2026-09-15T${hour}:00:00.000Z`),
					endsAt: new Date(`2026-09-15T${hour}:30:00.000Z`)
				},
				'this',
				'2026-09-15T09:00:00.000Z',
				testDb
			);
			expect(result.ok).toBe(true);
		}
		const after = await septemberOccurrences(id);
		expect(after).toContain('2026-09-15T13:00:00.000Z');
		expect(after).not.toContain('2026-09-15T11:00:00.000Z');
		expect(after).toHaveLength(5);
	});

	it('cancels one occurrence without removing the series', async () => {
		const id = await seed();
		expect((await deleteEvent(id, 'this', '2026-09-15T09:00:00.000Z', testDb)).ok).toBe(true);
		const after = await septemberOccurrences(id);
		expect(after).toHaveLength(4);
		expect(after).not.toContain('2026-09-15T09:00:00.000Z');
	});

	/** The override row for the 15th, or undefined if none was written. */
	async function overrideRow(id: string) {
		const rows = await testDb
			.select()
			.from(schema.calendarEventException)
			.where(eq(schema.calendarEventException.eventId, id));
		return rows.find((r) => new Date(r.recurrenceId).toISOString() === '2026-09-15T09:00:00.000Z');
	}

	const editOccurrence = (id: string, over: Partial<typeof base>) =>
		updateEvent(id, { ...base, ...over }, 'this', '2026-09-15T09:00:00.000Z', testDb);

	// The form has always submitted these three; the exception table had nowhere
	// to put them, so a "this event only" edit that retagged, un-all-dayed or
	// re-zoned one occurrence was accepted and silently discarded.
	it.each([
		['category', { category: 'health' }, 'category'],
		['all-day', { allDay: true }, 'allDay'],
		['timezone', { tz: 'UTC' }, 'tz']
	] as const)('stores an overridden %s on the occurrence', async (_label, over, column) => {
		const id = await seed();
		expect((await editOccurrence(id, over)).ok).toBe(true);
		const row = await overrideRow(id);
		expect({ [column]: row?.[column] }).toEqual({ [column]: Object.values(over)[0] });
	});

	// Null means inherit, so an edit that did not touch these must leave them
	// null — otherwise the occurrence freezes at today's category and zone, and
	// retagging the series later stops reaching it.
	it('leaves what the edit did not change inheriting from the series', async () => {
		const id = await seed();
		expect((await editOccurrence(id, { title: 'Recycling only' })).ok).toBe(true);
		const row = await overrideRow(id);
		expect({ category: row?.category, allDay: row?.allDay, tz: row?.tz }).toEqual({
			category: null,
			allDay: null,
			tz: null
		});
	});

	it('clears an override again when the occurrence is edited back to the series value', async () => {
		const id = await seed();
		expect((await editOccurrence(id, { category: 'health' })).ok).toBe(true);
		expect((await editOccurrence(id, { category: base.category })).ok).toBe(true);
		expect((await overrideRow(id))?.category).toBeNull();
	});
});

describe('editing this and following', () => {
	// The case that desynchronises when modelled as an exception: the original
	// series has to STOP at the split, or both series claim the same days.
	it('splits into two series with no overlapping occurrence', async () => {
		const id = await seed();
		const result = await updateEvent(
			id,
			{
				...base,
				title: 'Bin day (new time)',
				startsAt: new Date('2026-09-15T11:00:00.000Z'),
				endsAt: new Date('2026-09-15T11:30:00.000Z')
			},
			'following',
			'2026-09-15T09:00:00.000Z',
			testDb
		);
		expect(result.ok).toBe(true);

		const rows = await testDb.select().from(schema.calendarEvent);
		expect(rows).toHaveLength(2);

		const original = rows.find((r) => r.id === id)!;
		expect(original.rrule).toContain('UNTIL=');

		const before = await septemberOccurrences(id);
		const after = await septemberOccurrences(rows.find((r) => r.id !== id)!.id);

		// Nothing is claimed by both series, and nothing is lost between them.
		expect(before.filter((at) => after.includes(at))).toEqual([]);
		expect(before).toEqual(['2026-09-01T09:00:00.000Z', '2026-09-08T09:00:00.000Z']);
		expect(after).toEqual([
			'2026-09-15T11:00:00.000Z',
			'2026-09-22T11:00:00.000Z',
			'2026-09-29T11:00:00.000Z'
		]);
	});

	it('ends the series at the split when deleting this and following', async () => {
		const id = await seed();
		expect((await deleteEvent(id, 'following', '2026-09-15T09:00:00.000Z', testDb)).ok).toBe(true);
		expect(await septemberOccurrences(id)).toEqual([
			'2026-09-01T09:00:00.000Z',
			'2026-09-08T09:00:00.000Z'
		]);
		// One row still: everything before the split genuinely happened.
		expect(await testDb.select().from(schema.calendarEvent)).toHaveLength(1);
	});
});

describe('editing the whole series', () => {
	it('rewrites the series in place', async () => {
		const id = await seed();
		const result = await updateEvent(
			id,
			{ ...base, title: 'Recycling day', rrule: 'FREQ=WEEKLY;BYDAY=WE' },
			'all',
			'2026-09-15T09:00:00.000Z',
			testDb
		);
		expect(result.ok).toBe(true);
		const rows = await testDb.select().from(schema.calendarEvent);
		expect(rows).toHaveLength(1);
		expect(rows[0].title).toBe('Recycling day');
		expect(rows[0].rrule).toBe('FREQ=WEEKLY;BYDAY=WE');
	});

	// Sync must be able to tell "deleted here, push it" from "never existed". A
	// removed row says nothing, and the engine would pull the remote copy back.
	it('tombstones rather than removing the row', async () => {
		const id = await seed();
		expect((await deleteEvent(id, 'all', null, testDb)).ok).toBe(true);
		const rows = await testDb.select().from(schema.calendarEvent);
		expect(rows).toHaveLength(1);
		expect(rows[0].deletedAt).not.toBeNull();
		expect(await septemberOccurrences(id)).toEqual([]);
	});

	it('refuses to edit an event that is already deleted', async () => {
		const id = await seed();
		await deleteEvent(id, 'all', null, testDb);
		const result = await updateEvent(id, base, 'all', null, testDb);
		expect(result).toEqual({ ok: false, status: 404, message: 'Event not found.' });
	});
});

describe('validation', () => {
	it('rejects an event that ends before it starts', async () => {
		const result = await createEvent(
			{ ...base, endsAt: new Date('2026-09-01T08:00:00.000Z') },
			null,
			testDb
		);
		expect(result).toEqual({
			ok: false,
			status: 400,
			message: 'An event cannot end before it starts.'
		});
	});

	it('rejects a blank title', async () => {
		const result = await createEvent({ ...base, title: '   ' }, null, testDb);
		expect(result.ok).toBe(false);
	});
});
