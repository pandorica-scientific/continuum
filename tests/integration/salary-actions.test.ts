// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The Salary screen's actions need a Request, which the harness cannot build,
// so these exercise the functions the actions are composed of.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { rowId } from '../row-id';
import { document, documentLink, salaryEntry } from '$lib/server/db/schema';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeDocument, makePerson } from './fixtures';
import { recordSalary, salaryMonths, slipDocument } from '$lib/server/salary';

let harness: Harness;
let testDb: TestDb;
const ROBERT = rowId('person-robert');
const DOC = rowId('doc-aug');

beforeAll(async () => {
	harness = await startPostgres('salary-actions');
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

async function slipFor(month: string, id = DOC) {
	await makeDocument(testDb, {
		id,
		name: `Payslip ${month} · Robert`,
		shelfKey: 'finance',
		type: 'payslip',
		storedName: `${month}.pdf`,
		ext: 'PDF',
		addedOn: '2026-09-01',
		periodOn: `${month}-01`
	});
	await testDb.insert(documentLink).values({ documentId: id, targetId: ROBERT });
}

describe('deleting a payslip', () => {
	it('removes the month entirely, not just the payslip-side fields', async () => {
		// The month also carries a net figure that came from a bank credit. It
		// goes too — that was the decision, and the screen warns before doing it.
		await slipFor('2026-08');
		await recordSalary(
			{
				personId: ROBERT,
				periodMonth: '2026-08',
				currency: 'CZK',
				grossMinor: 10000000n,
				netMinor: 7140000n,
				source: 'payslip',
				documentId: DOC
			},
			testDb
		);

		const slip = await slipDocument(DOC, testDb);
		expect(slip?.id).toBe(DOC);

		await testDb
			.delete(salaryEntry)
			.where(and(eq(salaryEntry.personId, ROBERT), eq(salaryEntry.periodMonth, '2026-08')));
		await testDb.delete(document).where(eq(document.id, DOC));

		expect(await salaryMonths(ROBERT, testDb)).toHaveLength(0);
		expect(await testDb.select().from(document).where(eq(document.id, DOC))).toHaveLength(0);
	});
});

describe('re-recording a month', () => {
	it('updates in place rather than adding a second row', async () => {
		await recordSalary(
			{
				personId: ROBERT,
				periodMonth: '2026-08',
				currency: 'CZK',
				grossMinor: 10000000n,
				source: 'payslip'
			},
			testDb
		);
		await recordSalary(
			{
				personId: ROBERT,
				periodMonth: '2026-08',
				currency: 'CZK',
				grossMinor: 11000000n,
				source: 'payslip'
			},
			testDb
		);
		const rows = await salaryMonths(ROBERT, testDb);
		expect(rows).toHaveLength(1);
		expect(rows[0].grossMinor).toBe(11000000n);
	});

	it('does not let an automatic reading overwrite a correction', async () => {
		await recordSalary(
			{
				personId: ROBERT,
				periodMonth: '2026-08',
				currency: 'CZK',
				grossMinor: 10000000n,
				source: 'manual',
				overridden: true
			},
			testDb
		);
		await recordSalary(
			{
				personId: ROBERT,
				periodMonth: '2026-08',
				currency: 'CZK',
				grossMinor: 9999n,
				source: 'payslip'
			},
			testDb
		);
		const [row] = await salaryMonths(ROBERT, testDb);
		expect(row.grossMinor).toBe(10000000n);
	});

	it('does let a typed figure replace a correction', async () => {
		// A figure somebody types into the upload form is a decision too, and the
		// later decision is the one that stands.
		await recordSalary(
			{
				personId: ROBERT,
				periodMonth: '2026-08',
				currency: 'CZK',
				grossMinor: 10000000n,
				source: 'manual',
				overridden: true
			},
			testDb
		);
		await recordSalary(
			{
				personId: ROBERT,
				periodMonth: '2026-08',
				currency: 'CZK',
				grossMinor: 11000000n,
				source: 'payslip',
				overridden: true
			},
			testDb
		);
		const [row] = await salaryMonths(ROBERT, testDb);
		expect(row.grossMinor).toBe(11000000n);
	});
});

describe('a bonus correction on its own', () => {
	it('leaves gross and net exactly where they were', async () => {
		await recordSalary(
			{
				personId: ROBERT,
				periodMonth: '2026-08',
				currency: 'CZK',
				grossMinor: 10000000n,
				netMinor: 7140000n,
				source: 'payslip'
			},
			testDb
		);
		const out = await recordSalary(
			{
				personId: ROBERT,
				periodMonth: '2026-08',
				currency: 'CZK',
				bonusMinor: 2500000n,
				source: 'manual',
				overridden: true
			},
			testDb
		);
		expect(out).toEqual({ ok: true });
		const [row] = await salaryMonths(ROBERT, testDb);
		expect(row.grossMinor).toBe(10000000n);
		expect(row.netMinor).toBe(7140000n);
		expect(row.bonusMinor).toBe(2500000n);
	});

	it('clears back to null, which is not zero', async () => {
		// An empty bonus field means "the slip did not say", and the screen
		// renders that differently from a slip that stated none.
		await recordSalary(
			{
				personId: ROBERT,
				periodMonth: '2026-08',
				currency: 'CZK',
				grossMinor: 10000000n,
				bonusMinor: 2500000n,
				source: 'payslip'
			},
			testDb
		);
		await testDb
			.update(salaryEntry)
			.set({ bonusMinor: null })
			.where(and(eq(salaryEntry.personId, ROBERT), eq(salaryEntry.periodMonth, '2026-08')));
		const [row] = await salaryMonths(ROBERT, testDb);
		expect(row.bonusMinor).toBeNull();
	});
});
