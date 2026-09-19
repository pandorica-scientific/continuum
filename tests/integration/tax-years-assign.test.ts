// SPDX-License-Identifier: AGPL-3.0-or-later
// Membership of a tax year card is what the document SAYS, so assigning one is
// setting those fields. Dropped on a person's cell it is their return; dropped
// on the household's cell it names everyone who owes it — a joint return; with
// nobody named it is supporting paper and keeps its type.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '$lib/server/db/schema';
import { assignToTaxYear } from '$lib/server/documents/tax-years';
import { rowId } from '../row-id';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeDocument, makePerson } from './fixtures';

vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

let harness: Harness;
let testDb: TestDb;
let previousUrl: string | undefined;
const ALICE = rowId('tax-assign-alice');

beforeAll(async () => {
	harness = await startPostgres('tax-years-assign');
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
	await harness.sql`truncate table entity, person, document restart identity cascade`;
	await makePerson(testDb, { id: ALICE, name: 'Alice' });
});

const read = async (id: string) =>
	(
		await testDb
			.select({
				type: schema.document.type,
				periodOn: schema.document.periodOn,
				periodEndOn: schema.document.periodEndOn,
				country: schema.document.country
			})
			.from(schema.document)
			.where(eq(schema.document.id, id))
	)[0];

const linksOf = async (id: string) =>
	(
		await testDb
			.select({ targetId: schema.documentLink.targetId })
			.from(schema.documentLink)
			.where(eq(schema.documentLink.documentId, id))
	).map((l) => l.targetId);

describe('assignToTaxYear', () => {
	it('types, dates, places and links a return in one write', async () => {
		const doc = await makeDocument(testDb, { name: 'Scan 042', type: 'other' });
		await assignToTaxYear(
			{ documentId: doc.id, year: 2025, country: 'cz', personIds: [ALICE] },
			testDb
		);

		// Both period ends: `period_on` alone means the single month it names, so
		// a return dated 2025-01-01 and nothing else would read as January 2025.
		expect(await read(doc.id)).toEqual({
			type: 'tax_document',
			periodOn: '2025-01-01',
			periodEndOn: '2025-12-31',
			country: 'CZ'
		});
		expect(await linksOf(doc.id)).toEqual([ALICE]);
	});

	it('leaves the type alone for supporting paper', async () => {
		const doc = await makeDocument(testDb, { name: 'Employer report', type: 'certificate' });
		await assignToTaxYear({ documentId: doc.id, year: 2025, country: 'CZ' }, testDb);

		// An employer earnings report is not a return. Calling it one would put it
		// in somebody's filed cell and close a gap that is still open.
		expect(await read(doc.id)).toEqual({
			type: 'certificate',
			periodOn: '2025-01-01',
			periodEndOn: '2025-12-31',
			country: 'CZ'
		});
		expect(await linksOf(doc.id)).toEqual([]);
	});

	it('names everyone on the card when dropped on the household cell', async () => {
		const BOB = rowId('tax-assign-bob');
		await makePerson(testDb, { id: BOB, name: 'Bob' });
		const doc = await makeDocument(testDb, { name: 'Joint return', type: 'other' });
		await assignToTaxYear(
			{ documentId: doc.id, year: 2025, country: 'CZ', personIds: [ALICE, BOB] },
			testDb
		);
		// One piece of paper, two true statements.
		expect((await linksOf(doc.id)).sort()).toEqual([ALICE, BOB].sort());
		expect((await read(doc.id)).type).toBe('tax_document');
	});

	it('makes a return into supporting paper by dropping the people it names', async () => {
		const doc = await makeDocument(testDb, { name: 'Mortgage interest', type: 'tax_document' });
		await testDb.insert(schema.documentLink).values({ documentId: doc.id, targetId: ALICE });
		await assignToTaxYear(
			{ documentId: doc.id, year: 2025, country: 'CZ', supporting: true },
			testDb
		);
		// No longer anybody's return; still on the year, still a tax document.
		expect(await linksOf(doc.id)).toEqual([]);
		expect(await read(doc.id)).toMatchObject({ type: 'tax_document', periodOn: '2025-01-01' });
	});

	it('does not mint a second link when the document already names the person', async () => {
		const doc = await makeDocument(testDb, { type: 'tax_document' });
		await testDb.insert(schema.documentLink).values({ documentId: doc.id, targetId: ALICE });
		await assignToTaxYear(
			{ documentId: doc.id, year: 2025, country: 'CZ', personIds: [ALICE] },
			testDb
		);
		expect(await linksOf(doc.id)).toHaveLength(1);
	});
});
