// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Filing a tax statement and the paper it came from is one save. The point of
// these tests is the cross-link: the statement points at a document, that
// document is on the Tax shelf, and it is filed against the same person — which
// is what makes it appear in the household's own files rather than nowhere.
import { eq } from 'drizzle-orm';
import { rowId } from '../row-id';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '$lib/server/db/schema';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { saveStatement, statementDocumentName } from '$lib/server/tax';

let harness: Harness;
let testDb: TestDb;
const PERSON = rowId('person-a');

const base = {
	personId: PERSON,
	year: 2025,
	country: 'CZ',
	currency: 'CZK',
	grossIncomeMinor: 1_200_000n,
	taxPaidMinor: 180_000n,
	documentId: null,
	note: null,
	lines: []
};

const upload = {
	storedName: '11111111-1111-1111-1111-111111111111.pdf',
	ext: 'PDF',
	addedOn: '2026-08-22'
};

beforeAll(async () => {
	harness = await startPostgres('tax-statement-document');
	testDb = harness.db;
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 120_000);

afterAll(async () => {
	await harness?.stop();
});

beforeEach(async () => {
	await harness.sql`truncate table entity, person, document, tax_statement restart identity cascade`;
	await testDb.insert(schema.person).values({ id: PERSON, name: 'Person A', initials: 'PA' });
});

describe('a statement that brings its own document', () => {
	it('files the upload on the Tax shelf and points the statement at it', async () => {
		expect(await saveStatement({ ...base, attachment: upload }, testDb)).toEqual({ ok: true });

		const [statement] = await testDb.select().from(schema.taxStatement);
		const [doc] = await testDb.select().from(schema.document);

		expect(statement.documentId).toBe(doc.id);
		expect(doc).toMatchObject({
			shelf: 'tax',
			storedName: upload.storedName,
			ext: 'PDF',
			addedOn: upload.addedOn,
			name: statementDocumentName(2025, 'CZ')
		});
	});

	it('files it against the person whose statement it is', async () => {
		await saveStatement({ ...base, attachment: upload }, testDb);
		const [doc] = await testDb.select().from(schema.document);

		expect(
			await testDb
				.select({ targetId: schema.documentLink.targetId })
				.from(schema.documentLink)
				.where(eq(schema.documentLink.documentId, doc.id))
		).toEqual([{ targetId: PERSON }]);
	});

	it('leaves no document behind when the statement itself fails to save', async () => {
		await harness.sql.unsafe(`
			create function task_fail_tax_statement() returns trigger language plpgsql as $$
			begin raise exception 'injected tax statement failure'; end $$;
			create trigger task_fail_tax_statement before insert on tax_statement
			for each row execute function task_fail_tax_statement();
		`);

		await expect(saveStatement({ ...base, attachment: upload }, testDb)).rejects.toThrow();
		expect(await testDb.select().from(schema.document)).toEqual([]);

		await harness.sql.unsafe(`
			drop trigger task_fail_tax_statement on tax_statement;
			drop function task_fail_tax_statement();
		`);
	});

	it('keeps the earlier document on the shelf when a newer one replaces it', async () => {
		await saveStatement({ ...base, attachment: upload }, testDb);
		await saveStatement(
			{
				...base,
				attachment: { ...upload, storedName: '22222222-2222-2222-2222-222222222222.pdf' }
			},
			testDb
		);

		const docs = await testDb.select().from(schema.document);
		const [statement] = await testDb.select().from(schema.taxStatement);
		// Two documents, one statement: filing a newer copy is not a reason to
		// destroy the older one, but only the newer is what the statement means.
		expect(docs).toHaveLength(2);
		expect(docs.find((d) => d.id === statement.documentId)?.storedName).toBe(
			'22222222-2222-2222-2222-222222222222.pdf'
		);
	});

	it('still honours a document picked from the shelf when nothing is uploaded', async () => {
		await saveStatement({ ...base, attachment: upload }, testDb);
		const [doc] = await testDb.select().from(schema.document);

		await saveStatement({ ...base, documentId: doc.id }, testDb);

		const [statement] = await testDb.select().from(schema.taxStatement);
		expect(statement.documentId).toBe(doc.id);
		expect(await testDb.select().from(schema.document)).toHaveLength(1);
	});
});
