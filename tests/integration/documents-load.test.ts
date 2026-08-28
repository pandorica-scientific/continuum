// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { document } from '$lib/server/db/schema';
import { shelfIdByKey } from '$lib/server/documents/shelves';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';

vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

/**
 * The last read path, and the one where the leak would be a number.
 *
 * A member seeing "27" beside a shelf holding the 26 documents they can open
 * has been told something exists. That is why the counts are computed in SQL
 * behind the same predicate as the rows, rather than by counting the array
 * afterwards.
 */
let harness: Harness;
let testDb: TestDb;
let previousUrl: string | undefined;

const asAdmin = { person: { id: 'a', name: 'A', initials: 'A', role: 'admin', theme: null } };
const asMember = { person: { id: 'm', name: 'M', initials: 'M', role: 'member', theme: null } };

beforeAll(async () => {
	previousUrl = process.env.DATABASE_URL;
	harness = await startPostgres('documents-load', { max: 1 });
	process.env.DATABASE_URL = harness.url;
	await harness.applyMigrations(ALL_MIGRATIONS);
	testDb = harness.db;
}, 180_000);

afterAll(async () => {
	await harness?.stop();
	if (previousUrl === undefined) delete process.env.DATABASE_URL;
	else process.env.DATABASE_URL = previousUrl;
});

beforeEach(async () => {
	await harness.sql`delete from document`;
});

async function seedShelf(key: string, counts: { normal: number; restricted: number }) {
	const shelfId = await shelfIdByKey(key, testDb);
	for (const [sensitivity, n] of [
		['normal', counts.normal],
		['restricted', counts.restricted]
	] as const) {
		for (let i = 0; i < n; i++) {
			await testDb.insert(document).values({
				id: uuidv7(),
				name: `${sensitivity} ${i}`,
				shelfId,
				type: 'other',
				sensitivity,
				addedOn: '2026-01-01'
			});
		}
	}
}

type LoadedDocuments = {
	shelves: { key: string; label: string; count: number }[];
	total: number;
};

async function loadDocuments(locals: unknown): Promise<LoadedDocuments> {
	const { load } = await import('../../src/routes/(app)/documents/+page.server');
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (await (load as any)({
		url: new URL('http://localhost/documents'),
		locals
	})) as LoadedDocuments;
}

describe('the documents load', () => {
	it('gives a member a rail count that has already forgotten the restricted one', async () => {
		await seedShelf('household', { normal: 26, restricted: 1 });
		const data = await loadDocuments(asMember);
		expect(data.shelves.find((s) => s.key === 'household')!.count).toBe(26);
		expect(data.shelves.find((s) => s.key === 'all')!.count).toBe(26);
		expect(data.total).toBe(26);
	});

	it('gives the admin 27', async () => {
		await seedShelf('household', { normal: 26, restricted: 1 });
		const data = await loadDocuments(asAdmin);
		expect(data.shelves.find((s) => s.key === 'household')!.count).toBe(27);
		expect(data.total).toBe(27);
	});

	it('never shows a teaser row', async () => {
		// Not a row, not a name, not a flag set on anything the member can see.
		// The document does not reach the screen at all — there is nothing to
		// dim, grey out or mark as withheld, because a placeholder IS the leak.
		await seedShelf('household', { normal: 1, restricted: 1 });
		const data = (await loadDocuments(asMember)) as LoadedDocuments & {
			rows: { name: string; restricted: boolean }[];
		};
		expect(data.rows).toHaveLength(1);
		expect(data.rows.every((r) => r.restricted === false)).toBe(true);
		expect(JSON.stringify(data.rows)).not.toMatch(/restricted 0/);
	});
});
