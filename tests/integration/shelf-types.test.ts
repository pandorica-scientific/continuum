// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What each shelf offers first, and who owns it.
 *
 * The registry seeds these lists and the household edits them, which is two
 * places holding the same kind of fact — so the first test here holds them to
 * the same values on a fresh install, and the rest hold the edit.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { SHELF_SEED_ROWS } from '$lib/server/db/schema/documents';
import { addDocumentType } from '$lib/server/documents/types';
import { shelf, shelfType } from '$lib/server/db/schema';
import {
	addShelf,
	setShelfTypes,
	shelfIdByKey,
	shelfTypesByKey
} from '$lib/server/documents/shelves';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';

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
	harness = await startPostgres('shelf-types', { max: 1 });
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
	// Back to the lists a fresh install ships, so one test's edit is not the
	// next test's starting point. The seed itself is asserted against the
	// baseline in `baseline-migration`, which is where the baseline is read.
	await harness.sql`truncate shelf_type`;
	await harness.sql`delete from shelf where key = 'boat'`;
	await harness.sql`delete from document_type where builtin = false`;
	for (const row of SHELF_SEED_ROWS) {
		if (row.types.length === 0) continue;
		await setShelfTypes(await shelfIdByKey(row.key, testDb), [...row.types], testDb);
	}
});

describe('what a shelf starts with', () => {
	it('is the list the seed names', async () => {
		const byKey = await shelfTypesByKey(testDb);
		const seeded = (key: string) => SHELF_SEED_ROWS.find((r) => r.key === key)!.types;
		expect(byKey.get('identity')).toEqual([...seeded('identity')]);
		expect(byKey.get('income_tax')).toEqual([...seeded('income_tax')]);
	});

	it('is nothing for the Inbox, because nothing in it has been decided yet', async () => {
		expect((await shelfTypesByKey(testDb)).get('inbox')).toBeUndefined();
	});
});

describe('editing a shelf’s list', () => {
	it('replaces it with exactly what was chosen, in that order', async () => {
		const id = await shelfIdByKey('identity', testDb);
		await setShelfTypes(id, ['certificate', 'contract'], testDb);

		expect((await shelfTypesByKey(testDb)).get('identity')).toEqual(['certificate', 'contract']);
	});

	it('lets a shelf offer nothing at all', async () => {
		// Then the picker simply shows every type, which is where it started.
		const id = await shelfIdByKey('identity', testDb);
		await setShelfTypes(id, [], testDb);

		expect((await shelfTypesByKey(testDb)).get('identity')).toBeUndefined();
	});

	it('is allowed on a system shelf', async () => {
		// Identity cannot be deleted; what it suggests is still the household's.
		const id = await shelfIdByKey('identity', testDb);
		await setShelfTypes(id, ['contract'], testDb);

		expect((await shelfTypesByKey(testDb)).get('identity')).toEqual(['contract']);
	});

	it('is allowed on a shelf the household made', async () => {
		(await addShelf({ label: 'Boat', emoji: '⛵', template: 'kit', unit: 'subject' }, testDb)).id;
		const id = await shelfIdByKey('boat', testDb);
		await setShelfTypes(id, ['insurance_policy', 'manual'], testDb);

		expect((await shelfTypesByKey(testDb)).get('boat')).toEqual(['insurance_policy', 'manual']);
	});
});

describe('a type the household added', () => {
	it('can be put on a shelf like any other', async () => {
		// The action filtered the posted list against the types the app SHIPS,
		// which silently dropped every one a household had added: the checkbox
		// ticked, the form posted it, and the shelf came back without it.
		await addDocumentType('Vaccination book', testDb);
		const id = await shelfIdByKey('health', testDb);
		await setShelfTypes(id, ['medical_record', 'vaccination_book'], testDb);

		expect((await shelfTypesByKey(testDb)).get('health')).toEqual([
			'medical_record',
			'vaccination_book'
		]);
	});
});

describe('the column itself', () => {
	it('refuses a type the household does not have', async () => {
		// A foreign key rather than a CHECK, because the list of types is rows
		// the household grows rather than a constant.
		const id = await shelfIdByKey('identity', testDb);
		await expect(
			harness.sql`insert into shelf_type (shelf_id, type, ordinal)
				values (${id}, 'blueprint', 9)`
		).rejects.toThrow(/shelf_type_type_document_type_key_fk/);
	});

	it('goes when the shelf goes', async () => {
		(await addShelf({ label: 'Boat', emoji: '⛵', template: 'kit', unit: 'subject' }, testDb)).id;
		const id = await shelfIdByKey('boat', testDb);
		await setShelfTypes(id, ['manual'], testDb);

		await testDb.delete(shelf).where(eq(shelf.id, id));

		const left = await testDb.select().from(shelfType).where(eq(shelfType.shelfId, id));
		expect(left).toEqual([]);
	});
});
