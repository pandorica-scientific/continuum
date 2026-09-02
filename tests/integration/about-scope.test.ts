// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What a document may be about, narrowed to its shelf.
 *
 * A document belongs to one shelf and never links across shelves. Before
 * v0.8.0 every pickable record on the instance was offered on every shelf,
 * which is how a receipt for a washing machine could end up about a tenancy —
 * and how a car's insurer and the tax office sat in one undifferentiated list.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { organisation, subject } from '$lib/server/db/schema';
import { createCard } from '$lib/server/documents/cards';
import { listShelves } from '$lib/server/documents/shelves';
import { pickableTargetsForShelf } from '$lib/server/documents/targets';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makePerson, makeProperty } from './fixtures';

vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

let harness: Harness;
let testDb: TestDb;
let previousUrl: string | undefined;

const shelfBy = async (key: string) => (await listShelves(testDb)).find((s) => s.key === key)!;

beforeAll(async () => {
	previousUrl = process.env.DATABASE_URL;
	harness = await startPostgres('about-scope', { max: 1 });
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
	await testDb.delete(subject);
	await testDb.delete(organisation);
});

describe('what a document may be about', () => {
	it('offers only the cards homed on its own shelf', async () => {
		const vehicles = await shelfBy('vehicles');
		const car = await createCard({ shelfId: vehicles.id, name: 'Octavia' }, testDb);
		await createCard({ shelfId: (await shelfBy('inventory')).id, name: 'Boiler' }, testDb);

		const offered = await pickableTargetsForShelf(vehicles, testDb);
		expect(offered.map((t) => t.name)).toEqual(['Octavia']);
		expect(offered[0].id).toBe(car.id);
	});

	it('does not offer an organisation from another shelf', async () => {
		const vehicles = await shelfBy('vehicles');
		await createCard(
			{ shelfId: (await shelfBy('income_tax')).id, name: 'Finanční úřad', kind: 'authority' },
			testDb
		);
		// The tax office is a card on Income & Tax. Filing a car's policy must not
		// offer it, however plausible an insurer and an office look side by side.
		expect(await pickableTargetsForShelf(vehicles, testDb)).toEqual([]);
	});

	it('a person shelf offers the people and nothing else', async () => {
		const health = await shelfBy('health');
		await makePerson(testDb, { name: 'Jana' });
		await createCard({ shelfId: (await shelfBy('inventory')).id, name: 'Boiler' }, testDb);

		const offered = await pickableTargetsForShelf(health, testDb);
		expect(offered.every((t) => t.kind === 'person')).toBe(true);
		expect(offered.map((t) => t.name)).toEqual(['Jana']);
	});

	it('a property shelf offers every address, which belongs to the household', async () => {
		const property = await shelfBy('property');
		await makeProperty(testDb, { name: 'Dejvická 12' });
		// A property has a screen of its own and is not homed on a shelf, so every
		// one is offered — there is only one Property shelf to offer them on.
		const offered = await pickableTargetsForShelf(property, testDb);
		expect(offered.map((t) => t.name)).toEqual(['Dejvická 12']);
	});

	it('the Inbox offers everything, because nothing about it is decided yet', async () => {
		const inbox = await shelfBy('inbox');
		await makePerson(testDb, { name: 'Jana' });
		await createCard({ shelfId: (await shelfBy('vehicles')).id, name: 'Octavia' }, testDb);

		const offered = await pickableTargetsForShelf(inbox, testDb);
		expect(offered.some((t) => t.kind === 'person')).toBe(true);
		expect(offered.some((t) => t.kind === 'subject')).toBe(true);
	});

	it('Everything offers everything too', async () => {
		await makePerson(testDb, { name: 'Jana' });
		const offered = await pickableTargetsForShelf(null, testDb);
		expect(offered.some((t) => t.kind === 'person')).toBe(true);
	});
});
