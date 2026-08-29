// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { rowId } from '../row-id';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '$lib/server/db/schema';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { loadTransactionDocuments } from '$lib/server/transactions/documents';
import { createDocument } from '$lib/server/documents/mutations';
import { shelfIdByKey } from '$lib/server/documents/shelves';

vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

/**
 * Task 16: receipts through the same `DocumentsCard` every other screen uses.
 *
 * `attachDocumentToTransaction`/`detachDocumentFromTransaction` are gone —
 * `targets.ts`'s `attachDocument`/`detachDocument` replace them, visibility
 * checked in a way the transaction-only versions were not. What is left here
 * to unit-test directly is `loadTransactionDocuments`, the one batched read
 * the register still owns; attach and detach are exercised the way every
 * other documents-card suite exercises them, through the page's own actions.
 */
let harness: Harness;
let testDb: TestDb;
let previousUrl: string | undefined;
let previousUploadDir: string | undefined;

const ACCOUNT = rowId('td-account');
const TXN = rowId('td-txn');
const OTHER_TXN = rowId('td-txn-b');
const DOC = rowId('td-doc');

interface Locals {
	person: { id: string; name: string; initials: string; role: 'admin' | 'member'; theme: null };
}
const asAdmin: Locals = {
	person: { id: rowId('td-admin'), name: 'Admin', initials: 'A', role: 'admin', theme: null }
};
const asMember: Locals = {
	person: { id: rowId('td-member'), name: 'Member', initials: 'M', role: 'member', theme: null }
};

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

async function postAction(
	action: 'attachDocument' | 'detachDocument' | 'candidates',
	fields: Record<string, string>,
	locals: Locals
) {
	const { actions } = await import('../../src/routes/(app)/transactions/+page.server');
	const form = new FormData();
	for (const [key, value] of Object.entries(fields)) form.set(key, value);
	const request = new Request(`http://localhost/transactions?/${action}`, {
		method: 'POST',
		body: form
	});
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (actions[action] as any)({ request, locals });
}

beforeAll(async () => {
	previousUrl = process.env.DATABASE_URL;
	previousUploadDir = process.env.UPLOAD_DIR;
	harness = await startPostgres('transaction-documents', { max: 1 });
	process.env.DATABASE_URL = harness.url;
	process.env.UPLOAD_DIR = resolve('scratch-workspace/transaction-documents-uploads');
	testDb = harness.db;
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 120_000);

afterAll(async () => {
	await harness?.stop();
	if (previousUrl === undefined) delete process.env.DATABASE_URL;
	else process.env.DATABASE_URL = previousUrl;
	if (previousUploadDir === undefined) delete process.env.UPLOAD_DIR;
	else process.env.UPLOAD_DIR = previousUploadDir;
});

beforeEach(async () => {
	await harness.sql`truncate account, document, subject cascade`;
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
			dedupFingerprint: 'td-txn-a'
		},
		{
			id: OTHER_TXN,
			accountId: ACCOUNT,
			bookedOn: '2026-07-21',
			amountMinor: -12000n,
			currency: 'CZK',
			dedupFingerprint: 'td-txn-b'
		}
	]);
	await addDocument(DOC, 'Vet receipt');
});

describe('reading receipts filed against a transaction', () => {
	it('reads a document linked to more than one transaction', async () => {
		// One invoice can evidence two payments; the link table is many-to-many.
		await testDb.insert(schema.documentLink).values([
			{ documentId: DOC, targetId: TXN },
			{ documentId: DOC, targetId: OTHER_TXN }
		]);
		const found = await loadTransactionDocuments([TXN, OTHER_TXN], null, testDb);
		expect(found.get(TXN)?.map((d) => d.name)).toEqual(['Vet receipt']);
		expect(found.get(OTHER_TXN)?.map((d) => d.name)).toEqual(['Vet receipt']);
	});

	it('returns nothing for transactions with no documents', async () => {
		expect((await loadTransactionDocuments([TXN], null, testDb)).size).toBe(0);
		expect((await loadTransactionDocuments([], null, testDb)).size).toBe(0);
	});

	it('hides a restricted receipt from a member but not an admin', async () => {
		await testDb
			.update(schema.document)
			.set({ sensitivity: 'restricted' })
			.where(eq(schema.document.id, DOC));
		await testDb.insert(schema.documentLink).values({ documentId: DOC, targetId: TXN });
		expect(
			(await loadTransactionDocuments([TXN], asMember.person, testDb)).get(TXN)
		).toBeUndefined();
		expect(
			(await loadTransactionDocuments([TXN], asAdmin.person, testDb)).get(TXN)?.map((d) => d.name)
		).toEqual(['Vet receipt']);
	});
});

