// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, gte, isNull } from 'drizzle-orm';
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

// Acknowledging is "seen", not "undo": the row and its content hash must
// stay, or the file could be imported again.
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

	it('ages a statement out of the list once it is old, without acknowledging it', async () => {
		// The list is the recent few and what each was checked against, not a
		// permanent ledger — a household that never presses ✕ should not end up
		// with one. Ageing out hides the row and nothing else.
		const CUTOFF_MS = 7 * 24 * 60 * 60 * 1000;
		const listed = () =>
			testDb
				.select()
				.from(importFile)
				.where(
					and(
						isNull(importFile.acknowledgedAt),
						gte(importFile.uploadedAt, new Date(Date.now() - CUTOFF_MS))
					)
				);

		expect(await listed()).toHaveLength(1);

		// Eight days ago: past the cutoff, still unacknowledged.
		await testDb
			.update(importFile)
			.set({ uploadedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) })
			.where(eq(importFile.id, FILE));

		expect(await listed()).toHaveLength(0);
		const [row] = await testDb.select().from(importFile).where(eq(importFile.id, FILE));
		expect(row.acknowledgedAt).toBeNull();
		expect(row.contentHash).toBe('abc123');
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
