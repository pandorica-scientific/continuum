// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The household view is a reading, not a record.
 *
 * It is the union of everybody's visits, so it belongs to nobody and there is
 * nobody to credit a scratch to. Scratching there used to write a visit with
 * no member at all — a fact about the household that no person's tab could
 * ever show, and that nothing could afterwards attribute.
 *
 * Refused on the server as well as disabled in the layer, because the layer is
 * the interface and this is the rule.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { visit, visitMember } from '$lib/server/db/schema';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makePerson } from './fixtures';

// The route module reads `db` at import time, so it has to find the harness's
// database rather than the developer's — a live getter is the only way, since
// `$env/dynamic/private` snapshots process.env at build time.
vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

let harness: Harness;
let testDb: TestDb;
let previousUrl: string | undefined;

beforeAll(async () => {
	previousUrl = process.env.DATABASE_URL;
	harness = await startPostgres('map-household-readonly', { max: 1 });
	process.env.DATABASE_URL = harness.url;
	testDb = harness.db;
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 120_000);

afterAll(async () => {
	await harness?.stop();
	if (previousUrl === undefined) delete process.env.DATABASE_URL;
	else process.env.DATABASE_URL = previousUrl;
});

beforeEach(async () => {
	await harness.sql`truncate visit, visit_member, person, entity cascade`;
});

async function postAction(action: 'scratched' | 'unscratched', fields: Record<string, string>) {
	const { actions } = await import('../../src/routes/(app)/map/[code]/+page.server');
	const form = new FormData();
	for (const [key, value] of Object.entries(fields)) form.set(key, value);
	const request = new Request(`http://localhost/map/cz?/${action}`, { method: 'POST', body: form });
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (actions[action] as any)({ request, params: { code: 'cz' } });
}

describe('scratching from the household view', () => {
	it('is refused, and writes nothing', async () => {
		const outcome = await postAction('scratched', { region: 'Praha' });

		expect(outcome.status).toBe(400);
		expect(outcome.data.message).toMatch(/person/i);

		const rows = await testDb.select().from(visit);
		expect(rows).toHaveLength(0);
	});

	it('is refused for undo too, so the household cannot remove somebody elses scratch', async () => {
		const outcome = await postAction('unscratched', { region: 'Praha' });

		expect(outcome.status).toBe(400);
		expect(outcome.data.message).toMatch(/person/i);
	});

	it('still works on a person tab, credited to that person alone', async () => {
		const robert = await makePerson(testDb, { name: 'Robert' });

		const outcome = await postAction('scratched', { region: 'Praha', who: robert.id });

		expect(outcome.scratched).toBe(true);
		const rows = await testDb.select().from(visit);
		expect(rows).toHaveLength(1);
		const members = await testDb.select().from(visitMember);
		expect(members.map((m) => m.personId)).toEqual([robert.id]);
	});

	it('takes back only the scratching persons own visit', async () => {
		const robert = await makePerson(testDb, { name: 'Robert' });
		const kseniya = await makePerson(testDb, { name: 'Kseniya' });
		await postAction('scratched', { region: 'Praha', who: robert.id });
		await postAction('scratched', { region: 'Praha', who: kseniya.id });

		const outcome = await postAction('unscratched', { region: 'Praha', who: robert.id });

		expect(outcome.unscratched).toBe(true);
		// Kseniya went to Praha whether or not Robert takes his own back.
		const members = await testDb.select().from(visitMember);
		expect(members.map((m) => m.personId)).toEqual([kseniya.id]);
		const rows = await testDb.select().from(visit);
		expect(rows).toHaveLength(1);
	});

	it('refuses an undo of a region this person never scratched', async () => {
		const robert = await makePerson(testDb, { name: 'Robert' });
		const kseniya = await makePerson(testDb, { name: 'Kseniya' });
		await postAction('scratched', { region: 'Praha', who: kseniya.id });

		const outcome = await postAction('unscratched', { region: 'Praha', who: robert.id });

		expect(outcome.status).toBe(409);
		const rows = await testDb.select().from(visit);
		expect(rows).toHaveLength(1);
	});
});
