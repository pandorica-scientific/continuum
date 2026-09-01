// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * An organisation as a record.
 *
 * The whole reason it is an entity kind rather than a table of its own: the far
 * end of a `document_link` is an `entity`, so a payslip can be filed against an
 * employer the moment the row exists — with no new link table and no per-kind
 * code anywhere. This suite holds the registration that makes that true, since
 * none of it is written by hand: `entitySql` loops `ENTITY_KINDS` and generates
 * the trigger, the generated column and the composite foreign key.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { organisation } from '$lib/server/db/schema';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';

vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

let harness: Harness;
let db: TestDb;
let previousUrl: string | undefined;

beforeAll(async () => {
	previousUrl = process.env.DATABASE_URL;
	harness = await startPostgres('organisations', { max: 1 });
	process.env.DATABASE_URL = harness.url;
	await harness.applyMigrations(ALL_MIGRATIONS);
	db = harness.db;
}, 180_000);

afterAll(async () => {
	await harness?.stop();
	if (previousUrl === undefined) delete process.env.DATABASE_URL;
	else process.env.DATABASE_URL = previousUrl;
});

beforeEach(async () => {
	await harness.sql`truncate organisation cascade`;
});

describe('an organisation', () => {
	it('registers itself in the entity supertype, like every other record', async () => {
		const id = uuidv7();
		await db
			.insert(organisation)
			.values({ id, name: 'Institute of Physics CAS', kind: 'employer' });

		const rows = await harness.sql<{ kind: string }[]>`
			select kind from entity where id = ${id}`;
		expect(rows.map((r) => r.kind)).toEqual(['organisation']);
	});

	it('refuses a kind nobody named', async () => {
		await expect(
			harness.sql`insert into organisation (id, name, kind)
				values (gen_random_uuid(), 'Nowhere', 'landlord')`
		).rejects.toThrow();
	});

	it('treats two spellings of one employer as one', async () => {
		// "AV ČR" and "av čr" are the same institute. Two records differing only
		// in case is the phantom-column problem returning by another door.
		await db.insert(organisation).values({ id: uuidv7(), name: 'AV ČR' });
		await expect(db.insert(organisation).values({ id: uuidv7(), name: 'av čr' })).rejects.toThrow();
	});

	it('retires its entity row when it is deleted', async () => {
		// Otherwise the supertype fills with orphans a later link could attach to.
		const id = uuidv7();
		await db.insert(organisation).values({ id, name: 'Gone Ltd' });
		await db.delete(organisation).where(eq(organisation.id, id));
		expect(await harness.sql`select 1 from entity where id = ${id}`).toHaveLength(0);
	});
});
