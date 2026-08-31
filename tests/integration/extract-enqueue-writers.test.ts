// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Every writer that files a document already holds the bytes behind it, so
 * every one of them can fingerprint the file and ask for its text to be read.
 *
 * Before this, two writers did both: `createDocument` (capture, receipts) and
 * nothing else. The four that go through `insertDocumentAggregate` — a bank
 * statement, a tax attachment, a property bill, a payslip — set neither, so
 * only a payslip could ever be recognised as "the same file uploaded twice",
 * and none of the four was ever full-text searchable. One test per writer,
 * checking the pair every filed document must now carry: a hash of its own
 * bytes, and exactly one queued `extract_text` job waiting to read them.
 */
import { mkdir, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { rowId } from '../row-id';
import { document, job } from '$lib/server/db/schema';
import { ingestFile } from '$lib/server/import/ingest';
import { saveStatement } from '$lib/server/tax';
import { createPropertyBill } from '$lib/server/property/mutations';
import { filePayslipDocument } from '$lib/server/salary';
import { hashBytes, saveUploadBytes } from '$lib/server/system/files';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeAccount, makePerson, makeProperty } from './fixtures';

// $env/dynamic/private snapshots process.env when Vite builds the virtual
// module, which is before this suite picks the directory its uploads live in.
// A live getter is the only way `saveUploadBytes`/`readUpload` see the files
// written under the directory this suite chose rather than ./data.
vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

let harness: Harness;
let testDb: TestDb;
const DIRECTORY = resolve('scratch-workspace/extract-enqueue-writers-uploads');
let previousDirectory: string | undefined;

// A real, small PDF — extractable, so the queue actually accepts a job for it.
let PDF_BYTES: Uint8Array;
let STATEMENT_BYTES: Uint8Array;

beforeAll(async () => {
	previousDirectory = process.env.UPLOAD_DIR;
	process.env.UPLOAD_DIR = DIRECTORY;
	await mkdir(DIRECTORY, { recursive: true });
	harness = await startPostgres('extract-enqueue-writers');
	testDb = harness.db;
	await harness.applyMigrations(ALL_MIGRATIONS);
	PDF_BYTES = new Uint8Array(await readFile(resolve('tests/fixtures/extract/typed-invoice.pdf')));
	STATEMENT_BYTES = new Uint8Array(await readFile(resolve('tests/fixtures/fio.csv')));
}, 120_000);

afterAll(async () => {
	await harness?.stop();
	if (previousDirectory === undefined) delete process.env.UPLOAD_DIR;
	else process.env.UPLOAD_DIR = previousDirectory;
	await rm(DIRECTORY, { recursive: true, force: true });
});

beforeEach(async () => {
	// entity too: TRUNCATE fires no row triggers, so a registration would
	// outlive the row it belongs to and collide on a reused id.
	await harness.sql`truncate table entity, person, property, account, document, job,
		import_file, tax_statement restart identity cascade`;
});

/** The queued extract_text jobs waiting on one document. */
async function queuedJobsFor(documentId: string) {
	return testDb
		.select()
		.from(job)
		.where(and(eq(job.kind, 'extract_text'), eq(job.subjectId, documentId)));
}

describe('every writer hashes and enqueues', () => {
	it('a bank statement ingest', async () => {
		await makeAccount(testDb, {
			id: rowId('account-fio'),
			name: 'Fio',
			bank: 'fio',
			currency: 'CZK',
			numbers: ['1234567890/2010']
		});

		await ingestFile('fio.csv', STATEMENT_BYTES, rowId('account-fio'), testDb);

		const [doc] = await testDb.select().from(document);
		expect(doc).toBeDefined();
		expect(doc.contentHash).toBe(hashBytes(STATEMENT_BYTES));
		const jobs = await queuedJobsFor(doc.id);
		expect(jobs).toHaveLength(1);
		expect(jobs[0].state).toBe('queued');
	});

	it('a tax statement attachment', async () => {
		await makePerson(testDb, { id: rowId('person-tax'), name: 'Person Tax', initials: 'PT' });
		const storedName = await saveUploadBytes(PDF_BYTES, 'broker.pdf');

		const result = await saveStatement(
			{
				personId: rowId('person-tax'),
				year: 2025,
				country: 'CZ',
				currency: 'CZK',
				grossIncomeMinor: 1_000_00n,
				taxPaidMinor: 100_00n,
				note: null,
				lines: [],
				attachments: [
					{
						storedName,
						ext: 'PDF',
						addedOn: '2026-08-25',
						kind: 'statement',
						contentHash: hashBytes(PDF_BYTES)
					}
				],
				linkDocumentIds: [],
				actor: null
			},
			testDb
		);
		expect(result).toEqual({ ok: true });

		const [doc] = await testDb.select().from(document);
		expect(doc).toBeDefined();
		expect(doc.contentHash).toBe(hashBytes(PDF_BYTES));
		const jobs = await queuedJobsFor(doc.id);
		expect(jobs).toHaveLength(1);
		expect(jobs[0].state).toBe('queued');
	});

	it('a property bill', async () => {
		await makeProperty(testDb, {
			id: rowId('property-bill'),
			name: 'Flat A',
			kind: 'lived',
			currency: 'CZK'
		});
		const storedName = await saveUploadBytes(PDF_BYTES, 'bill.pdf');
		const documentId = rowId('bill-document');

		await createPropertyBill(
			{
				id: rowId('bill'),
				propertyId: rowId('property-bill'),
				label: 'Electricity',
				amountMinor: 1_200_00n,
				document: {
					id: documentId,
					name: 'Electricity · Flat A',
					storedName,
					ext: 'PDF',
					addedOn: '2026-08-25',
					contentHash: hashBytes(PDF_BYTES)
				}
			},
			testDb
		);

		const [doc] = await testDb.select().from(document).where(eq(document.id, documentId));
		expect(doc).toBeDefined();
		expect(doc.contentHash).toBe(hashBytes(PDF_BYTES));
		const jobs = await queuedJobsFor(doc.id);
		expect(jobs).toHaveLength(1);
		expect(jobs[0].state).toBe('queued');
	});

	it('a payslip', async () => {
		await makePerson(testDb, {
			id: rowId('person-payslip'),
			name: 'Person Payslip',
			initials: 'PP'
		});
		const storedName = await saveUploadBytes(PDF_BYTES, 'payslip.pdf');
		const contentHash = hashBytes(PDF_BYTES);

		const documentId = await filePayslipDocument(
			{
				personId: rowId('person-payslip'),
				subject: 'Person Payslip',
				periodMonth: '2026-08',
				storedName,
				contentHash
			},
			testDb
		);

		const [doc] = await testDb.select().from(document).where(eq(document.id, documentId));
		expect(doc).toBeDefined();
		expect(doc.contentHash).toBe(contentHash);
		const jobs = await queuedJobsFor(doc.id);
		expect(jobs).toHaveLength(1);
		expect(jobs[0].state).toBe('queued');
	});
});
