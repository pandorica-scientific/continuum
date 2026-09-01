// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Arriving at the import from a gap on the Statements ribbon.
 *
 * The ribbon knows which account and which month it just asked about, and
 * before this the import screen took no parameters at all — so clicking a gap
 * meant answering a question the screen that sent you had already answered.
 *
 * Everything is validated rather than trusted. These are URL parameters, so a
 * stale bookmark naming a deleted account has to leave a usable upload form
 * rather than a 500: the page is still worth having with nothing filled in.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeAccount } from './fixtures';

vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

let harness: Harness;
let testDb: TestDb;
let previousUrl: string | undefined;
let accountId: string;

interface Prefill {
	accountId: string | null;
	from: string | null;
	to: string | null;
}

async function loadImport(search = ''): Promise<{ prefill: Prefill }> {
	const { load } = await import('../../src/routes/(app)/import/+page.server');
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (await (load as any)({
		url: new URL(`http://localhost/import${search}`)
	})) as { prefill: Prefill };
}

beforeAll(async () => {
	previousUrl = process.env.DATABASE_URL;
	harness = await startPostgres('import-prefill', { max: 1 });
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
	await harness.sql`truncate account cascade`;
	accountId = (await makeAccount(testDb, { name: 'ČSOB · current' })).id;
});

describe('the import screen', () => {
	it('carries the account and the month a gap was clicked from', async () => {
		const { prefill } = await loadImport(`?account=${accountId}&from=2026-04-01&to=2026-04-30`);
		expect(prefill).toEqual({ accountId, from: '2026-04-01', to: '2026-04-30' });
	});

	it('ignores an account that does not exist rather than failing the page', async () => {
		const { prefill } = await loadImport('?account=00000000-0000-0000-0000-000000000000');
		expect(prefill.accountId).toBeNull();
	});

	it('ignores a date that is not one', async () => {
		const { prefill } = await loadImport('?from=last-tuesday&to=2026-13-45');
		expect(prefill.from).toBeNull();
		expect(prefill.to).toBeNull();
	});

	it('answers nothing when nobody asked', async () => {
		const { prefill } = await loadImport();
		expect(prefill).toEqual({ accountId: null, from: null, to: null });
	});
});
