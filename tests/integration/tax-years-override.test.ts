// SPDX-License-Identifier: AGPL-3.0-or-later
// The cards are derived; this is the household overruling the derivation. A row
// is an upsert on (year, country, person_id), so saying the same thing twice is
// a person pressing a button twice rather than a constraint violation — which
// only works because the unique index is NULLS NOT DISTINCT.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '$lib/server/db/schema';
import { loadTaxYears, setTaxFilingExpected } from '$lib/server/documents/tax-years';
import { rowId } from '../row-id';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeEngagement, makeOrganisation, makePerson } from './fixtures';

vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

let harness: Harness;
let testDb: TestDb;
let previousUrl: string | undefined;

const TODAY = '2026-09-19';
const ALICE = rowId('tax-override-alice');
const BOB = rowId('tax-override-bob');

beforeAll(async () => {
	harness = await startPostgres('tax-years-override');
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
	await makeEngagement(testDb, {
		personId: ALICE,
		organisationId: employer.id,
		startsOn: '2025-01-01',
		endsOn: null
	});
});

describe('setTaxFilingExpected', () => {
	it('adds a card for a country nothing else points at', async () => {
		// The Czech employer already draws its years; Austria is nowhere yet.
		const keys = async () =>
			(await loadTaxYears(testDb, TODAY)).cards.map((c) => `${c.year} ${c.country}`);
		expect(await keys()).toEqual(['2026 CZ', '2025 CZ']);

		await setTaxFilingExpected({ year: 2025, country: 'at', expected: true }, testDb);

		expect(await keys()).toEqual(['2026 CZ', '2025 AT', '2025 CZ']);
	});

	it('is idempotent on the card itself', async () => {
		await setTaxFilingExpected({ year: 2025, country: 'AT', expected: true }, testDb);
		await setTaxFilingExpected({ year: 2025, country: 'AT', expected: false }, testDb);

		// One row, flipped — not two rows disagreeing.
		const rows = await testDb.select().from(schema.taxFilingOverride);
		expect(rows).toHaveLength(1);
		expect(rows[0].expected).toBe(false);
		// And the card it added is gone, with the employer's own cards untouched.
		const cards = (await loadTaxYears(testDb, TODAY)).cards;
		expect(cards.some((c) => c.country === 'AT')).toBe(false);
		expect(cards.map((c) => `${c.year} ${c.country}`)).toEqual(['2026 CZ', '2025 CZ']);
	});

	it('puts a person with no income on a return', async () => {
		await setTaxFilingExpected({ year: 2025, country: 'CZ', expected: true }, testDb);
		await setTaxFilingExpected(
			{ year: 2025, country: 'CZ', personId: BOB, expected: true },
			testDb
		);

		const card = (await loadTaxYears(testDb, TODAY)).cards.find((c) => c.year === 2025);
		expect(card?.rows.map((r) => r.personName)).toEqual(['Alice', 'Bob']);
	});

	it('takes a person off a return without touching the card', async () => {
		await setTaxFilingExpected({ year: 2025, country: 'CZ', expected: true }, testDb);
		await setTaxFilingExpected(
			{ year: 2025, country: 'CZ', personId: ALICE, expected: false },
			testDb
		);

		const card = (await loadTaxYears(testDb, TODAY)).cards.find((c) => c.year === 2025);
		expect(card).toBeDefined();
		expect(card?.rows).toEqual([]);
	});

	it('refuses a country that is not a code', async () => {
		await expect(
			setTaxFilingExpected({ year: 2025, country: 'Austria', expected: true }, testDb)
		).rejects.toThrow(/country code/);
	});
});