describe('attaching and detaching a receipt through the actions', () => {
	it('attaches an existing document with no new table', async () => {
		// document_link already points at the generic entity table and
		// transaction is a registered kind, so this needs no schema change.
		const result = await postAction('attachDocument', { targetId: TXN, documentId: DOC }, asAdmin);
		expect(result).toEqual({ ok: true });

		const found = await loadTransactionDocuments([TXN], null, testDb);
		expect(found.get(TXN)?.map((d) => d.name)).toEqual(['Vet receipt']);
	});

	it('is idempotent — attaching twice does not duplicate the link', async () => {
		await postAction('attachDocument', { targetId: TXN, documentId: DOC }, asAdmin);
		await postAction('attachDocument', { targetId: TXN, documentId: DOC }, asAdmin);
		expect((await loadTransactionDocuments([TXN], null, testDb)).get(TXN)).toHaveLength(1);
	});

	it('refuses a restricted document for a member, and does not link it', async () => {
		await testDb
			.update(schema.document)
			.set({ sensitivity: 'restricted' })
			.where(eq(schema.document.id, DOC));
		const result: unknown = await postAction(
			'attachDocument',
			{ targetId: TXN, documentId: DOC },
			asMember
		);
		expect(result).toMatchObject({ status: 404 });
		const links = await testDb
			.select()
			.from(schema.documentLink)
			.where(eq(schema.documentLink.targetId, TXN));
		expect(links).toEqual([]);
	});

	it('refuses a transaction that is not there', async () => {
		const result: unknown = await postAction(
			'attachDocument',
			{ targetId: rowId('td-nope'), documentId: DOC },
			asAdmin
		);
		expect(result).toMatchObject({ status: 404 });
	});

	/**
	 * The upload half of the same action: a file becomes a new receipt
	 * document rather than linking one that already exists.
	 *
	 * `newSubjectName: 'Receipts'` used to run alongside this so the file
	 * would appear somewhere on the Documents screen — the about-filter now
	 * shows transactions as a group there, so the workaround is gone. This is
	 * the test that would catch it coming back.
	 */
	it('uploads a file as a receipt document, tagged and shelved in the inbox, with no Receipts subject', async () => {
		const { actions } = await import('../../src/routes/(app)/transactions/+page.server');
		const form = new FormData();
		form.set('targetId', TXN);
		form.set(
			'file',
			new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'invoice.pdf', {
				type: 'application/pdf'
			})
		);
		const request = new Request('http://localhost/transactions?/attachDocument', {
			method: 'POST',
			body: form
		});
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const result = await (actions.attachDocument as any)({ request, locals: asAdmin });
		expect(result).toEqual({ ok: true });

		const found = await loadTransactionDocuments([TXN], null, testDb);
		expect(found.get(TXN)?.map((d) => d.name)).toEqual(['invoice.pdf']);
		expect(found.get(TXN)?.[0].tags).toEqual(['receipt']);
		expect(found.get(TXN)?.[0].shelfKey).toBe('inbox');

		// No subject at all is created by this upload — not "Receipts", not
		// anything else.
		expect(await testDb.select().from(schema.subject)).toEqual([]);
	});

	it('detaches a receipt by deleting it — Task 9’s semantics, not just the link', async () => {
		await testDb.insert(schema.documentLink).values({ documentId: DOC, targetId: TXN });
		const result = await postAction('detachDocument', { targetId: TXN, documentId: DOC }, asAdmin);
		expect(result).toEqual({ ok: true });

		expect(
			await testDb.select().from(schema.document).where(eq(schema.document.id, DOC))
		).toHaveLength(0);
	});

	it('says the receipt is gone rather than failing, when there was nothing to unlink either', async () => {
		const result = await postAction(
			'detachDocument',
			{ targetId: TXN, documentId: rowId('td-nope') },
			asAdmin
		);
		expect(result).toEqual({ ok: true });
	});
});

describe('the attach-existing picker, fetched only for the transaction it is open for', () => {
	it('offers a document not yet linked, and stops offering it once attached', async () => {
		const before = await postAction('candidates', { targetId: TXN }, asAdmin);
		expect(before.candidates.map((c: { id: string }) => c.id)).toEqual([DOC]);

		await postAction('attachDocument', { targetId: TXN, documentId: DOC }, asAdmin);

		const after = await postAction('candidates', { targetId: TXN }, asAdmin);
		expect(after.candidates).toEqual([]);
	});

	it('does not offer a member a document they cannot see', async () => {
		await testDb
			.update(schema.document)
			.set({ sensitivity: 'restricted' })
			.where(eq(schema.document.id, DOC));
		const result = await postAction('candidates', { targetId: TXN }, asMember);
		expect(result.candidates).toEqual([]);
	});
});
