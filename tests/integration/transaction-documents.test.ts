// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { rowId } from '../row-id';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '$lib/server/db/schema';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import {
	attachDocumentToTransaction,
	detachDocumentFromTransaction,
	loadTransactionDocuments
} from '$lib/server/transactions/documents';
import { createDocument } from '$lib/server/documents/mutations';

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
			shelf: 'family',
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
});
