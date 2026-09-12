// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Two people, one bottle, one number.
 *
 * The ownership counts are the only figures in Collections that two browsers
 * can change at the same second — a phone in the kitchen pressing `+` while the
 * laptop logs a tasting. Read-then-write across two round trips loses one of
 * the two, and the loss is silent: both screens say they saved.
 *
 * So the arithmetic is passed INTO the write and the row is held while it runs.
 * These tests are about that, not about the arithmetic, which is pure and
 * tested in `bottle-ownership.test.ts`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { ALL_MIGRATIONS, startPostgres, type Harness } from './harness';
import { add, openOne, remove } from '$lib/life/collections/ownership';
import { currentCounts, logTasting, moveCounts } from '$lib/server/life/cellar';

let harness: Harness;
let cellarId: string;

beforeAll(async () => {
	// More than one connection, deliberately: a lock nobody can queue behind is
	// not a lock, and a single-connection pool would serialise the test rather
	// than the database.
	harness = await startPostgres('cellar-counts', { max: 4 });
	await harness.applyMigrations(ALL_MIGRATIONS);
	const [cellar] = await harness.sql`select id from collection where key = 'cellar'`;
	cellarId = cellar.id;
}, 180_000);

afterAll(async () => {
	await harness?.stop();
});

beforeEach(async () => {
	await harness.sql`delete from bottle`;
});

/** A bottling the household owns some number of. */
async function makeBottle(owned = 4, opened = 0): Promise<string> {
	const id = uuidv7();
	await harness.sql`
		insert into bottle (id, collection_id, type, name, owned, opened)
		values (${id}, ${cellarId}, 'wine', 'Something red', ${owned}, ${opened})`;
	return id;
}

describe('moving a count', () => {
	it('writes what the rule decided', async () => {
		const id = await makeBottle(2, 0);
		expect(await moveCounts(id, add, harness.db)).toEqual({ owned: 3, opened: 0 });
		expect(await currentCounts(id, harness.db)).toEqual({ owned: 3, opened: 0 });
	});

	it('reports a bottle that is not there rather than writing', async () => {
		expect(await moveCounts(uuidv7(), add, harness.db)).toBeNull();
	});

	// The point of the lock. Four presses that overlap are four presses.
	it('keeps every press when they arrive at once', async () => {
		const id = await makeBottle(1, 0);
		await Promise.all([
			moveCounts(id, add, harness.db),
			moveCounts(id, add, harness.db),
			moveCounts(id, add, harness.db),
			moveCounts(id, add, harness.db)
		]);
		expect(await currentCounts(id, harness.db)).toEqual({ owned: 5, opened: 0 });
	});

	it('keeps a press and an opening that arrive together', async () => {
		const id = await makeBottle(3, 0);
		await Promise.all([moveCounts(id, add, harness.db), moveCounts(id, openOne, harness.db)]);
		expect(await currentCounts(id, harness.db)).toEqual({ owned: 4, opened: 1 });
	});

	// `remove` finishes the open bottle first, so a `−` that lands after an
	// opening puts the cork back. That is the rule, not a race: what the lock
	// guarantees is that both moves are APPLIED, which is the count of bottles.
	it('applies a press and its opposite, whichever order they land in', async () => {
		const id = await makeBottle(3, 0);
		await Promise.all([moveCounts(id, add, harness.db), moveCounts(id, remove, harness.db)]);
		expect((await currentCounts(id, harness.db))?.owned).toBe(3);
	});
});

describe('logging a tasting', () => {
	it('opens the bottle as it writes the note', async () => {
		const id = await makeBottle(2, 0);
		const logged = await logTasting(
			{
				bottleId: id,
				tastedOn: '2025-06-01',
				personId: null,
				score: 92,
				note: 'Dusty, in a good way.',
				flavours: ['leather', 'plum']
			},
			harness.db
		);
		expect(logged).not.toBeNull();
		expect(await currentCounts(id, harness.db)).toEqual({ owned: 2, opened: 1 });
	});

	it('cannot open more than are owned', async () => {
		const id = await makeBottle(1, 1);
		await logTasting(
			{
				bottleId: id,
				tastedOn: '2025-06-01',
				personId: null,
				score: null,
				note: '',
				flavours: []
			},
			harness.db
		);
		expect(await currentCounts(id, harness.db)).toEqual({ owned: 1, opened: 1 });
	});

	it('says so rather than throwing when the bottle is gone', async () => {
		const logged = await logTasting(
			{
				bottleId: uuidv7(),
				tastedOn: '2025-06-01',
				personId: null,
				score: null,
				note: '',
				flavours: []
			},
			harness.db
		);
		expect(logged).toBeNull();
	});

	// The case the lock was added for: a tasting on one screen and a purchase on
	// another. Both are facts, and neither may erase the other.
	it('does not undo a purchase made at the same moment', async () => {
		const id = await makeBottle(2, 0);
		await Promise.all([
			logTasting(
				{
					bottleId: id,
					tastedOn: '2025-06-01',
					personId: null,
					score: null,
					note: '',
					flavours: []
				},
				harness.db
			),
			moveCounts(id, add, harness.db)
		]);
		expect(await currentCounts(id, harness.db)).toEqual({ owned: 3, opened: 1 });
	});
});
