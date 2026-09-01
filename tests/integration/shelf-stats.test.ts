// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The three figures a shelf's banner shows.
 *
 * Counted against a real database rather than a fixture list, because most of
 * what makes them interesting is a join: Identity counts PEOPLE and not
 * documents, Household counts the objects its paper is about, and the amber
 * window comes off the document's type rather than off a constant. None of
 * those survive being faked.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { shelfFacts } from '$lib/server/documents/shelf-stats';
import { shelfIdByKey } from '$lib/server/documents/shelves';
import { upsertSubjectByName } from '$lib/server/documents/subjects';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeDocument, makeDocumentLink, makePerson, makeProperty } from './fixtures';

vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

let harness: Harness;
let db: TestDb;
let previousUrl: string | undefined;

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

		const facts = await shelfFacts('identity', null, db);
		expect(facts.people).toBe(2);
		expect(facts.expired).toBe(1);
		expect(facts.inReminderWindow).toBe(1);
	});

	it('reports a shelf holding nothing dated as undated, whatever it holds', async () => {
		const shelfId = await shelfIdByKey('family', db);
		await makeDocument(db, { shelfId, type: 'certificate', expiresOn: null });
		const facts = await shelfFacts('family', null, db);
		expect(facts.records).toBe(1);
		expect(facts.anyDated).toBe(false);
		expect(facts.nextDate).toBeNull();
	});

	it('counts Household by the items its documents are about, not by document', async () => {
		// Three documents about one boiler is ONE item — which is the whole reason
		// the shelf is arranged by subject.
		const shelfId = await shelfIdByKey('household', db);
		const boiler = await upsertSubjectByName('Boiler', db);
		for (const type of ['receipt', 'warranty', 'manual'] as const) {
			const doc = await makeDocument(db, { shelfId, type });
			await makeDocumentLink(db, { documentId: doc.id, targetId: boiler });
		}
		const facts = await shelfFacts('household', null, db);
		expect(facts.subjects).toBe(1);
		expect(facts.documents).toBe(3);
	});

	it('counts addresses for Property from the properties, not from the paper', async () => {
		// A flat with no documents filed yet is still a flat this shelf is for.
		await makeProperty(db, { name: 'Karlín' });
		await makeProperty(db, { name: 'Vinohrady' });
		const facts = await shelfFacts('property', null, db);
		expect(facts.addresses).toBe(2);
	});

	it('hides a restricted document from a member, exactly as the list does', async () => {
		// A banner counting a document a member cannot see would tell them it
		// exists, which is the one fact the restriction protects.
		const shelfId = await shelfIdByKey('family', db);
		await makeDocument(db, { shelfId, type: 'certificate', sensitivity: 'restricted' });
		await makeDocument(db, { shelfId, type: 'certificate' });

		expect((await shelfFacts('family', { id: 'x', role: 'member' }, db)).documents).toBe(1);
		expect((await shelfFacts('family', { id: 'x', role: 'admin' }, db)).documents).toBe(2);
	});
});
