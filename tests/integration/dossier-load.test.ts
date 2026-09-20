// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What a dossier shelf draws.
 *
 * Cards come from whatever the shelf's unit says, and a document is in a lane
 * because somebody put it there — never because of a name match.
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
import { makeDocument, makeDocumentLink, makeEngagement, makeLane, makePerson } from './fixtures';

vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

let harness: Harness;
let testDb: TestDb;
let previousUrl: string | undefined;

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

		const payload = await loadDossier(vehicles, 2026, testDb, TODAY);
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
		// Owned since 2022, so the lane has a real gap to draw — an empty lane
		// with no evidence at all does not render (see "hides a lane" below).
		await testDb.update(subject).set({ activeFrom: '2022-06-01' }).where(eq(subject.id, car.id));
		const inspection = (await lanesFor(car.id, testDb)).find(
			(l) => l.label === 'Technical inspection'
		)!;
		expect(inspection.every).toBe(2);
		const payload = await loadDossier(vehicles, 2026, testDb, TODAY);
		const drawn = payload.cards[0].lanes.find((l) => l.id === inspection.id)!;
		expect(drawn.cells.every((c) => c.span === 2)).toBe(true);
	});

	it('puts paper that names no card on "Not assigned yet", last', async () => {
		const inventory = await shelfBy('inventory');
		await createCard({ shelfId: inventory.id, name: 'Boiler' }, testDb);
		await makeDocument(testDb, { shelfKey: 'inventory', name: 'Loose receipt' });

		const payload = await loadDossier(inventory, 2026, testDb, TODAY);
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
		const payload = await loadDossier(inventory, 2026, testDb, TODAY);
		expect(payload.cards.every((c) => c.id !== null)).toBe(true);
	});

	it("hides an empty SCHEDULED lane, but keeps the cadence-less one as the card's general place", async () => {
		const incomeTax = await shelfBy('income_tax');
		const msd = await createCard(
			{ shelfId: incomeTax.id, name: 'MSD Czech Republic', kind: 'employer' },
			testDb
		);
		const lanes = await lanesFor(msd.id, testDb);
		const payslips = lanes.find((l) => l.label === 'Payslips')!;
		const doc = await makeDocument(testDb, {
			shelfKey: 'income_tax',
			type: 'payslip',
			periodOn: '2026-01-01'
		});
		await makeDocumentLink(testDb, { documentId: doc.id, targetId: msd.id });
		await assignLane(doc.id, payslips.id, testDb);

		const payload = await loadDossier(incomeTax, 2026, testDb, TODAY);
		const drawnLabels = payload.cards[0].lanes.map((l) => l.label);
		// Payslips has something filed, so it draws. The yearly declaration has
		// neither a filing nor a gap, so it does not. The three cadence-less rows
		// stay visible even with nothing in them yet, or there would be no sign
		// those places exist — which is the whole point of naming them.
		expect(drawnLabels).toEqual(['Payslips', 'Annexes', 'Contract', 'HR']);
	});

	it('a kit card shows three slots and counts the empty ones as missing', async () => {
		const inventory = await shelfBy('inventory');
		const boiler = await createCard({ shelfId: inventory.id, name: 'Boiler' }, testDb);
		const lanes = await lanesFor(boiler.id, testDb);
		const receipt = await makeDocument(testDb, { shelfKey: 'inventory', type: 'receipt' });
		await makeDocumentLink(testDb, { documentId: receipt.id, targetId: boiler.id });
		await assignLane(receipt.id, lanes.find((l) => l.label === 'Receipt')!.id, testDb);

		const payload = await loadDossier(inventory, 2026, testDb, TODAY);
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

		const payload = await loadDossier(health, 2026, testDb, TODAY);
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
		const payload = await loadDossier(vehicles, 2026, testDb, TODAY);
		expect(payload.historyOrder).toBe('newest');
		expect(payload.cards[0].history.map((d) => d.name)).toEqual(['New claim', 'Old claim']);
	});

	it('counts the paper filed against a card', async () => {
		const health = await shelfBy('health');
		const jana = await makePerson(testDb, { name: 'Jana' });
		const filed = await makeDocument(testDb, { shelfKey: 'health' });
		await makeDocumentLink(testDb, { documentId: filed.id, targetId: jana.id });

		const payload = await loadDossier(health, 2026, testDb, TODAY);
		expect(payload.cards.find((c) => c.name === 'Jana')!.documentCount).toBe(1);
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
		const payload = await loadDossier(vehicles, 2026, testDb, TODAY);
		expect(payload.cards[0].pinned?.name).toBe('Purchase contract');
		// The pinned document is drawn once, at the top — not again in history.
		expect(payload.cards[0].history.map((d) => d.name)).toEqual(['Later amendment']);
	});
});

