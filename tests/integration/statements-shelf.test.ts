// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_MIGRATIONS, startPostgres, type Harness } from './harness';

// The statements shelf is a seeded row now, not a value in a CHECK. What has to
// stay true is the same either way: an accepted import can file itself there,
// and a document cannot be filed onto a shelf that does not exist. The FK is
// what enforces the second half — asserting a constant alone would pass on a
// migration that never ran.
let harness: Harness;

beforeAll(async () => {
	harness = await startPostgres('statements-shelf');
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 120_000);

afterAll(async () => {
	await harness?.stop();
});

describe('the statements shelf', () => {
	it('is seeded, and is one of the two the application refers to by key', async () => {
		const rows = await harness.sql<{ system: boolean }[]>`
			select system from shelf where key = 'statements'`;
		expect(rows).toHaveLength(1);
		expect(rows[0].system).toBe(true);
	});

	it('accepts a statement, and refuses a shelf nobody created', async () => {
		const [{ id: statements }] = await harness.sql<{ id: string }[]>`
			select id from shelf where key = 'statements'`;
		const insert = (shelfId: string) => harness.sql`
			insert into document (id, name, shelf_id, type, ext, added_on, expiry_verb)
			values (gen_random_uuid(), 'a statement', ${shelfId}, 'bank_statement', 'csv', current_date, 'expires')`;

		await expect(insert(statements)).resolves.toBeDefined();
		await expect(insert('00000000-0000-4000-8000-000000000000')).rejects.toThrow(
			/document_shelf_id_shelf_id_fk/
		);
	});
});
