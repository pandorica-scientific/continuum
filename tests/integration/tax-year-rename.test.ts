// SPDX-License-Identifier: AGPL-3.0-or-later
// `assignToTaxYear` moves a document's year and country. A name derived from
// the old pair then states something false — but only a name this code
// derived may be re-derived, because a name somebody typed is one they meant.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import * as schema from '$lib/server/db/schema';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeDocument } from './fixtures';
import { assignToTaxYear } from '$lib/server/documents/tax-years';

let harness: Harness;
let testDb: TestDb;

beforeAll(async () => {
	harness = await startPostgres('tax-year-rename');
	testDb = harness.db;
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 120_000);

afterAll(async () => {
	await harness?.stop();
});

beforeEach(async () => {
	await harness.sql`truncate entity, person, document, tag, tag_link cascade`;
});

/** A tax attachment as `attachDocumentsToStatement` files one, tag included. */
async function filed(name: string, country: string, year: number, tagName: string) {
	const doc = await makeDocument(testDb, {
		name,
		shelfKey: 'income_tax',
		type: 'tax_document',
		country,
		periodOn: `${year}-01-01`,
		periodEndOn: `${year}-12-31`
	});
	const [row] = await testDb
		.insert(schema.tag)
		.values({ id: uuidv7(), name: tagName, normalisedName: tagName.toLowerCase() })
		.returning();
	await testDb.insert(schema.tagLink).values({ tagId: row.id, targetId: doc.id });
	return doc;
}

const nameOf = async (id: string) =>
	(
		await testDb
			.select({ name: schema.document.name })
			.from(schema.document)
			.where(eq(schema.document.id, id))
	)[0].name;

describe('renaming a tax document that moves', () => {
	// The live fault: dropped on the PL card, country moved, name did not.
	it('renames a derived name when the document moves country', async () => {
		const doc = await filed(
			'2025 CZ tax statement · 0_Poland_IFT-1R.pdf',
			'CZ',
			2025,
			'tax statement'
		);

		await assignToTaxYear({ documentId: doc.id, year: 2025, country: 'PL' }, testDb);

		expect(await nameOf(doc.id)).toBe('2025 PL tax statement · 0_Poland_IFT-1R.pdf');
	});

	it('renames a derived name with no filename suffix', async () => {
		const doc = await filed('2025 CZ broker earnings report', 'CZ', 2025, 'broker report');

		await assignToTaxYear({ documentId: doc.id, year: 2025, country: 'PL' }, testDb);

		expect(await nameOf(doc.id)).toBe('2025 PL broker earnings report');
	});

	it('renames when the document moves year', async () => {
		const doc = await filed('2024 CZ tax statement', 'CZ', 2024, 'tax statement');

		await assignToTaxYear({ documentId: doc.id, year: 2025, country: 'CZ' }, testDb);

		expect(await nameOf(doc.id)).toBe('2025 CZ tax statement');
	});

	// The guard that matters.
	it('leaves a hand-renamed document alone', async () => {
		const doc = await filed('Polish broker paperwork', 'CZ', 2025, 'broker report');

		await assignToTaxYear({ documentId: doc.id, year: 2025, country: 'PL' }, testDb);

		expect(await nameOf(doc.id)).toBe('Polish broker paperwork');
	});

	it('leaves a document carrying no attachment tag alone', async () => {
		const doc = await filed('Payslip 2025-03 · Robert', 'CZ', 2025, 'holiday');

		await assignToTaxYear({ documentId: doc.id, year: 2025, country: 'PL' }, testDb);

		expect(await nameOf(doc.id)).toBe('Payslip 2025-03 · Robert');
	});
});