describe('year navigation and a role period ending', () => {
	it('lets "Previous year" go all the way back to the earliest paper actually filed', async () => {
		// Regression: firstYear used to be read off the monthly cells `buildLane`
		// draws for the year ON SCREEN — which always carry that same year, so
		// the bound was always wherever you already were, and "Previous year"
		// stayed disabled forever the moment any card had a monthly lane.
		const incomeTax = await shelfBy('income_tax');
		const person = await makePerson(testDb, { name: 'Robert' });
		const msd = await createCard(
			{ shelfId: incomeTax.id, name: 'MSD Czech Republic', kind: 'employer' },
			testDb
		);
		await makeEngagement(testDb, {
			personId: person.id,
			organisationId: msd.id,
			startsOn: '2025-01-01'
		});
		const payslips = (await lanesFor(msd.id, testDb)).find((l) => l.label === 'Payslips')!;
		const slip = await makeDocument(testDb, {
			shelfKey: 'income_tax',
			type: 'payslip',
			periodOn: '2025-06-01'
		});
		await makeDocumentLink(testDb, { documentId: slip.id, targetId: msd.id });
		await assignLane(slip.id, payslips.id, testDb);

		const payload = await loadDossier(incomeTax, 2026, testDb, TODAY);
		expect(payload.firstYear).toBeLessThanOrEqual(2025);
	});

	it('stops expecting monthly paper the month after a role period closed', async () => {
		// Regression: switching employer mid-year left the one just left
		// "missing" payslips for every month after, since only the start of an
		// engagement bounded a monthly lane, never its end.
		const incomeTax = await shelfBy('income_tax');
		const person = await makePerson(testDb, { name: 'Robert' });
		const previous = await createCard(
			{ shelfId: incomeTax.id, name: 'Old Employer', kind: 'employer' },
			testDb
		);
		await makeEngagement(testDb, {
			personId: person.id,
			organisationId: previous.id,
			startsOn: '2025-01-01',
			endsOn: '2026-06-15'
		});
		const payslips = (await lanesFor(previous.id, testDb)).find((l) => l.label === 'Payslips')!;
		for (const periodOn of [
			'2026-01-01',
			'2026-02-01',
			'2026-03-01',
			'2026-04-01',
			'2026-05-01',
			'2026-06-01'
		]) {
			const doc = await makeDocument(testDb, { shelfKey: 'income_tax', type: 'payslip', periodOn });
			await makeDocumentLink(testDb, { documentId: doc.id, targetId: previous.id });
			await assignLane(doc.id, payslips.id, testDb);
		}

		const payload = await loadDossier(incomeTax, 2026, testDb, TODAY);
		const drawn = payload.cards[0].lanes.find((l) => l.label === 'Payslips')!;
		const byMonth = Object.fromEntries(drawn.cells.map((c) => [c.key, c.state]));
		for (const m of ['01', '02', '03', '04', '05', '06'])
			expect(byMonth[`2026-${m}`]).toBe('filed');
		for (const m of ['07', '08', '09']) expect(byMonth[`2026-${m}`]).toBe('before');
		// The Payslips lane itself has nothing missing — the "declaration" lane
		// (bounded at the year the role ended, not the month, see buildLane) is
		// a separate matter and isn't what this test is about.
		expect(drawn.gaps).toBe(0);
	});

	it('stops expecting a yearly declaration after the year a role period closed', async () => {
		// Regression: a yearly lane correctly still expects the partial year a
		// job ended in (a declaration is owed however early in the year someone
		// left), but kept running every year up to today after that — a job
		// left in 2023 read as missing a 2024 and 2025 declaration forever.
		const incomeTax = await shelfBy('income_tax');
		const person = await makePerson(testDb, { name: 'Robert' });
		const previous = await createCard(
			{ shelfId: incomeTax.id, name: 'Old Employer', kind: 'employer' },
			testDb
		);
		await makeEngagement(testDb, {
			personId: person.id,
			organisationId: previous.id,
			startsOn: '2021-12-01',
			endsOn: '2023-09-29'
		});
		// Added rather than seeded: an employer no longer expects a yearly
		// declaration (that is the tax year card's job now), but the rule this
		// test holds governs EVERY yearly lane — an authority's return, a car's
		// road tax — so the lane is built here instead of being borrowed from a
		// preset that no longer has one.
		const declaration = await makeLane(testDb, {
			entityId: previous.id,
			label: 'Once a year · declaration, annual settlement',
			cadence: 'yearly',
			every: 1,
			sortOrder: 5
		});
		const doc = await makeDocument(testDb, {
			shelfKey: 'income_tax',
			type: 'tax_document',
			periodOn: '2021-01-01'
		});
		await makeDocumentLink(testDb, { documentId: doc.id, targetId: previous.id });
		await assignLane(doc.id, declaration.id, testDb);

		const payload = await loadDossier(incomeTax, 2026, testDb, TODAY);
		const drawn = payload.cards[0].lanes.find((l) => l.id === declaration.id)!;
		const byYear = Object.fromEntries(drawn.cells.map((c) => [c.key, c.state]));
		expect(byYear['2021']).toBe('filed');
		expect(byYear['2022']).toBe('gap');
		// The role ended partway through 2023 — still owed, still drawn.
		expect(byYear['2023']).toBe('gap');
		// Nothing after: the relationship was over, so there is nothing to owe.
		expect(byYear['2024']).toBeUndefined();
		expect(byYear['2025']).toBeUndefined();
		expect(byYear['2026']).toBeUndefined();
	});

	it('reads employment history the way it was lived: current job(s) first, then newest-ended to oldest-ended', async () => {
		const incomeTax = await shelfBy('income_tax');
		const person = await makePerson(testDb, { name: 'Robert' });
		const current = await createCard(
			{ shelfId: incomeTax.id, name: 'MSD Czech Republic', kind: 'employer' },
			testDb
		);
		const recentlyLeft = await createCard(
			{ shelfId: incomeTax.id, name: 'Oyster Czech Republic', kind: 'employer' },
			testDb
		);
		const leftLongAgo = await createCard(
			{ shelfId: incomeTax.id, name: 'Institute of Physics CAS', kind: 'employer' },
			testDb
		);
		await makeEngagement(testDb, {
			personId: person.id,
			organisationId: current.id,
			startsOn: '2026-07-01'
		});
		await makeEngagement(testDb, {
			personId: person.id,
			organisationId: recentlyLeft.id,
			startsOn: '2025-01-01',
			endsOn: '2026-06-30'
		});
		await makeEngagement(testDb, {
			personId: person.id,
			organisationId: leftLongAgo.id,
			startsOn: '2018-09-01',
			endsOn: '2021-08-31'
		});

		const payload = await loadDossier(incomeTax, 2026, testDb, TODAY);
		expect(payload.cards.map((c) => c.name)).toEqual([
			'MSD Czech Republic',
			'Oyster Czech Republic',
			'Institute of Physics CAS'
		]);
	});
});
