import { rowId } from '../row-id';
import { asc } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPostgres, type Harness, type TestDb } from './harness';
import { makePerson, makeProperty } from './fixtures';
import { person } from '$lib/server/db/schema';
import { listProperties } from '$lib/server/property/queries';

// Rows created in one statement share a created_at to the microsecond, and
// `ORDER BY created_at` alone is then not a total order: PostgreSQL may return
// tied rows in any order, and an UPDATE moves a row in the heap, which changes
// it. Every screen that picks by position — the selected property, "person one"
// and "person two" in the retirement projection — silently changed subject
// after any edit. Saving a floor plan swapped the flat under the user.

let harness: Harness;
let db: TestDb;

beforeAll(async () => {
	harness = await startPostgres('list-ordering');
	db = harness.db;
	await harness.applyMigrations();
}, 120_000);

afterAll(async () => {
	await harness?.stop();
});

describe('lists ordered by creation time', () => {
	it('keeps properties in the same order after one of them is edited', async () => {
		// One statement, so both rows carry the same created_at — exactly what the
		// setup wizard and the demo seed produce.
		await makeProperty(db, {
			id: rowId('p-first'),
			name: 'First',
			sizeLabel: '2+kk',
			kind: 'lived',
			currency: 'CZK'
		});
		await makeProperty(db, {
			id: rowId('p-second'),
			name: 'Second',
			sizeLabel: '3+kk',
			kind: 'rented',
			currency: 'CZK'
		});

		// The loader's own query, so this cannot pass while production drifts.
		const read = async () => (await listProperties(db)).map((p) => p.id);

		const before = await read();
		expect(new Set(before)).toEqual(new Set([rowId('p-first'), rowId('p-second')]));

		// Saving a floor plan is exactly this: an update to the images column.
		await harness.sql`update property set images = '{"photos":[]}'::jsonb where id = ${before[0]}`;

		expect(await read()).toEqual(before);
	});

	it('keeps person one and person two the same people after an edit', async () => {
		await makePerson(db, { id: rowId('q-one'), name: 'One', initials: 'O', birthYear: 1988 });
		await makePerson(db, { id: rowId('q-two'), name: 'Two', initials: 'T', birthYear: 1990 });

		const read = async () =>
			(await db.select().from(person).orderBy(asc(person.createdAt), asc(person.id))).map(
				(p) => p.birthYear
			);

		const before = await read();
		await harness.sql`update person set name = 'One edited' where id = ${rowId('q-one')}`;

		// The retirement projection reads people[0] and people[1] for the two
		// birth years; swapping them silently changes the whole forecast.
		expect(await read()).toEqual(before);
	});
});
