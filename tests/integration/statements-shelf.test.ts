// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_MIGRATIONS, startPostgres, type Harness } from './harness';
import { ENUMS } from '$lib/enums';

// The widened CHECK is only real if the database accepts the new value and
// still rejects an invented one. Asserting the constant alone would pass on a
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
	it('is one of the values the column accepts', () => {
		expect(ENUMS['document.shelf']).toContain('statements');
	});

	it('is accepted by the database, and an invented shelf still is not', async () => {
		const insert = (shelf: string) => harness.sql`
			insert into document (id, name, shelf, ext, added_on, expiry_verb)
			values (gen_random_uuid(), 'a statement', ${shelf}, 'csv', current_date, 'expires')`;

		await expect(insert('statements')).resolves.toBeDefined();
		await expect(insert('nonsense')).rejects.toThrow(/document_shelf_check/);
	});
});
