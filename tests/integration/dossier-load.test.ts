// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What a dossier shelf draws.
 *
 * The counterparties loader this replaces answered for organisations alone and
 * decided lane membership by MATCHING. Both are gone: the cards come from
 * whatever the shelf's unit says, and a document is in a lane because somebody
 * put it there.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { document, lane, organisation, subject } from '$lib/server/db/schema';
import { createCard } from '$lib/server/documents/cards';
import { assignLane } from '$lib/server/documents/mutations';
import { dossierMissing, loadDossier } from '$lib/server/documents/dossier-load';
import { lanesFor } from '$lib/server/organisations/mutations';
import { listShelves } from '$lib/server/documents/shelves';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeDocument, makeDocumentLink, makePerson } from './fixtures';

vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

let harness: Harness;
let testDb: TestDb;
let previousUrl: string | undefined;

const asAdmin = { id: 'a', role: 'admin' as const };
const asMember = { id: 'm', role: 'member' as const };
const TODAY = '2026-09-02';

/** The shelf row by key — `loadDossier` takes the row, not the key. */
const shelfBy = async (key: string) => (await listShelves(testDb)).find((s) => s.key === key)!;

beforeAll(async () => {
	previousUrl = process.env.DATABASE_URL;
	harness = await startPostgres('dossier-load', { max: 1 });
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

describe('the dossier loader', () => {
	it('draws one card per subject homed on the shelf, findings first', async () => {
		const vehicles = await shelfBy('vehicles');
		const octavia = await createCard({ shelfId: vehicles.id, name: 'Octavia' }, testDb);
		await createCard({ shelfId: vehicles.id, name: 'PCX' }, testDb);
		// Bought in 2022, so 2019 is not a hole.
		await testDb
			.update(subject)
			.set({ activeFrom: '2022-06-01' })
			.where(eq(subject.id, octavia.id));

		const insurance = (await lanesFor(octavia.id, testDb)).find((l) => l.label === 'Insurance')!;
		for (const year of [2023, 2024]) {
			const doc = await makeDocument(testDb, {
				shelfKey: 'vehicles',
				periodOn: `${year}-01-01`,
				type: 'insurance_policy'
			});
			await makeDocumentLink(testDb, { documentId: doc.id, targetId: octavia.id });
			await assignLane(doc.id, insurance.id, testDb);
		}

		const payload = await loadDossier(vehicles, asAdmin, 2026, testDb, TODAY);
		expect(payload.unit).toBe('subject');
		expect(payload.canCreate).toBe(true);
		// The card with a hole leads. That is what the shelf is for.
		expect(payload.cards.map((c) => c.name)).toEqual(['Octavia', 'PCX']);

		const drawn = payload.cards[0].lanes.find((l) => l.label === 'Insurance')!;
		const byYear = Object.fromEntries(drawn.cells.map((c) => [c.key, c.state]));
		expect(byYear['2022']).toBe('gap');
		expect(byYear['2023']).toBe('filed');
		expect(byYear['2024']).toBe('filed');
		expect(byYear['2025']).toBe('gap');
		expect(byYear['2026']).toBe('not-arrived');
		expect(drawn.filed).toBe(2);
		expect(drawn.expected).toBe(4);
		expect(payload.cards[0].findings).toBeGreaterThan(0);
		expect(dossierMissing(payload)).toBeGreaterThanOrEqual(2);
	});

	it('draws a two-year lane as two-year cells', async () => {
		const vehicles = await shelfBy('vehicles');
		const car = await createCard({ shelfId: vehicles.id, name: 'Octavia' }, testDb);
		const inspection = (await lanesFor(car.id, testDb)).find(
			(l) => l.label === 'Technical inspection'
		)!;
		expect(inspection.every).toBe(2);
		const payload = await loadDossier(vehicles, asAdmin, 2026, testDb, TODAY);
		const drawn = payload.cards[0].lanes.find((l) => l.id === inspection.id)!;
		expect(drawn.cells.every((c) => c.span === 2)).toBe(true);
	});

	it('puts paper that names no card on "Not assigned yet", last', async () => {
		const inventory = await shelfBy('inventory');
		await createCard({ shelfId: inventory.id, name: 'Boiler' }, testDb);
		await makeDocument(testDb, { shelfKey: 'inventory', name: 'Loose receipt' });

		const payload = await loadDossier(inventory, asAdmin, 2026, testDb, TODAY);
		const last = payload.cards.at(-1)!;
		expect(last.id).toBeNull();
		expect(last.name).toBe('Not assigned yet');
		expect(last.history.map((d) => d.name)).toEqual(['Loose receipt']);
		// It is not a finding: nobody has said the document is missing anything.
		expect(last.findings).toBe(0);
		expect(dossierMissing(payload)).not.toContain(last.findings + 1);
	});

	it('draws no "Not assigned yet" card when there is nothing loose', async () => {
		const inventory = await shelfBy('inventory');
		await createCard({ shelfId: inventory.id, name: 'Boiler' }, testDb);
		const payload = await loadDossier(inventory, asAdmin, 2026, testDb, TODAY);
		expect(payload.cards.every((c) => c.id !== null)).toBe(true);
	});

	it('a kit card shows three slots and counts the empty ones as missing', async () => {
		const inventory = await shelfBy('inventory');
		const boiler = await createCard({ shelfId: inventory.id, name: 'Boiler' }, testDb);
		const lanes = await lanesFor(boiler.id, testDb);
		const receipt = await makeDocument(testDb, { shelfKey: 'inventory', type: 'receipt' });
		await makeDocumentLink(testDb, { documentId: receipt.id, targetId: boiler.id });
		await assignLane(receipt.id, lanes.find((l) => l.label === 'Receipt')!.id, testDb);

		const payload = await loadDossier(inventory, asAdmin, 2026, testDb, TODAY);
		const card = payload.cards.find((c) => c.name === 'Boiler')!;
		expect(card.lanes.map((l) => [l.label, l.cells[0].state])).toEqual([
			['Receipt', 'filed'],
			['Warranty', 'gap'],
			['Manual', 'gap']
		]);
		// The missing manual is the finding — which is the whole point of drawing
		// a slot that nothing is in.
		expect(card.findings).toBe(2);
	});

	it('draws a card per person on a person shelf, and offers no New card', async () => {
		const health = await shelfBy('health');
		const jana = await makePerson(testDb, { name: 'Jana' });
		await makePerson(testDb, { name: 'Petr' });
		const older = await makeDocument(testDb, {
			shelfKey: 'health',
			addedOn: '2025-01-01',
			name: 'Older'
		});
		const newer = await makeDocument(testDb, {
			shelfKey: 'health',
			addedOn: '2026-01-01',
			name: 'Newer'
		});
		for (const doc of [older, newer])
			await makeDocumentLink(testDb, { documentId: doc.id, targetId: jana.id });

		const payload = await loadDossier(health, asAdmin, 2026, testDb, TODAY);
		// A person has a screen of its own; a card for one exists the moment the
		// person does.
		expect(payload.canCreate).toBe(false);
		expect(payload.cards.filter((c) => c.id !== null)).toHaveLength(2);
		// A timeline reads forwards: the previous result is the context for the
		// current one.
		expect(payload.historyOrder).toBe('oldest');
		expect(payload.cards.find((c) => c.name === 'Jana')!.history.map((d) => d.name)).toEqual([
			'Older',
			'Newer'
		]);
	});

	it('reads history newest first on an ordinary dossier', async () => {
		const vehicles = await shelfBy('vehicles');
		const car = await createCard({ shelfId: vehicles.id, name: 'Octavia' }, testDb);
		for (const [name, on] of [
			['Old claim', '2024-01-01'],
			['New claim', '2026-01-01']
		] as const) {
			const doc = await makeDocument(testDb, { shelfKey: 'vehicles', name, periodOn: on });
			await makeDocumentLink(testDb, { documentId: doc.id, targetId: car.id });
		}
		const payload = await loadDossier(vehicles, asAdmin, 2026, testDb, TODAY);
		expect(payload.historyOrder).toBe('newest');
		expect(payload.cards[0].history.map((d) => d.name)).toEqual(['New claim', 'Old claim']);
	});

	it('hides a restricted document from a member, exactly as the list does', async () => {
		const health = await shelfBy('health');
		const jana = await makePerson(testDb, { name: 'Jana' });
		const secret = await makeDocument(testDb, {
			shelfKey: 'health',
			sensitivity: 'restricted'
		});
		await makeDocumentLink(testDb, { documentId: secret.id, targetId: jana.id });

		const forMember = await loadDossier(health, asMember, 2026, testDb, TODAY);
		expect(forMember.cards.find((c) => c.name === 'Jana')!.documentCount).toBe(0);
		const forAdmin = await loadDossier(health, asAdmin, 2026, testDb, TODAY);
		expect(forAdmin.cards.find((c) => c.name === 'Jana')!.documentCount).toBe(1);
	});

	it('pins the oldest contract on the card', async () => {
		const vehicles = await shelfBy('vehicles');
		const car = await createCard({ shelfId: vehicles.id, name: 'Octavia' }, testDb);
		for (const [name, on] of [
			['Later amendment', '2024-01-01'],
			['Purchase contract', '2021-01-01']
		] as const) {
			const doc = await makeDocument(testDb, {
				shelfKey: 'vehicles',
				name,
				type: 'contract',
				periodOn: on
			});
			await makeDocumentLink(testDb, { documentId: doc.id, targetId: car.id });
		}
		const payload = await loadDossier(vehicles, asAdmin, 2026, testDb, TODAY);
		expect(payload.cards[0].pinned?.name).toBe('Purchase contract');
		// The pinned document is drawn once, at the top — not again in history.
		expect(payload.cards[0].history.map((d) => d.name)).toEqual(['Later amendment']);
	});
});
