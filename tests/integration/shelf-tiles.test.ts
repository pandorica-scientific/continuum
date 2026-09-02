// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The figures a shelf's summary band shows.
 *
 * Counted against a real database rather than a fixture list, because most of
 * what makes them interesting is a join: a wallet counts PEOPLE and not
 * documents, a dossier counts the cards its paper is about, and the amber
 * window comes off the document's type rather than off a constant. None of
 * those survive being faked.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { shelfFacts } from '$lib/server/documents/shelf-tiles';
import { listShelves, shelfIdByKey } from '$lib/server/documents/shelves';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeDocument, makeDocumentLink, makePerson, makeSubject } from './fixtures';

vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

let harness: Harness;
let db: TestDb;
let previousUrl: string | undefined;

/** The facts for a shelf named by key — the row is what `shelfFacts` takes. */
async function factsFor(key: string, viewer: Parameters<typeof shelfFacts>[1] = null) {
	const row = (await listShelves(db)).find((s) => s.key === key)!;
	return shelfFacts(row, viewer, db);
}

/** An ISO day relative to today, so no fixture sits on an expiry boundary by accident. */
const daysFromToday = (days: number): string => {
	const d = new Date();
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
};

beforeAll(async () => {
	previousUrl = process.env.DATABASE_URL;
	harness = await startPostgres('shelf-stats', { max: 1 });
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
	await harness.sql`truncate document cascade`;
	await harness.sql`truncate property cascade`;
	await harness.sql`truncate person cascade`;
});

describe('shelfFacts', () => {
	it('counts Identity by people, and separates expired from merely due', async () => {
		const alice = await makePerson(db, { name: 'Alice' });
		const bob = await makePerson(db, { name: 'Bob' });
		const shelfId = await shelfIdByKey('identity', db);

		// Expired eight days ago: inside the 30-day red window.
		const lapsed = await makeDocument(db, {
			shelfId,
			type: 'id_document',
			expiresOn: daysFromToday(-8)
		});
		await makeDocumentLink(db, { documentId: lapsed.id, targetId: alice.id });

		// Ninety days out — quiet at the sixty-day default, and inside the window
		// an identity document earns. This is the type's 180 doing the work.
		const soon = await makeDocument(db, {
			shelfId,
			type: 'id_document',
			expiresOn: daysFromToday(90)
		});
		await makeDocumentLink(db, { documentId: soon.id, targetId: bob.id });

		const facts = await factsFor('identity');
		expect(facts.cards).toBe(2);
		expect(facts.expired).toBe(1);
		expect(facts.inReminderWindow).toBe(1);
	});

	it('reports a shelf holding nothing dated as undated, whatever it holds', async () => {
		const shelfId = await shelfIdByKey('identity', db);
		await makeDocument(db, { shelfId, type: 'certificate', expiresOn: null });
		const facts = await factsFor('identity');
		expect(facts.documents).toBe(1);
		expect(facts.nextDate).toBeNull();
	});

	it('counts Inventory by the items its documents are about, not by document', async () => {
		// Three documents about one boiler is ONE card — which is the whole reason
		// the shelf is arranged by subject.
		const shelfId = await shelfIdByKey('inventory', db);
		const boiler = await makeSubject(db, { shelfKey: 'inventory', name: 'Boiler' });
		for (const type of ['receipt', 'warranty', 'manual'] as const) {
			const doc = await makeDocument(db, { shelfId, type });
			await makeDocumentLink(db, { documentId: doc.id, targetId: boiler.id });
		}
		const facts = await factsFor('inventory');
		expect(facts.cards).toBe(1);
		expect(facts.documents).toBe(3);
	});

	it('counts the Inbox by how long the oldest has waited', async () => {
		const shelfId = await shelfIdByKey('inbox', db);
		await makeDocument(db, { shelfId, addedOn: daysFromToday(-6) });
		await makeDocument(db, { shelfId, addedOn: daysFromToday(-1) });
		const facts = await factsFor('inbox');
		expect(facts.waiting).toBe(2);
		expect(facts.oldestDays).toBe(6);
	});

	it('hides a restricted document from a member, exactly as the list does', async () => {
		// A band counting a document a member cannot see would tell them it
		// exists, which is the one fact the restriction protects.
		const shelfId = await shelfIdByKey('identity', db);
		await makeDocument(db, { shelfId, type: 'certificate', sensitivity: 'restricted' });
		await makeDocument(db, { shelfId, type: 'certificate' });

		expect((await factsFor('identity', { id: 'x', role: 'member' })).documents).toBe(1);
		expect((await factsFor('identity', { id: 'x', role: 'admin' })).documents).toBe(2);
	});
});
