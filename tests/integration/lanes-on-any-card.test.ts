// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Lanes on any card, and a document's membership of one.
 *
 * v0.7.7 built lanes for organisations, because Income & Tax was the only shelf
 * drawing them. A car's road tax and a flat's boiler inspection are the same
 * shape, so the column names the entity supertype instead — and membership
 * became a column on the document rather than a match, because two lanes on one
 * card can both match a payslip and only one of them holds it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { document, lane, organisation, subject } from '$lib/server/db/schema';
import { createCard } from '$lib/server/documents/cards';
import { assignLane } from '$lib/server/documents/mutations';
import { lanesFor } from '$lib/server/organisations/mutations';
import { shelfIdByKey } from '$lib/server/documents/shelves';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeDocument, makeDocumentLink, makeSubject } from './fixtures';

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
	harness = await startPostgres('lanes-on-any-card', { max: 1 });
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
	await testDb.delete(document);
	await testDb.delete(lane);
	await testDb.delete(subject);
	await testDb.delete(organisation);
});

describe('making a card', () => {
	it('a new card on a kit shelf starts with receipt, warranty and manual', async () => {
		const card = await createCard(
			{ shelfId: await shelfIdByKey('inventory', testDb), name: 'Boiler' },
			testDb
		);
		expect(card.unit).toBe('subject');
		const lanes = await lanesFor(card.id, testDb);
		// All three, empty. The missing manual is the finding, and a card seeded
		// with nothing has nothing to be missing.
		expect(lanes.map((l) => [l.label, l.cadence])).toEqual([
			['Receipt', 'once'],
			['Warranty', 'once'],
			['Manual', 'once']
		]);
	});

	it('a new card on Vehicles starts with an inspection every two years', async () => {
		const card = await createCard(
			{ shelfId: await shelfIdByKey('vehicles', testDb), name: 'Octavia' },
			testDb
		);
		const lanes = await lanesFor(card.id, testDb);
		expect(lanes.map((l) => l.label)).toEqual(['Insurance', 'Technical inspection', 'Road tax']);
		expect(lanes.find((l) => l.label === 'Technical inspection')?.every).toBe(2);
	});

	it('an employer seeds by kind, and lives on Income & Tax', async () => {
		const card = await createCard(
			{ shelfId: await shelfIdByKey('income_tax', testDb), name: 'Acme', kind: 'employer' },
			testDb
		);
		expect(card.unit).toBe('organisation');
		const lanes = await lanesFor(card.id, testDb);
		expect(lanes.map((l) => l.label)).toEqual([
			'Payslips',
			'Once a year · declaration, annual settlement',
			'Changes to pay'
		]);
	});

	it('refuses a unit that has a screen of its own', async () => {
		// A person is not made here: they are made in Settings, and a card for one
		// exists the moment the person does.
		await expect(
			createCard({ shelfId: await shelfIdByKey('health', testDb), name: 'Nobody' }, testDb)
		).rejects.toThrow(/person/);
	});
});

describe('a document in a lane', () => {
	it('joins a lane only on a card it is linked to', async () => {
		const car = await makeSubject(testDb, { shelfKey: 'vehicles', name: 'Octavia' });
		const other = await makeSubject(testDb, { shelfKey: 'vehicles', name: 'PCX' });
		const [insurance] = await testDb
			.insert(lane)
			.values({ id: uuidv7(), entityId: car.id, label: 'Insurance', cadence: 'yearly', every: 1 })
			.returning();
		const [otherLane] = await testDb
			.insert(lane)
			.values({ id: uuidv7(), entityId: other.id, label: 'Insurance', cadence: 'yearly', every: 1 })
			.returning();
		const doc = await makeDocument(testDb, { shelfKey: 'vehicles' });
		await makeDocumentLink(testDb, { documentId: doc.id, targetId: car.id });

		await assignLane(doc.id, insurance.id, testDb);
		const [filed] = await testDb.select().from(document).where(eq(document.id, doc.id));
		expect(filed.laneId).toBe(insurance.id);

		// The other car's lane. Allowing it would close a cell on a card the paper
		// was never filed against, and "5 of 6" would be counting the wrong six.
		await expect(assignLane(doc.id, otherLane.id, testDb)).rejects.toThrow(/not linked/);

		// Back to history, which is a real answer rather than an absence.
		await assignLane(doc.id, null, testDb);
		const [unlaned] = await testDb.select().from(document).where(eq(document.id, doc.id));
		expect(unlaned.laneId).toBeNull();
	});

	it('deleting a lane sends its documents back to history', async () => {
		const car = await makeSubject(testDb, { shelfKey: 'vehicles' });
		const [roadTax] = await testDb
			.insert(lane)
			.values({ id: uuidv7(), entityId: car.id, label: 'Road tax', cadence: 'yearly', every: 1 })
			.returning();
		const doc = await makeDocument(testDb, { shelfKey: 'vehicles' });
		await makeDocumentLink(testDb, { documentId: doc.id, targetId: car.id });
		await assignLane(doc.id, roadTax.id, testDb);

		// ON DELETE SET NULL, not cascade: removing a lane must never remove the
		// paper filed in it.
		await testDb.delete(lane).where(eq(lane.id, roadTax.id));
		const [after] = await testDb.select().from(document).where(eq(document.id, doc.id));
		expect(after).toBeDefined();
		expect(after.laneId).toBeNull();
	});

	it('deleting a card takes its lanes and leaves its paper', async () => {
		const car = await makeSubject(testDb, { shelfKey: 'vehicles' });
		await testDb
			.insert(lane)
			.values({ id: uuidv7(), entityId: car.id, label: 'Insurance', cadence: 'yearly', every: 1 });
		const doc = await makeDocument(testDb, { shelfKey: 'vehicles' });
		await makeDocumentLink(testDb, { documentId: doc.id, targetId: car.id });

		await testDb.delete(subject).where(eq(subject.id, car.id));
		expect(await testDb.select().from(lane).where(eq(lane.entityId, car.id))).toHaveLength(0);
		// The document survives, on its shelf, with no card — which is what the
		// dossier draws under "Not assigned yet".
		const [survivor] = await testDb.select().from(document).where(eq(document.id, doc.id));
		expect(survivor).toBeDefined();
	});

	it('refuses a lane that expects paper every nought years', async () => {
		const car = await makeSubject(testDb, { shelfKey: 'vehicles' });
		await expect(
			testDb
				.insert(lane)
				.values({ id: uuidv7(), entityId: car.id, label: 'Nonsense', cadence: 'yearly', every: 0 })
		).rejects.toThrow();
	});
});
