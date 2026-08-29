// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as XLSX from 'xlsx';
import { rowId } from '../row-id';
import * as schema from '$lib/server/db/schema';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { ingestReport } from '$lib/server/invest/ingest';
import { brokerReports, uploadBrokerReport } from '$lib/server/invest/reports';
import { hashBytes, readUpload } from '$lib/server/system/files';
import type { BrokerReport } from '$lib/server/invest/adapter';

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
const DIRECTORY = resolve('scratch-workspace/broker-ingest-uploads');
let previousDirectory: string | undefined;

/**
 * A report shaped like the one that failed in the field: a withholding-tax
 * correction naming a position, and the position itself listed after it.
 */
function report(overrides: Partial<BrokerReport> = {}): BrokerReport {
	return {
		accountCurrency: 'EUR',
		generatedAt: '2026-07-08T10:00:00.000Z',
		summaryValueMinor: 100_000n,
		holdings: [],
		operations: [
			{
				id: '1347965304',
				type: 'Withholding tax',
				ticker: 'PEP.US',
				happenedAt: '2026-07-07T20:51:48.000Z',
				amountMinor: 58n,
				comment: 'corr PEP.US USD WHT 15%',
				positionId: '1233431485'
			}
		],
		positions: [
			{
				id: '1233431485',
				ticker: 'PEP.US',
				purchaseValueMinor: 90_000n,
				saleValueMinor: 95_000n,
				openedAt: '2026-01-02T09:00:00.000Z',
				closedAt: '2026-06-30T16:00:00.000Z'
			}
		],
		...overrides
	};
}

/**
 * A synthetic XTB workbook `uploadBrokerReport` can actually detect and
 * parse — real bytes are required here (unlike `report()` above), because
 * filing the document needs `parseBrokerReport` to run the adapter's own
 * `sniff`/`parse`, not a hand-built `BrokerReport`.
 *
 * Trimmed to the minimum the format needs: all three sheets `parseXtb`
 * unconditionally reads (`sheet()` throws if one is missing), and just
 * enough of "Open Positions" to fix the report's date and currency
 * deterministically rather than at whatever moment the test happens to run.
 */
