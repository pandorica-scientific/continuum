// SPDX-License-Identifier: AGPL-3.0-or-later
// A tax year card is drawn and not stored: which cards exist comes from when
// people were employed and where the household has already filed, and what each
// row says comes from the paper filed for that year and country.
//
// The case that started this: one joint return is one document naming both
// people, and it fills both rows.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '$lib/server/db/schema';
import { loadTaxYears } from '$lib/server/documents/tax-years';
import { rowId } from '../row-id';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import {
	makeDocument,
	makeDocumentLink,
	makeEngagement,
	makeOrganisation,
	makePerson
} from './fixtures';

vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

let harness: Harness;
let testDb: TestDb;
let previousUrl: string | undefined;

const TODAY = '2026-09-19';
const ALICE = rowId('tax-years-alice');
const BOB = rowId('tax-years-bob');

beforeAll(async () => {
	harness = await startPostgres('tax-years-load');
	testDb = harness.db;
	previousUrl = process.env.DATABASE_URL;
	process.env.DATABASE_URL = harness.url;
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 120_000);

afterAll(async () => {
	await harness?.stop();
	if (previousUrl === undefined) delete process.env.DATABASE_URL;
	else process.env.DATABASE_URL = previousUrl;
});

beforeEach(async () => {
	await harness.sql`truncate table entity, person, document, organisation, engagement, tax_statement, tax_filing_override restart identity cascade`;
	await makePerson(testDb, { id: ALICE, name: 'Alice' });
	await makePerson(testDb, { id: BOB, name: 'Bob' });
	const employer = await makeOrganisation(testDb, {
		name: 'Alphabet',
		kind: 'employer',
		country: 'CZ'
	});
	for (const personId of [ALICE, BOB]) {
		await makeEngagement(testDb, {
			personId,
			organisationId: employer.id,
			startsOn: '2024-01-01',
			endsOn: null
		});
	}
	// A filing already on record. The employer's country is what draws the
	// cards; this is the other source, and the test below takes both away.
	await testDb.insert(schema.taxStatement).values({
		id: rowId('tax-years-statement-2024'),
		personId: ALICE,
		year: 2024,
		country: 'CZ',
		currency: 'CZK',
		grossIncomeMinor: 1_200_000n,
		taxPaidMinor: 180_000n
	});
});

/** A return for `year`, naming everyone in `people`. Both period ends, as the real writer sets them. */
async function fileReturn(year: number, people: string[], country = 'CZ') {
	const doc = await makeDocument(testDb, {
		name: `${year} ${country} tax statement`,
		shelfKey: 'income_tax',
		type: 'tax_document',
		periodOn: `${year}-01-01`,
		periodEndOn: `${year}-12-31`,
		country
	});
	for (const targetId of people) await makeDocumentLink(testDb, { documentId: doc.id, targetId });
	return doc;
}

describe('loadTaxYears', () => {
	it('draws a card per year from the earliest engagement to this one', async () => {
		const payload = await loadTaxYears(testDb, TODAY);
		expect(payload.cards.map((c) => `${c.year} ${c.country}`)).toEqual([
			'2026 CZ',
			'2025 CZ',
			'2024 CZ'
		]);
	});

	it('draws nothing when no employer has a country and nothing is filed', async () => {
		await harness.sql`delete from tax_statement`;
		await harness.sql`update organisation set country = null`;
		const payload = await loadTaxYears(testDb, TODAY);
		expect(payload.cards).toEqual([]);
		// And says which employer is the reason, rather than staying quiet.
		expect(payload.unplacedOrganisations.map((o) => o.name)).toEqual(['Alphabet']);
	});

	// The reason the first derivation was thrown away.
	it('follows a career across countries year by year', async () => {
		await harness.sql`delete from tax_statement`;
		await harness.sql`delete from engagement`;
		const spain = await makeOrganisation(testDb, { name: 'CSIC', kind: 'employer', country: 'ES' });
		const czech = await makeOrganisation(testDb, { name: 'MSD', kind: 'employer', country: 'CZ' });
		await makeEngagement(testDb, {
			personId: ALICE,
			organisationId: spain.id,
			startsOn: '2023-01-01',
			endsOn: '2024-05-31'
		});
		await makeEngagement(testDb, {
			personId: ALICE,
			organisationId: czech.id,
			startsOn: '2024-06-01',
			endsOn: null
		});
		const payload = await loadTaxYears(testDb, TODAY);
		expect(payload.cards.map((c) => `${c.year} ${c.country}`)).toEqual([
			'2026 CZ',
			'2025 CZ',
			'2024 CZ',
			'2024 ES',
			'2023 ES'
		]);
	});

	it('fills both rows from one joint return', async () => {
		await fileReturn(2025, [ALICE, BOB]);
		const payload = await loadTaxYears(testDb, TODAY);
		const card = payload.cards.find((c) => c.year === 2025);
		expect(card?.rows.map((r) => r.state)).toEqual(['filed', 'filed']);
		expect(card?.gaps).toBe(0);
	});

	it('leaves the other person a gap when only one has filed', async () => {
		await fileReturn(2025, [ALICE]);
		const payload = await loadTaxYears(testDb, TODAY);
		const card = payload.cards.find((c) => c.year === 2025);
		expect(card?.rows.map((r) => [r.personName, r.state])).toEqual([
			['Alice', 'filed'],
			['Bob', 'gap']
		]);
	});

	// A return for a year still running is not late.
	it('leaves the current year open rather than red', async () => {
		const payload = await loadTaxYears(testDb, TODAY);
		const card = payload.cards.find((c) => c.year === 2026);
		expect(card?.rows.every((r) => r.state === 'open')).toBe(true);
		expect(card?.gaps).toBe(0);
	});

	it('lists other paper as supporting, never as a filing', async () => {
		await makeDocument(testDb, {
			name: '2025 CZ employer earnings report',
			shelfKey: 'income_tax',
			type: 'certificate',
			periodOn: '2025-01-01',
			periodEndOn: '2025-12-31',
			country: 'CZ'
		});
		const payload = await loadTaxYears(testDb, TODAY);
		const card = payload.cards.find((c) => c.year === 2025);
		expect(card?.supporting.map((d) => d.name)).toEqual(['2025 CZ employer earnings report']);
		expect(card?.rows.every((r) => r.state === 'gap')).toBe(true);
	});

	// A mortgage-interest certificate: a tax document that names nobody. It is
	// the paper behind a return, and it must be listed, not lost.
	it('lists a tax document naming nobody as supporting paper', async () => {
		await makeDocument(testDb, {
			name: '2025 CZ mortgage interest',
			shelfKey: 'income_tax',
			type: 'tax_document',
			periodOn: '2025-01-01',
			periodEndOn: '2025-12-31',
			country: 'CZ'
		});
		const payload = await loadTaxYears(testDb, TODAY);
		const card = payload.cards.find((c) => c.year === 2025)!;
		expect(card.supporting.map((d) => d.name)).toEqual(['2025 CZ mortgage interest']);
		expect(card.rows.every((r) => r.state === 'gap')).toBe(true);
	});

	it("keeps another country's paper off this country's card", async () => {
		await fileReturn(2025, [ALICE], 'AT');
		const payload = await loadTaxYears(testDb, TODAY);
		expect(payload.cards.find((c) => c.year === 2025 && c.country === 'CZ')?.gaps).toBe(2);
	});

	it('hides a card the household dismissed', async () => {
		await testDb.insert(schema.taxFilingOverride).values({
			id: rowId('tax-years-dismiss-2024'),
			year: 2024,
			country: 'CZ',
			personId: null,
			expected: false
		});
		const payload = await loadTaxYears(testDb, TODAY);
		expect(payload.cards.map((c) => c.year)).toEqual([2026, 2025]);
	});
});
