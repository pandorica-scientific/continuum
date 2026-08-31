// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { job } from '$lib/server/db/schema';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { SETTLED_MS, dismissJob, queueStatus } from '$lib/server/import/queue';

let harness: Harness;
let testDb: TestDb;

beforeAll(async () => {
	harness = await startPostgres('queue-dismiss');
	testDb = harness.db;
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 120_000);

afterAll(async () => {
	await harness?.stop();
});

beforeEach(async () => {
	await harness.sql`delete from job`;
});

const add = (id: string, state: string, finishedAt: Date | null = null) =>
	testDb.insert(job).values({
		id,
		kind: 'import',
		state: state as 'queued',
		filename: `${id}.csv`,
		byteSize: 10,
		finishedAt
	});

describe('taking a job out of the queue', () => {
	it('cancels one that never ran', async () => {
		await add('a', 'queued');
		expect(await dismissJob('a', testDb)).toEqual({ ok: true });
		expect(await testDb.select().from(job).where(eq(job.id, 'a'))).toHaveLength(0);
	});

	it('clears one that has finished or failed', async () => {
		await add('b', 'done', new Date());
		await add('c', 'failed', new Date());
		expect(await dismissJob('b', testDb)).toEqual({ ok: true });
		expect(await dismissJob('c', testDb)).toEqual({ ok: true });
		expect(await testDb.select().from(job)).toHaveLength(0);
	});

	// The read is happening in another worker and cannot be stopped from here.
	// Deleting the row would leave that worker finishing into nothing, and could
	// leave a statement half ingested.
	it('refuses one that is being read right now, and says why', async () => {
		await add('d', 'running');
		const result = await dismissJob('d', testDb);
		expect(result.ok).toBe(false);
		expect(result.ok === false && result.message).toMatch(/being read right now/);
		expect(await testDb.select().from(job).where(eq(job.id, 'd'))).toHaveLength(1);
	});

	it('is untroubled by a job that is already gone', async () => {
		expect(await dismissJob('nope', testDb)).toEqual({ ok: true });
	});
});

describe('the queue clearing itself', () => {
	it('stops listing a settled job once it is old enough', async () => {
		await add('fresh', 'done', new Date());
		await add('stale', 'done', new Date(Date.now() - SETTLED_MS - 60_000));

		const listed = (await queueStatus(testDb)).recent.map((entry) => entry.id);
		expect(listed).toContain('fresh');
		expect(listed).not.toContain('stale');
	});

	it('keeps listing work that has not settled, however long it has waited', async () => {
		await add('waiting', 'queued');
		await add('reading', 'running');
		const listed = (await queueStatus(testDb)).recent.map((entry) => entry.id);
		expect(listed).toEqual(expect.arrayContaining(['waiting', 'reading']));
	});
});