function makeXtbWorkbook(generatedAt: string): Uint8Array {
	const wb = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(
		wb,
		XLSX.utils.aoa_to_sheet([
			['Data as of report generated', generatedAt],
			['My Trades', 'Value', '1000.00', 'EUR']
		]),
		'Open Positions'
	);
	XLSX.utils.book_append_sheet(
		wb,
		XLSX.utils.aoa_to_sheet([['Cash Operations']]),
		'Cash Operations'
	);
	XLSX.utils.book_append_sheet(
		wb,
		XLSX.utils.aoa_to_sheet([['Closed Positions']]),
		'Closed Positions'
	);
	return new Uint8Array(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

beforeAll(async () => {
	previousDirectory = process.env.UPLOAD_DIR;
	process.env.UPLOAD_DIR = DIRECTORY;
	await mkdir(DIRECTORY, { recursive: true });
	harness = await startPostgres('broker-ingest');
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
	// entity too: TRUNCATE fires no row triggers, so a document's registration
	// would outlive the row it belongs to and collide on a reused id.
	await harness.sql`truncate broker_operation, broker_position, holding, portfolio_snapshot,
		broker_import_state, entity, account, document, job, tag, tag_link cascade`;
});

describe('broker ingest', () => {
	it('stores an operation whose position appears later in the report', async () => {
		await ingestReport(report(), testDb);

		const rows = await testDb
			.select()
			.from(schema.brokerOperation)
			.where(eq(schema.brokerOperation.id, '1347965304'));

		expect(rows).toHaveLength(1);
		expect(rows[0].positionId).toBe('1233431485');
	});

	it('stores an operation whose position the report never contains', async () => {
		await ingestReport(report({ positions: [] }), testDb);

		const rows = await testDb
			.select()
			.from(schema.brokerOperation)
			.where(eq(schema.brokerOperation.id, '1347965304'));

		expect(rows).toHaveLength(1);
		// The cash movement is real and is kept in full; only the link to a
		// holding interval is unknown, which is exactly what null means here.
		expect(rows[0].positionId).toBeNull();
		expect(rows[0].amountMinor).toBe(58n);
		expect(rows[0].comment).toBe('corr PEP.US USD WHT 15%');
	});

	it('backfills the link when a later report supplies the missing position', async () => {
		await ingestReport(report({ positions: [] }), testDb);
		await ingestReport({ ...report(), generatedAt: '2026-07-09T10:00:00.000Z' }, testDb);

		const rows = await testDb
			.select()
			.from(schema.brokerOperation)
			.where(eq(schema.brokerOperation.id, '1347965304'));

		expect(rows[0].positionId).toBe('1233431485');
	});
});

// ---------------------------------------------------------------------------
// Decision D8: the uploaded report becomes a document, not just ledger rows.
// Before this, `ingestBrokerFile` was the only upload in the product that
// retained no file at all.

describe('the broker report upload becomes a document (decision D8)', () => {
	it('stores the file and files one broker_report document on Statements, linked to the sole brokerage account', async () => {
		const accountId = rowId('xtb-account');
		await testDb.insert(schema.account).values({
			id: accountId,
			name: 'XTB',
			bank: 'other',
			kind: 'brokerage',
			currency: 'EUR'
		});
		const bytes = makeXtbWorkbook('2026-07-08 10:00:00');

		const result = await uploadBrokerReport('account_statement.xlsx', bytes, testDb);
		// The ingest itself still ran — this is not a side-channel that replaces it.
		expect(result.broker).toBe('XTB (account statement .xlsx)');

		const docs = await testDb
			.select()
			.from(schema.document)
			.where(eq(schema.document.type, 'broker_report'));
		expect(docs).toHaveLength(1);
		const [doc] = docs;
		expect(doc.contentHash).toBe(hashBytes(bytes));
		expect(doc.name).toBe('XTB report 2026-07-08');
		expect(doc.storedName).not.toBeNull();

		const [shelfRow] = await testDb
			.select({ key: schema.shelf.key })
			.from(schema.shelf)
			.where(eq(schema.shelf.id, doc.shelfId));
		expect(shelfRow.key).toBe('statements');

		const links = await testDb
			.select({ targetId: schema.documentLink.targetId })
			.from(schema.documentLink)
			.where(eq(schema.documentLink.documentId, doc.id));
		expect(links.map((l) => l.targetId)).toEqual([accountId]);

		const tags = await testDb
			.select({ name: schema.tag.name })
			.from(schema.tagLink)
			.innerJoin(schema.tag, eq(schema.tag.id, schema.tagLink.tagId))
			.where(eq(schema.tagLink.targetId, doc.id));
		expect(tags.map((t) => t.name).sort()).toEqual(['2026', 'xtb']);

		// The bytes are actually on the volume, not merely a hash that matches.
		// Compared as `Buffer`s rather than with `toEqual` on the raw
		// `Uint8Array`s: vitest's deep-equal reports two content-identical typed
		// arrays as unequal here for reasons that have nothing to do with their
		// bytes (confirmed by an index-by-index walk finding no divergence).
		const stored = await readUpload(doc.storedName!);
		expect(stored).not.toBeNull();
		expect(Buffer.compare(Buffer.from(stored!), Buffer.from(bytes))).toBe(0);
	});

	it('leaves the account link empty when there is no single brokerage account', async () => {
		const bytes = makeXtbWorkbook('2026-07-08 10:00:00');
		await uploadBrokerReport('account_statement.xlsx', bytes, testDb);

		const [doc] = await testDb.select().from(schema.document);
		const links = await testDb
			.select()
			.from(schema.documentLink)
			.where(eq(schema.documentLink.documentId, doc.id));
		expect(links).toHaveLength(0);
	});

	it('re-uploading the same bytes creates no second document or file, but still re-runs the ingest', async () => {
		const bytes = makeXtbWorkbook('2026-07-09 10:00:00');
		const first = await uploadBrokerReport('account_statement.xlsx', bytes, testDb);

		const docsBefore = await testDb.select().from(schema.document);
		expect(docsBefore).toHaveLength(1);

		// A second upload of the identical bytes: the broker's own operation ids
		// are what make THIS idempotent, which is why the ingest is expected to
		// run again rather than being skipped once a document already exists.
		const second = await uploadBrokerReport('account_statement.xlsx', bytes, testDb);
		expect(second.snapshotDay).toBe(first.snapshotDay);

		const docsAfter = await testDb.select().from(schema.document);
		expect(docsAfter).toHaveLength(1);
		expect(docsAfter[0].id).toBe(docsBefore[0].id);
		expect(docsAfter[0].storedName).toBe(docsBefore[0].storedName);
	});

	it('does not let a member see a restricted report', async () => {
		const bytes = makeXtbWorkbook('2026-07-10 10:00:00');
		await uploadBrokerReport('account_statement.xlsx', bytes, testDb);
		const [doc] = await testDb.select().from(schema.document);
		await testDb
			.update(schema.document)
			.set({ sensitivity: 'restricted' })
			.where(eq(schema.document.id, doc.id));

		const memberDocs = await brokerReports({ id: rowId('member'), role: 'member' }, testDb);
		expect(memberDocs).toHaveLength(0);

		const adminDocs = await brokerReports({ id: rowId('admin'), role: 'admin' }, testDb);
		expect(adminDocs).toHaveLength(1);
		expect(adminDocs[0].id).toBe(doc.id);
	});
	it('leaves the account link empty when there is more than one brokerage account', async () => {
		await testDb.insert(schema.account).values([
			{
				id: rowId('xtb-account-a'),
				name: 'XTB A',
				bank: 'other',
				kind: 'brokerage',
				currency: 'EUR'
			},
			{
				id: rowId('xtb-account-b'),
				name: 'XTB B',
				bank: 'other',
				kind: 'brokerage',
				currency: 'EUR'
			}
		]);
		const bytes = makeXtbWorkbook('2026-07-12 10:00:00');
		await uploadBrokerReport('account_statement.xlsx', bytes, testDb);

		const [doc] = await testDb.select().from(schema.document);
		const links = await testDb
			.select()
			.from(schema.documentLink)
			.where(eq(schema.documentLink.documentId, doc.id));
		expect(links).toHaveLength(0);
	});

	// The finding this covers: `document.content_hash` carries only a plain
	// index, not a unique constraint, so a plain SELECT-then-INSERT outside any
	// lock lets two concurrent identical uploads (a double-click, two tabs)
	// both read "nothing exists yet" and both go on to save a file and insert a
	// document. `import/ingest.ts` solves the identical problem for
	// `import_file` with a `pg_advisory_xact_lock` keyed on the content hash,
	// taken INSIDE the transaction before the duplicate is (re-)checked; this
	// is the same defence for `document`.
	it('two concurrent uploads of the same bytes create exactly one document and one stored file', async () => {
		const bytes = makeXtbWorkbook('2026-07-11 10:00:00');

		await Promise.all(
			Array.from({ length: 8 }, () => uploadBrokerReport('account_statement.xlsx', bytes, testDb))
		);

		const docs = await testDb
			.select()
			.from(schema.document)
			.where(eq(schema.document.type, 'broker_report'));
		expect(docs).toHaveLength(1);

		const stored = await readUpload(docs[0].storedName!);
		expect(stored).not.toBeNull();
		expect(Buffer.compare(Buffer.from(stored!), Buffer.from(bytes))).toBe(0);
	});
});
