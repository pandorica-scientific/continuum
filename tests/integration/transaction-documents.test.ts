// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { eq } from 'drizzle-orm';
import { rowId } from '../row-id';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '$lib/server/db/schema';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import {
	attachDocumentToTransaction,
	detachDocumentFromTransaction,
	loadTransactionDocuments
} from '$lib/server/transactions/documents';
import { createDocument, deleteDocument } from '$lib/server/documents/mutations';
import { upsertTag } from '$lib/server/tags';
import { shelfIdByKey } from '$lib/server/documents/shelves';

let harness: Harness;
let testDb: TestDb;
const ACCOUNT = rowId('account-a');
const TXN = rowId('txn-a');
const OTHER_TXN = rowId('txn-b');
const DOC = rowId('doc-a');

async function addDocument(id: string, name: string) {
	await createDocument(
		{
			id,
			name,
			shelfId: await shelfIdByKey('family', testDb),
			type: 'other',
			storedName: `${id}.pdf`,
			ext: 'PDF',
			addedOn: '2026-07-20',
			expiresOn: null,
			expiryVerb: 'expires',
			personIds: [],
			propertyIds: [],
			accountIds: [],
			transactionIds: [],
			subjectIds: [],
			tagNames: []
		},
		testDb
	);
}

/** A tag to hang on a document, so the cascade has something to take with it. */
async function aTag(): Promise<string> {
	// Through upsertTag, not a raw insert: `normalised_name` is what the table
	// deduplicates on and the mutation is what fills it.
	return (await upsertTag('receipt', testDb)).id;
}

beforeAll(async () => {
	harness = await startPostgres('transaction-documents');
	testDb = harness.db;
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 120_000);

afterAll(async () => {
	await harness?.stop();
});

beforeEach(async () => {
	await harness.sql`truncate account, document cascade`;
	await testDb
		.insert(schema.account)
		.values({ id: ACCOUNT, name: 'Current', bank: 'fio', kind: 'current', currency: 'CZK' });
	await testDb.insert(schema.transaction).values([
		{
			id: TXN,
			accountId: ACCOUNT,
			bookedOn: '2026-07-20',
			amountMinor: -45000n,
			currency: 'CZK',
			dedupFingerprint: 'txn-a'
		},
		{
			id: OTHER_TXN,
			accountId: ACCOUNT,
			bookedOn: '2026-07-21',
			amountMinor: -12000n,
			currency: 'CZK',
			dedupFingerprint: 'txn-b'
		}
	]);
	await addDocument(DOC, 'Vet receipt');
});

describe('documents on a transaction', () => {
	it('attaches an existing document with no new table', async () => {
		// document_link already points at the generic entity table and transaction
		// is a registered kind, so this needed no schema change at all.
		expect((await attachDocumentToTransaction(TXN, DOC, testDb)).ok).toBe(true);

		const found = await loadTransactionDocuments([TXN], testDb);
		expect(found.get(TXN)?.map((d) => d.name)).toEqual(['Vet receipt']);
	});

	it('attaches the same document to more than one transaction', async () => {
		// One invoice can evidence two payments; the link table is many-to-many.
		await attachDocumentToTransaction(TXN, DOC, testDb);
		await attachDocumentToTransaction(OTHER_TXN, DOC, testDb);

		const found = await loadTransactionDocuments([TXN, OTHER_TXN], testDb);
		expect(found.get(TXN)).toHaveLength(1);
		expect(found.get(OTHER_TXN)).toHaveLength(1);
	});

	it('is idempotent — attaching twice does not duplicate the row', async () => {
		await attachDocumentToTransaction(TXN, DOC, testDb);
		await attachDocumentToTransaction(TXN, DOC, testDb);
		expect((await loadTransactionDocuments([TXN], testDb)).get(TXN)).toHaveLength(1);
	});

	it('detaches without deleting the document itself', async () => {
		await attachDocumentToTransaction(TXN, DOC, testDb);
		expect((await detachDocumentFromTransaction(TXN, DOC, testDb)).ok).toBe(true);

		expect((await loadTransactionDocuments([TXN], testDb)).get(TXN)).toBeUndefined();
		// The document is filed elsewhere and belongs to the household, not to the
		// row it happened to be attached to.
		expect(await testDb.select().from(schema.document)).toHaveLength(1);
	});

	it('refuses a document that is not there', async () => {
		const result = await attachDocumentToTransaction(TXN, rowId('nope'), testDb);
		expect(result).toEqual({ ok: false, status: 404, message: 'That document is not there.' });
	});

	it('refuses a transaction that is not there', async () => {
		const result = await attachDocumentToTransaction(rowId('nope'), DOC, testDb);
		expect(result).toEqual({ ok: false, status: 404, message: 'Transaction not found.' });
	});

	it('returns nothing for transactions with no documents', async () => {
		expect((await loadTransactionDocuments([TXN], testDb)).size).toBe(0);
		expect((await loadTransactionDocuments([], testDb)).size).toBe(0);
	});

	/**
	 * Removing a receipt from a transaction deletes the document. Unlinking alone
	 * left the file on the shelf with no route back to the row it came from.
	 */
	describe('deleting a document', () => {
		it('takes its links with it, and its entity row', async () => {
			await attachDocumentToTransaction(TXN, DOC, testDb);
			await attachDocumentToTransaction(OTHER_TXN, DOC, testDb);
			await testDb.insert(schema.tagLink).values({ tagId: await aTag(), targetId: DOC });

			expect(await deleteDocument(DOC, testDb)).toEqual({ ok: true, removedFile: false });

			expect(await testDb.select().from(schema.document)).toHaveLength(0);
			// Not enumerated in application code: the AFTER DELETE trigger retires
			// the entity row and every link cascades from there.
			expect(await testDb.select().from(schema.documentLink)).toHaveLength(0);
			expect(await testDb.select().from(schema.tagLink)).toHaveLength(0);
			expect(
				await testDb.select().from(schema.entity).where(eq(schema.entity.id, DOC))
			).toHaveLength(0);
			expect((await loadTransactionDocuments([TXN, OTHER_TXN], testDb)).size).toBe(0);
		});

		it('leaves other documents alone', async () => {
			const other = rowId('doc-b');
			await addDocument(other, 'Keep me');
			await deleteDocument(DOC, testDb);
			expect(await testDb.select().from(schema.document)).toHaveLength(1);
		});

		it('says so when the document is not there', async () => {
			expect(await deleteDocument(rowId('nope'), testDb)).toEqual({
				ok: false,
				removedFile: false
			});
		});
	});
});
