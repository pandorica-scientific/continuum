// SPDX-License-Identifier: AGPL-3.0-or-later
// The same bytes cannot be two attachments on one statement. Scoped to the
// statement, not the archive: one certificate can legitimately support two
// years' returns, and refusing the second would refuse a true fact.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import * as schema from '$lib/server/db/schema';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makePerson } from './fixtures';
import { attachDocumentsToStatement } from '$lib/server/tax';

let harness: Harness;
let testDb: TestDb;

beforeAll(async () => {
	harness = await startPostgres('tax-attachments-dedupe');
	testDb = harness.db;
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 120_000);

afterAll(async () => {
	await harness?.stop();
});

beforeEach(async () => {
	await harness.sql`truncate entity, person, document, tax_statement, tag, tag_link cascade`;
});

/** A statement to hang attachments off. Returns its id. */
async function makeStatement(personId: string, year: number, country: string): Promise<string> {
	const id = uuidv7();
	await testDb.insert(schema.taxStatement).values({
		id,
		personId,
		year,
		country,
		currency: 'CZK',
		grossIncomeMinor: 0n,
		taxPaidMinor: 0n,
		note: null
	});
	return id;
}

const upload = (storedName: string, original: string, contentHash: string) => ({
	storedName,
	ext: 'pdf',
	addedOn: '2026-09-19',
	kind: 'broker' as const,
	original,
	contentHash
});

describe('duplicate tax attachments', () => {
	it('files the same bytes against one statement only once', async () => {
		const person = await makePerson(testDb);
		const statementId = await makeStatement(person.id, 2025, 'CZ');

		const first = await attachDocumentsToStatement(
			statementId,
			person.id,
			2025,
			'CZ',
			[upload('a.pdf', 'report.pdf', 'HASH-A')],
			testDb
		);
		const second = await attachDocumentsToStatement(
			statementId,
			person.id,
			2025,
			'CZ',
			[upload('b.pdf', 'report-again.pdf', 'HASH-A')],
			testDb
		);

		expect(first.filedIds).toHaveLength(1);
		expect(second.filedIds).toHaveLength(0);
		expect(second.skipped).toEqual([
			{ original: 'report-again.pdf', existingName: '2025 CZ broker earnings report' }
		]);
	});

	it('dedupes two identical files inside ONE batch', async () => {
		const person = await makePerson(testDb);
		const statementId = await makeStatement(person.id, 2025, 'CZ');

		const result = await attachDocumentsToStatement(
			statementId,
			person.id,
			2025,
			'CZ',
			[upload('a.pdf', 'one.pdf', 'HASH-A'), upload('b.pdf', 'two.pdf', 'HASH-A')],
			testDb
		);

		expect(result.filedIds).toHaveLength(1);
		expect(result.skipped).toHaveLength(1);
	});

	// A certificate can support two years' returns. That is not a duplicate.
	it('still files the same bytes against a different statement', async () => {
		const person = await makePerson(testDb);
		const a = await makeStatement(person.id, 2024, 'CZ');
		const b = await makeStatement(person.id, 2025, 'CZ');

		const first = await attachDocumentsToStatement(
			a,
			person.id,
			2024,
			'CZ',
			[upload('a.pdf', 'r.pdf', 'HASH-A')],
			testDb
		);
		const second = await attachDocumentsToStatement(
			b,
			person.id,
			2025,
			'CZ',
			[upload('b.pdf', 'r.pdf', 'HASH-A')],
			testDb
		);

		expect(first.filedIds).toHaveLength(1);
		expect(second.filedIds).toHaveLength(1);
		expect(second.skipped).toHaveLength(0);
	});

	// The existing name-collision rule must survive: two real reports in one
	// year are two files, and the second carries its filename.
	it('files two genuinely different files of one kind in one year', async () => {
		const person = await makePerson(testDb);
		const statementId = await makeStatement(person.id, 2025, 'CZ');

		await attachDocumentsToStatement(
			statementId,
			person.id,
			2025,
			'CZ',
			[upload('a.pdf', 'first.pdf', 'HASH-A')],
			testDb
		);
		const second = await attachDocumentsToStatement(
			statementId,
			person.id,
			2025,
			'CZ',
			[upload('b.pdf', 'second.pdf', 'HASH-B')],
			testDb
		);

		expect(second.filedIds).toHaveLength(1);
		const docs = await testDb
			.select({ name: schema.document.name })
			.from(schema.document)
			.where(eq(schema.document.type, 'tax_document'));
		expect(docs.map((d) => d.name)).toContain('2025 CZ broker earnings report · second.pdf');
	});
});
