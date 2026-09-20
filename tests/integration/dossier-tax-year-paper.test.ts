// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Paper the Tax years tab accounts for is not drawn again on Employers.
 *
 * The shelf's rule is that everything on it is either on a card or accounted
 * for at the end of it — which is what "Not assigned yet" exists for. On the
 * Income & Tax shelf there is a second tab, and a return already sitting on a
 * (year, country) card IS accounted for. Drawing it a second time under "Not
 * assigned yet" said it was homeless when it was not.
 *
 * The narrow case this must not break: a card the household has DISMISSED
 * (`tax_filing_override`, household level, `expected: false`) is not drawn, so
 * paper filed to it is accounted for nowhere else and has to stay on the loose
 * card. Losing a document quietly is far worse than drawing it twice.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { taxFilingOverride } from '$lib/server/db/schema';
import { loadDossier } from '$lib/server/documents/dossier-load';
import { listShelves } from '$lib/server/documents/shelves';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeDocument, makePerson } from './fixtures';

let harness: Harness;
let testDb: TestDb;

beforeAll(async () => {
	harness = await startPostgres('dossier-tax-year-paper');
	testDb = harness.db;
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 120_000);

afterAll(async () => {
	await harness?.stop();
});

beforeEach(async () => {
	await harness.sql`truncate document, organisation, entity, person, tax_filing_override cascade`;
});

/** A shelf row as `loadDossier` takes one, by the key a reader recognises. */
async function shelfNamed(key: string) {
	const row = (await listShelves(testDb)).find((one) => one.key === key);
	if (!row) throw new Error(`No shelf with key "${key}".`);
	return row;
}

/** A loose tax document — naming no card — for a (year, country). */
async function looseReturn(name: string, year: number, country: string, type = 'tax_document') {
	return makeDocument(testDb, {
		name,
		shelfKey: 'income_tax',
		type,
		country,
		periodOn: `${year}-01-01`,
		periodEndOn: `${year}-12-31`
	});
}

const looseCard = (payload: Awaited<ReturnType<typeof loadDossier>>) =>
	payload.cards.find((card) => card.id === null) ?? null;

describe('the loose card on Income & Tax', () => {
	it('does not draw a return that is already on a tax year', async () => {
		await looseReturn('2025 CZ tax statement', 2025, 'CZ');

		const payload = await loadDossier(await shelfNamed('income_tax'), 2025, testDb);

		// Not merely empty — gone. A card with nothing in it is not drawn at all.
		expect(looseCard(payload)).toBeNull();
	});

	it('still draws a return that names no year, which is genuinely homeless', async () => {
		await makeDocument(testDb, {
			name: 'Some tax paper',
			shelfKey: 'income_tax',
			type: 'tax_document'
		});

		const payload = await loadDossier(await shelfNamed('income_tax'), 2025, testDb);

		expect(looseCard(payload)?.history.map((d) => d.name)).toEqual(['Some tax paper']);
	});

	// The hole this closes: no card is drawn for a dismissed year, so the
	// document would be accounted for by neither tab.
	it('keeps paper filed to a year the household has dismissed', async () => {
		await looseReturn('2025 CZ tax statement', 2025, 'CZ');
		await testDb.insert(taxFilingOverride).values({
			id: uuidv7(),
			year: 2025,
			country: 'CZ',
			personId: null,
			expected: false
		});

		const payload = await loadDossier(await shelfNamed('income_tax'), 2025, testDb);

		expect(looseCard(payload)?.history.map((d) => d.name)).toEqual(['2025 CZ tax statement']);
	});

	// A per-person override says who owes a return, not whether the card exists.
	it('ignores a per-person override, which does not remove the card', async () => {
		await looseReturn('2025 CZ tax statement', 2025, 'CZ');
		const somebody = await makePerson(testDb);
		await testDb.insert(taxFilingOverride).values({
			id: uuidv7(),
			year: 2025,
			country: 'CZ',
			personId: somebody.id,
			expected: false
		});

		const payload = await loadDossier(await shelfNamed('income_tax'), 2025, testDb);

		expect(looseCard(payload)).toBeNull();
	});

	// Only a `tax_document` creates a filing, so only it is certain to have a
	// card. Anything else keeps its place on the loose card.
	it('still draws a broker report, which creates no filing of its own', async () => {
		await looseReturn('2025 PL broker report', 2025, 'PL', 'broker_report');

		const payload = await loadDossier(await shelfNamed('income_tax'), 2025, testDb);

		expect(looseCard(payload)?.history.map((d) => d.name)).toEqual(['2025 PL broker report']);
	});

	// The rule is the Income & Tax shelf's, because it is the only shelf with a
	// Tax years tab to be accounted for on. Anywhere else there is no second
	// place for the paper to be, so it stays drawn.
	it('draws tax-year paper on a shelf that has no Tax years tab', async () => {
		const property = await shelfNamed('property');
		await makeDocument(testDb, {
			name: '2025 CZ something',
			shelfId: property.id,
			type: 'tax_document',
			country: 'CZ',
			periodOn: '2025-01-01',
			periodEndOn: '2025-12-31'
		});

		const payload = await loadDossier(property, 2025, testDb);

		expect(looseCard(payload)?.history.map((d) => d.name)).toEqual(['2025 CZ something']);
	});
});
