// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, isNull } from 'drizzle-orm';
import { rowId } from '../row-id';
import { importFile } from '$lib/server/db/schema';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';

let harness: Harness;
let testDb: TestDb;
const FILE = rowId('import-file-1');

beforeAll(async () => {
	harness = await startPostgres('import-acknowledge');
	testDb = harness.db;
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 120_000);

afterAll(async () => {
	await harness?.stop();
});

beforeEach(async () => {
	await harness.sql`delete from import_file`;
	await testDb.insert(importFile).values({
		id: FILE,
		filename: 'statement.csv',
		bank: 'fio',
		format: 'csv',
		contentHash: 'abc123',
		storedName: 'abc123.csv',
		rowsRead: 5,
		currency: 'CZK',
		sourceMethod: 'adapter',
		proofClass: 'P3'
	});
});

// Acknowledging is "I have looked at this", not "undo it". The distinction
// matters: the content hash is what makes a re-upload a duplicate, and losing
// the row would quietly turn every acknowledged statement into one that could
// be imported a second time.
describe('acknowledging a recent import', () => {
	it('hides it from the list', async () => {
		const listed = () => testDb.select().from(importFile).where(isNull(importFile.acknowledgedAt));

		expect(await listed()).toHaveLength(1);
		await testDb
			.update(importFile)
			.set({ acknowledgedAt: new Date() })
			.where(eq(importFile.id, FILE));
		expect(await listed()).toHaveLength(0);
	});

	it('keeps the record, its stored file and its content hash', async () => {
		await testDb
			.update(importFile)
			.set({ acknowledgedAt: new Date() })
			.where(eq(importFile.id, FILE));

		const [row] = await testDb.select().from(importFile).where(eq(importFile.id, FILE));
		expect(row).toBeDefined();
		expect(row.storedName).toBe('abc123.csv');
		expect(row.contentHash).toBe('abc123');
		expect(row.rowsRead).toBe(5);
		expect(row.acknowledgedAt).toBeInstanceOf(Date);
	});

	it('leaves the duplicate check working, so the file cannot be imported twice', async () => {
		await testDb
			.update(importFile)
			.set({ acknowledgedAt: new Date() })
			.where(eq(importFile.id, FILE));

		await expect(
			testDb.insert(importFile).values({
				id: rowId('import-file-2'),
				filename: 'statement-again.csv',
				bank: 'fio',
				format: 'csv',
				contentHash: 'abc123',
				storedName: 'abc123.csv',
				rowsRead: 5,
				currency: 'CZK',
				sourceMethod: 'adapter',
				proofClass: 'P3'
			})
		).rejects.toThrow();
	});
});
