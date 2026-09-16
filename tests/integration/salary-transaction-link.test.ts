// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The visible cross-link between a payslip and the bank credit it was
 * matched with.
 *
 * `recordSalary` merges a slip and a credit into one row only in the
 * credit-first order: a transaction carries no evidence of which employer
 * paid it, so a credit arriving after the slip cannot find that row and
 * opens one of its own instead. This gap is intentional, not a bug.
 *
 * The link is written only when one row carries BOTH a `documentId` and a
 * `transactionId`. Deleting the slip cascades the link via
 * `document_link.document_id`; the transaction is never touched.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { rowId } from '../row-id';
import { documentLink, salaryEntry, transaction } from '$lib/server/db/schema';

import { removeDocument } from '$lib/server/documents/lifecycle';
import { recordSalary } from '$lib/server/salary';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeAccount, makeDocument, makePerson, makeTransaction } from './fixtures';

let harness: Harness;
let testDb: TestDb;

const ROBERT = rowId('stl-robert');
const ACCOUNT = rowId('stl-account');
const CREDIT = rowId('stl-credit');
const SLIP = rowId('stl-slip');
const SLIP_B = rowId('stl-slip-b');
const CREDIT_B = rowId('stl-credit-b');

beforeAll(async () => {
	harness = await startPostgres('salary-transaction-link');
	testDb = harness.db;
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 120_000);

afterAll(async () => {
	await harness?.stop();
});

beforeEach(async () => {
	await harness.sql`delete from document_link`;
	await harness.sql`delete from salary_entry`;
	await harness.sql`delete from transaction`;
	await harness.sql`delete from document`;
	await harness.sql`delete from account`;
	await harness.sql`delete from person`;
	await makePerson(testDb, { id: ROBERT, name: 'Robert', initials: 'R', role: 'admin' });
	await makeAccount(testDb, {
		id: ACCOUNT,
		name: 'Current',
		bank: 'fio',
		kind: 'current',
		currency: 'CZK'
	});
});

/** The bank credit half: a real transaction row, and the ledger's month. */
async function creditTxn(id: string, periodMonth: string, netMinor: bigint): Promise<void> {
	await makeTransaction(testDb, {
		id,
		accountId: ACCOUNT,
		bookedOn: `${periodMonth}-05`,
		amountMinor: netMinor,
		currency: 'CZK',
		counterparty: 'Acme s.r.o.',
		dedupFingerprint: `stl-credit-${id}`
	});
}

/** The payslip half: a document filed on Finance, linked to Robert. */
async function payslipDoc(id: string, periodMonth: string): Promise<void> {
	await makeDocument(testDb, {
		id,
		name: `Payslip ${periodMonth} · Robert`,
		shelfKey: 'income_tax',
		type: 'payslip',
		storedName: null,
		ext: 'PDF',
		addedOn: '2026-08-25',
		periodOn: `${periodMonth}-01`
	});
	await testDb.insert(documentLink).values({ documentId: id, targetId: ROBERT });
}

const credit = (periodMonth: string, netMinor: bigint) => creditTxn(CREDIT, periodMonth, netMinor);
const slip = () => payslipDoc(SLIP, '2026-07');

const linkedToCredit = async () =>
	testDb
		.select()
		.from(documentLink)
		.where(and(eq(documentLink.documentId, SLIP), eq(documentLink.targetId, CREDIT)));

const rowsFor = (periodMonth: string) =>
	testDb
		.select()
		.from(salaryEntry)
		.where(and(eq(salaryEntry.personId, ROBERT), eq(salaryEntry.periodMonth, periodMonth)));

describe('D6: payslip <-> bank credit cross-link', () => {
	it('links the slip to the credit when the credit is recorded first', async () => {
		await credit('2026-07', 52_310_00n);
		expect(
			await recordSalary(
				{
					personId: ROBERT,
					periodMonth: '2026-07',
					currency: 'CZK',
					netMinor: 52_310_00n,
					source: 'statement',
					transactionId: CREDIT
				},
				testDb
			)
		).toEqual({ ok: true });
		expect(await linkedToCredit()).toHaveLength(0);

		await slip();
		expect(
			await recordSalary(
				{
					personId: ROBERT,
					periodMonth: '2026-07',
					currency: 'CZK',
					grossMinor: 68_400_00n,
					source: 'payslip',
					documentId: SLIP
				},
				testDb
			)
		).toEqual({ ok: true });

		expect(await linkedToCredit()).toHaveLength(1);
	});

	// Slip-first order does NOT merge: a credit arriving afterwards names a
	// transaction, not a document, so it cannot find the slip's row.
	it('does not merge — and links nothing — when the credit is recorded after the slip', async () => {
		await slip();
		expect(
			await recordSalary(
				{
					personId: ROBERT,
					periodMonth: '2026-07',
					currency: 'CZK',
					grossMinor: 68_400_00n,
					source: 'payslip',
					documentId: SLIP
				},
				testDb
			)
		).toEqual({ ok: true });

		await credit('2026-07', 52_310_00n);
		expect(
			await recordSalary(
				{
					personId: ROBERT,
					periodMonth: '2026-07',
					currency: 'CZK',
					netMinor: 52_310_00n,
					source: 'statement',
					transactionId: CREDIT
				},
				testDb
			)
		).toEqual({ ok: true });

		const rows = await rowsFor('2026-07');
		expect(rows).toHaveLength(2);
		const slipRow = rows.find((r) => r.documentId === SLIP);
		const creditRow = rows.find((r) => r.documentId === null);
		expect(slipRow?.transactionId).toBeNull();
		expect(creditRow?.transactionId).toBe(CREDIT);
		expect(creditRow?.netMinor).toBe(52_310_00n);

		// No row ever carried both ids, so the link never had anything to write.
		expect(await linkedToCredit()).toHaveLength(0);
		expect(await testDb.select().from(documentLink)).toEqual([
			{ documentId: SLIP, targetId: ROBERT }
		]);
	});

	// A count of "the one payslip row still missing a credit" cannot tell job
	// A from job B, so a fix matching on that alone would attach the wrong
	// employer's money to the wrong slip.
	it('leaves both payslip rows alone when a credit arrives for a two-job month', async () => {
		await payslipDoc(SLIP, '2026-07');
		await payslipDoc(SLIP_B, '2026-07');
		expect(
			await recordSalary(
				{
					personId: ROBERT,
					periodMonth: '2026-07',
					currency: 'CZK',
					grossMinor: 68_400_00n,
					source: 'payslip',
					documentId: SLIP
				},
				testDb
			)
		).toEqual({ ok: true });
		expect(
			await recordSalary(
				{
					personId: ROBERT,
					periodMonth: '2026-07',
					currency: 'CZK',
					grossMinor: 40_000_00n,
					source: 'payslip',
					documentId: SLIP_B
				},
				testDb
			)
		).toEqual({ ok: true });

		await creditTxn(CREDIT_B, '2026-07', 31_000_00n);
		expect(
			await recordSalary(
				{
					personId: ROBERT,
					periodMonth: '2026-07',
					currency: 'CZK',
					netMinor: 31_000_00n,
					source: 'statement',
					transactionId: CREDIT_B
				},
				testDb
			)
		).toEqual({ ok: true });

		const rows = await rowsFor('2026-07');
		expect(rows).toHaveLength(3);
		const rowA = rows.find((r) => r.documentId === SLIP);
		const rowB = rows.find((r) => r.documentId === SLIP_B);
		const creditRow = rows.find((r) => r.documentId === null);
		expect(rowA?.transactionId).toBeNull();
		expect(rowB?.transactionId).toBeNull();
		expect(creditRow?.transactionId).toBe(CREDIT_B);

		expect(await testDb.select().from(documentLink)).toEqual(
			expect.arrayContaining([
				{ documentId: SLIP, targetId: ROBERT },
				{ documentId: SLIP_B, targetId: ROBERT }
			])
		);
		expect(await testDb.select().from(documentLink)).toHaveLength(2);
	});

	it('links nothing for a slip with no matched credit', async () => {
		await slip();
		expect(
			await recordSalary(
				{
					personId: ROBERT,
					periodMonth: '2026-07',
					currency: 'CZK',
					grossMinor: 68_400_00n,
					source: 'payslip',
					documentId: SLIP
				},
				testDb
			)
		).toEqual({ ok: true });

		expect(await linkedToCredit()).toHaveLength(0);
		// The slip's own link to the person survives; only the credit link is
		// missing, since none was ever matched.
		expect(await testDb.select().from(documentLink)).toEqual([
			{ documentId: SLIP, targetId: ROBERT }
		]);
	});

	it('removes the link when the slip is deleted, leaving the transaction intact', async () => {
		await credit('2026-07', 52_310_00n);
		await recordSalary(
			{
				personId: ROBERT,
				periodMonth: '2026-07',
				currency: 'CZK',
				netMinor: 52_310_00n,
				source: 'statement',
				transactionId: CREDIT
			},
			testDb
		);
		await slip();
		await recordSalary(
			{
				personId: ROBERT,
				periodMonth: '2026-07',
				currency: 'CZK',
				grossMinor: 68_400_00n,
				source: 'payslip',
				documentId: SLIP
			},
			testDb
		);
		expect(await linkedToCredit()).toHaveLength(1);

		expect(await removeDocument(SLIP, testDb)).toEqual({ ok: true });

		expect(await linkedToCredit()).toHaveLength(0);
		const [row] = await testDb.select().from(transaction).where(eq(transaction.id, CREDIT));
		expect(row).toBeDefined();
		expect(row.amountMinor).toBe(52_310_00n);

		// The re-recorded credit-only row has no documentId, so the "both present"
		// condition must stay false and no new link may appear for it.
		expect(await testDb.select().from(documentLink)).toHaveLength(0);
	});

	// A re-recorded credit must never fold into an UNRELATED payslip's row
	// just because that row also has no transaction yet.
	it('does not fold a re-recorded credit into an unrelated payslip when the merged slip is deleted', async () => {
		await creditTxn(CREDIT, '2026-07', 52_310_00n);
		expect(
			await recordSalary(
				{
					personId: ROBERT,
					periodMonth: '2026-07',
					currency: 'CZK',
					netMinor: 52_310_00n,
					source: 'statement',
					transactionId: CREDIT
				},
				testDb
			)
		).toEqual({ ok: true });
		await payslipDoc(SLIP, '2026-07');
		expect(
			await recordSalary(
				{
					personId: ROBERT,
					periodMonth: '2026-07',
					currency: 'CZK',
					grossMinor: 68_400_00n,
					source: 'payslip',
					documentId: SLIP
				},
				testDb
			)
		).toEqual({ ok: true });

		await payslipDoc(SLIP_B, '2026-07');
		expect(
			await recordSalary(
				{
					personId: ROBERT,
					periodMonth: '2026-07',
					currency: 'CZK',
					grossMinor: 40_000_00n,
					source: 'payslip',
					documentId: SLIP_B
				},
				testDb
			)
		).toEqual({ ok: true });

		const before = await rowsFor('2026-07');
		expect(before).toHaveLength(2);
		const rowBBefore = before.find((r) => r.documentId === SLIP_B);
		expect(rowBBefore?.transactionId).toBeNull();
		expect(rowBBefore?.grossMinor).toBe(40_000_00n);

		expect(await removeDocument(SLIP, testDb)).toEqual({ ok: true });

		const after = await rowsFor('2026-07');
		expect(after).toHaveLength(2);
		const rowB = after.find((r) => r.documentId === SLIP_B);
		const creditRow = after.find((r) => r.documentId === null);
		// Job B's row is exactly as it was: same gross, still no transaction.
		expect(rowB?.grossMinor).toBe(40_000_00n);
		expect(rowB?.transactionId).toBeNull();
		// The credit re-recorded from the deleted slip is its own row, not
		// folded into job B's.
		expect(creditRow?.transactionId).toBe(CREDIT);
		expect(creditRow?.netMinor).toBe(52_310_00n);

		expect(await testDb.select().from(documentLink)).toEqual([
			{ documentId: SLIP_B, targetId: ROBERT }
		]);
	});
});
