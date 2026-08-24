// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { rowId } from '../row-id';
import { document, documentLink, person, salaryEntry } from '$lib/server/db/schema';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { backfillPayslips, salaryMonths } from '$lib/server/salary';

let harness: Harness;
let testDb: TestDb;
const ROBERT = rowId('person-robert');

beforeAll(async () => {
	harness = await startPostgres('salary-backfill');
	testDb = harness.db;
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 120_000);

afterAll(async () => {
	await harness?.stop();
});

beforeEach(async () => {
	await harness.sql`delete from document_link`;
	await harness.sql`delete from salary_entry`;
	await harness.sql`delete from document`;
	await harness.sql`delete from person`;
	await harness.sql`delete from settings where key = 'payslipBackfillV046'`;
	await testDb
		.insert(person)
		.values([{ id: ROBERT, name: 'Robert', initials: 'R', role: 'admin' }]);
});

/** A legacy payslip document whose file is NOT on disk, so the fallback runs. */
async function legacySlip(id: string, month: string, amountMinor: bigint) {
	await testDb.insert(document).values({
		id,
		name: `Payslip ${month} · Robert`,
		shelf: 'payslips',
		storedName: 'missing-file.pdf',
		ext: 'PDF',
		addedOn: '2026-09-01',
		amountMinor,
		currency: 'CZK',
		periodOn: `${month}-01`
	});
	await testDb.insert(documentLink).values({ documentId: id, targetId: ROBERT });
}

describe('backfillPayslips', () => {
	it('files an unreadable slip as NET, never as gross', async () => {
		// The old reader preferred net wordings, so net is the truthful reading of
		// an amount whose provenance is now unknowable.
		await legacySlip(rowId('doc-aug'), '2026-08', 7140000n);
		const out = await backfillPayslips(testDb);
		expect(out.ran).toBe(true);
		expect(out.written).toBe(1);
		expect(out.unreadable).toBe(1);
		const [row] = await salaryMonths(ROBERT, testDb);
		expect(row.netMinor).toBe(7140000n);
		expect(row.grossMinor).toBeNull();
	});

	it('does nothing on a second run', async () => {
		await legacySlip(rowId('doc-aug'), '2026-08', 7140000n);
		await backfillPayslips(testDb);
		const second = await backfillPayslips(testDb);
		expect(second.ran).toBe(false);
		expect(second.written).toBe(0);
		expect(await salaryMonths(ROBERT, testDb)).toHaveLength(1);
	});

	it('leaves a month that already has a figure alone', async () => {
		await legacySlip(rowId('doc-aug'), '2026-08', 7140000n);
		await testDb.insert(salaryEntry).values({
			id: rowId('entry-aug'),
			personId: ROBERT,
			periodMonth: '2026-08',
			grossMinor: 10000000n,
			netMinor: null,
			currency: 'CZK',
			source: 'manual'
		});
		await backfillPayslips(testDb);
		const [row] = await salaryMonths(ROBERT, testDb);
		expect(row.grossMinor).toBe(10000000n);
		expect(row.netMinor).toBeNull();
	});

	it('never touches a hand-corrected row', async () => {
		await legacySlip(rowId('doc-aug'), '2026-08', 7140000n);
		await testDb.insert(salaryEntry).values({
			id: rowId('entry-aug'),
			personId: ROBERT,
			periodMonth: '2026-08',
			grossMinor: null,
			netMinor: 9999999n,
			currency: 'CZK',
			source: 'manual',
			amountOverridden: true
		});
		await backfillPayslips(testDb);
		const [row] = await salaryMonths(ROBERT, testDb);
		expect(row.netMinor).toBe(9999999n);
	});

	it('skips a document with no month, rather than inventing one', async () => {
		await testDb.insert(document).values({
			id: rowId('doc-undated'),
			name: 'Payslip · Robert',
			shelf: 'payslips',
			storedName: null,
			ext: 'PDF',
			addedOn: '2026-09-01',
			amountMinor: 7140000n,
			currency: 'CZK',
			periodOn: null
		});
		await testDb
			.insert(documentLink)
			.values({ documentId: rowId('doc-undated'), targetId: ROBERT });
		const out = await backfillPayslips(testDb);
		expect(out.written).toBe(0);
		expect(await salaryMonths(ROBERT, testDb)).toHaveLength(0);
	});

	it('ignores a document on another shelf linked to the same person', async () => {
		await testDb.insert(document).values({
			id: rowId('doc-tax'),
			name: 'Tax 2026',
			shelf: 'tax',
			storedName: null,
			ext: 'PDF',
			addedOn: '2026-09-01',
			amountMinor: 5000000n,
			currency: 'CZK',
			periodOn: '2026-08-01'
		});
		await testDb.insert(documentLink).values({ documentId: rowId('doc-tax'), targetId: ROBERT });
		const out = await backfillPayslips(testDb);
		expect(out.written).toBe(0);
		expect(await salaryMonths(ROBERT, testDb)).toHaveLength(0);
	});
});
