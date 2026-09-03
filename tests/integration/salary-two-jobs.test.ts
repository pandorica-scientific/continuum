// SPDX-License-Identifier: AGPL-3.0-or-later
// A month worked at two jobs.
//
// A salary entry was one row per person per month, so a second employer's
// payslip for the same month simply replaced the first — a month worked twice
// reported half its pay, and the file for the other job was deleted with it.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { rowId } from '../row-id';
import { documentLink, salaryEntry } from '$lib/server/db/schema';
import { loadSalaryHistory, recordSalary } from '$lib/server/salary';

import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeDocument, makePerson } from './fixtures';

let harness: Harness;
let testDb: TestDb;
const ROBERT = rowId('person-robert');
const JOB_A = rowId('doc-job-a');
const JOB_B = rowId('doc-job-b');

beforeAll(async () => {
	harness = await startPostgres('salary-two-jobs');
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
	await makePerson(testDb, { id: ROBERT, name: 'Robert', initials: 'R', role: 'admin' });
});

async function slip(id: string, month: string) {
	await makeDocument(testDb, {
		id,
		name: `Payslip ${month} · Robert`,
		shelfKey: 'income_tax',
		type: 'payslip',
		storedName: `${id}.pdf`,
		ext: 'PDF',
		addedOn: '2026-08-25',
		periodOn: `${month}-01`
	});
	await testDb.insert(documentLink).values({ documentId: id, targetId: ROBERT });
}

const file = (documentId: string, grossMinor: bigint, netMinor: bigint) =>
	recordSalary(
		{
			personId: ROBERT,
			periodMonth: '2026-03',
			currency: 'CZK',
			restateCurrency: true,
			grossMinor,
			netMinor,
			source: 'payslip',
			documentId
		},
		testDb
	);

const rowsForMarch = () =>
	testDb
		.select()
		.from(salaryEntry)
		.where(and(eq(salaryEntry.personId, ROBERT), eq(salaryEntry.periodMonth, '2026-03')));

describe('two payslips for one month', () => {
	it('are two statements, not one overwriting the other', async () => {
		await slip(JOB_A, '2026-03');
		await slip(JOB_B, '2026-03');
		await file(JOB_A, 10000000n, 7500000n);
		await file(JOB_B, 4000000n, 3100000n);

		const rows = await rowsForMarch();
		expect(rows).toHaveLength(2);
		// A Set, not a sorted array: Array#sort compares bigints as strings.
		expect(new Set(rows.map((r) => r.grossMinor))).toEqual(new Set([10000000n, 4000000n]));
	});

	// Re-filing the SAME slip has to keep finding its own row, or checking a
	// figure and uploading again would double the month.
	it('lets the same slip be filed again without becoming a second job', async () => {
		await slip(JOB_A, '2026-03');
		await file(JOB_A, 10000000n, 7500000n);
		await file(JOB_A, 10500000n, 7800000n);

		const rows = await rowsForMarch();
		expect(rows).toHaveLength(1);
		expect(rows[0].grossMinor).toBe(10500000n);
	});

	// A bank credit carries no document, and there is only ever one such row per
	// month — that is the old invariant, and it still holds.
	it('lets a bank credit fill the net of a month a payslip has not claimed', async () => {
		await recordSalary(
			{
				personId: ROBERT,
				periodMonth: '2026-03',
				currency: 'CZK',
				netMinor: 7500000n,
				source: 'statement'
			},
			testDb
		);
		await slip(JOB_A, '2026-03');
		await file(JOB_A, 10000000n, 7500000n);

		const rows = await rowsForMarch();
		expect(rows).toHaveLength(1);
		expect(rows[0].grossMinor).toBe(10000000n);
		expect(rows[0].documentId).toBe(JOB_A);
	});

	it('refuses a second row for the month that no payslip evidences', async () => {
		await recordSalary(
			{
				personId: ROBERT,
				periodMonth: '2026-03',
				currency: 'CZK',
				netMinor: 100n,
				source: 'statement'
			},
			testDb
		);
		await recordSalary(
			{
				personId: ROBERT,
				periodMonth: '2026-03',
				currency: 'CZK',
				netMinor: 200n,
				source: 'manual'
			},
			testDb
		);
		expect(await rowsForMarch()).toHaveLength(1);
	});
});

describe('what a month with two jobs reports', () => {
	const convert = (amount: bigint) => amount;

	it('adds the two statements together for the year', async () => {
		await slip(JOB_A, '2026-03');
		await slip(JOB_B, '2026-03');
		await file(JOB_A, 10000000n, 7500000n);
		await file(JOB_B, 4000000n, 3100000n);

		const [robert] = await loadSalaryHistory('CZK', convert, null, testDb);
		// Taking either row alone would report one employer and drop the other.
		expect(robert.years[0].grossTotalMinor).toBe(14000000n);
		expect(robert.years[0].netTotalMinor).toBe(10600000n);
		// One month, not two: the year counts months, and March is one of them.
		expect(robert.years[0].grossMonths).toBe(1);
	});

	it('lists both payslips, each with its own figures and its own file', async () => {
		await slip(JOB_A, '2026-03');
		await slip(JOB_B, '2026-03');
		await file(JOB_A, 10000000n, 7500000n);
		await file(JOB_B, 4000000n, 3100000n);

		const [robert] = await loadSalaryHistory('CZK', convert, null, testDb);
		expect(robert.payslips).toHaveLength(2);
		expect(new Set(robert.payslips.map((p) => p.documentId))).toEqual(new Set([JOB_A, JOB_B]));
		// Each row is addressed by its ENTRY, which is what a correction names.
		expect(new Set(robert.payslips.map((p) => p.id)).size).toBe(2);
	});

	// Null is "nobody said", and must not be summed as zero.
	it('does not turn a month nobody stated a net for into one that earned nothing', async () => {
		await slip(JOB_A, '2026-03');
		await recordSalary(
			{
				personId: ROBERT,
				periodMonth: '2026-03',
				currency: 'CZK',
				grossMinor: 10000000n,
				source: 'payslip',
				documentId: JOB_A
			},
			testDb
		);
		const [robert] = await loadSalaryHistory('CZK', convert, null, testDb);
		expect(robert.years[0].netMonths).toBe(0);
	});
});
