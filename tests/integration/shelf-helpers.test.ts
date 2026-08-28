import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { shelfIdByKey, systemShelfId } from '$lib/server/documents/shelves';
import { ALL_MIGRATIONS, startPostgres, type Harness } from './harness';

/**
 * A shelf key is resolved in one place, and an unknown one is loud.
 *
 * The alternative — a fallback to inbox — files a payslip somewhere nobody
 * looks and reports nothing, which is how the old code's `shelf: 'payslips'`
 * string could drift from the set the database accepted without anyone noticing.
 */
let harness: Harness;

beforeAll(async () => {
	harness = await startPostgres('shelf-helpers', { max: 1 });
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 180_000);

afterAll(async () => {
	await harness?.stop();
});

describe('shelf helpers', () => {
	it('resolves a key to the seeded row', async () => {
		const id = await shelfIdByKey('finance', harness.db);
		const [row] = await harness.sql<{ key: string }[]>`select key from shelf where id = ${id}`;
		expect(row.key).toBe('finance');
	});

	it('throws on a key nobody seeded, rather than filing into nowhere', async () => {
		// A silent fallback to inbox would file a payslip somewhere nobody looks
		// and nothing would report it. A missing key is a defect in this repo,
		// not a user's mistake.
		await expect(shelfIdByKey('payslips', harness.db)).rejects.toThrow(/payslips/);
	});

	it('resolves the two system shelves', async () => {
		const inbox = await systemShelfId('inbox', harness.db);
		const statements = await systemShelfId('statements', harness.db);
		expect(inbox).not.toBe(statements);
		const rows = await harness.sql<{ system: boolean }[]>`
			select system from shelf where id in (${inbox}, ${statements})`;
		expect(rows.every((r) => r.system)).toBe(true);
	});
});
