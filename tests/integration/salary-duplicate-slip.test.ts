// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The same payslip uploaded twice.
//
// A month has held more than one payslip since v0.5.5, which removed the only
// key that used to catch a re-upload: a second upload mints a second document
// id, which is a second row by definition, and the month then reports double
// pay. The bytes are what recognise the file — never the figures, because two
// jobs paying the same amount in the same month are a real arrangement.
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { rowId } from '../row-id';
import { document, documentLink, person, salaryEntry } from '$lib/server/db/schema';
import { payslipMatchingContent, recordSalary, restateSlipMonth } from '$lib/server/salary';
import { hashBytes } from '$lib/server/system/files';
import { shelfIdByKey } from '$lib/server/documents/shelves';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';

// $env/dynamic/private snapshots process.env when Vite builds the virtual
// module, which is before this suite picks the directory its uploads live in. A
// live getter is the only way the fingerprinting reads the files written here
// rather than looking in ./data.
vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

let harness: Harness;
let testDb: TestDb;
const ROBERT = rowId('person-robert');
const PETRA = rowId('person-petra');
const DIRECTORY = resolve('scratch-workspace/duplicate-slip-uploads');
let previousDirectory: string | undefined;

const AUGUST = new TextEncoder().encode('%PDF-1.4 payslip august');
const SEPTEMBER = new TextEncoder().encode('%PDF-1.4 payslip september');

beforeAll(async () => {
	previousDirectory = process.env.UPLOAD_DIR;
	process.env.UPLOAD_DIR = DIRECTORY;
	await mkdir(DIRECTORY, { recursive: true });
	harness = await startPostgres('salary-duplicate-slip');
	testDb = harness.db;
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 120_000);

afterAll(async () => {
	await harness?.stop();
	if (previousDirectory === undefined) delete process.env.UPLOAD_DIR;
	else process.env.UPLOAD_DIR = previousDirectory;
	await rm(DIRECTORY, { recursive: true, force: true });
});

beforeEach(async () => {
	await harness.sql`delete from document_link`;
	await harness.sql`delete from salary_entry`;
	await harness.sql`delete from document`;
	await harness.sql`delete from person`;
	await testDb.insert(person).values([
		{ id: ROBERT, name: 'Robert', initials: 'R', role: 'admin' },
		{ id: PETRA, name: 'Petra', initials: 'P', role: 'admin' }
	]);
});

/** A stored payslip, optionally with its fingerprint already recorded. */
async function fileOnShelf(options: {
	bytes: Uint8Array;
	month: string;
	personId?: string;
	type?: 'payslip' | 'tax_document';
	withHash?: boolean;
	/** Record the document but never write the file, as a lost upload. */
	missing?: boolean;
}) {
	const id = rowId(`doc-${randomUUID()}`);
	const storedName = `${randomUUID()}.pdf`;
	if (!options.missing) await writeFile(join(DIRECTORY, storedName), options.bytes);
	await testDb.insert(document).values({
		id,
		name: `Payslip ${options.month}`,
		shelfId: await shelfIdByKey('finance', testDb),
		type: options.type ?? 'payslip',
		storedName,
		ext: 'PDF',
		addedOn: '2026-08-25',
		currency: 'CZK',
		periodOn: `${options.month}-01`,
		contentHash: options.withHash === false ? null : hashBytes(options.bytes)
	});
	await testDb
		.insert(documentLink)
		.values({ documentId: id, targetId: options.personId ?? ROBERT });
	return id;
}

describe('payslipMatchingContent', () => {
	it('finds the slip already filed from the same bytes', async () => {
		const id = await fileOnShelf({ bytes: AUGUST, month: '2026-08' });

		const found = await payslipMatchingContent(ROBERT, hashBytes(AUGUST), testDb);

		expect(found).toEqual({ id, periodMonth: '2026-08' });
	});

	it('does not match a different slip', async () => {
		await fileOnShelf({ bytes: AUGUST, month: '2026-08' });

		expect(await payslipMatchingContent(ROBERT, hashBytes(SEPTEMBER), testDb)).toBeNull();
	});

	it('fingerprints a slip filed before there was a column, and keeps it', async () => {
		const id = await fileOnShelf({ bytes: AUGUST, month: '2026-08', withHash: false });

		const found = await payslipMatchingContent(ROBERT, hashBytes(AUGUST), testDb);
		expect(found?.id).toBe(id);

		// Computed once. The shelf is fully fingerprinted after the first upload
		// rather than by a migration nobody on a live instance would have run.
		const [row] = await testDb
			.select({ contentHash: document.contentHash })
			.from(document)
			.where(eq(document.id, id));
		expect(row.contentHash).toBe(hashBytes(AUGUST));
	});

	it('is scoped to one person — the same PDF filed for two is two statements', async () => {
		await fileOnShelf({ bytes: AUGUST, month: '2026-08', personId: PETRA });

		expect(await payslipMatchingContent(ROBERT, hashBytes(AUGUST), testDb)).toBeNull();
		expect((await payslipMatchingContent(PETRA, hashBytes(AUGUST), testDb))?.periodMonth).toBe(
			'2026-08'
		);
	});

	it("is scoped to documents of type payslip, not to a shelf's name", async () => {
		await fileOnShelf({ bytes: AUGUST, month: '2026-08', type: 'tax_document' });

		expect(await payslipMatchingContent(ROBERT, hashBytes(AUGUST), testDb)).toBeNull();
	});

	it('a lost upload does not stop the rest of the shelf being searched', async () => {
		await fileOnShelf({ bytes: SEPTEMBER, month: '2026-09', withHash: false, missing: true });
		const id = await fileOnShelf({ bytes: AUGUST, month: '2026-08', withHash: false });

		expect((await payslipMatchingContent(ROBERT, hashBytes(AUGUST), testDb))?.id).toBe(id);
	});
});

describe('a re-upload corrects rather than duplicates', () => {
	it('leaves one statement for the month, holding the corrected figures', async () => {
		const id = await fileOnShelf({ bytes: AUGUST, month: '2026-08' });
		const record = (grossMinor: bigint) =>
			recordSalary(
				{
					personId: ROBERT,
					periodMonth: '2026-08',
					currency: 'CZK',
					restateCurrency: true,
					grossMinor,
					source: 'payslip',
					documentId: id
				},
				testDb
			);

		expect((await record(10_000_00n)).ok).toBe(true);
		// The second upload recognised the file, so it carries the SAME document.
		expect((await record(12_000_00n)).ok).toBe(true);

		const rows = await testDb.select().from(salaryEntry).where(eq(salaryEntry.personId, ROBERT));
		expect(rows).toHaveLength(1);
		expect(rows[0].grossMinor).toBe(12_000_00n);
	});

	it('moves its statement when the re-upload names a different month', async () => {
		const id = await fileOnShelf({ bytes: AUGUST, month: '2026-08' });
		await recordSalary(
			{
				personId: ROBERT,
				periodMonth: '2026-08',
				currency: 'CZK',
				grossMinor: 10_000_00n,
				source: 'payslip',
				documentId: id
			},
			testDb
		);

		// The same file cannot be two statements: a corrected month restates the
		// row rather than leaving August behind and adding September beside it.
		await restateSlipMonth(ROBERT, id, '2026-09', testDb);

		const rows = await testDb.select().from(salaryEntry).where(eq(salaryEntry.personId, ROBERT));
		expect(rows).toHaveLength(1);
		expect(rows[0].periodMonth).toBe('2026-09');
	});
});
