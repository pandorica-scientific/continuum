// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * D6: the visible cross-link between a payslip and the bank credit it was
 * matched with.
 *
 * `recordSalary` merges a slip and a credit for the same person and month
 * into one row ONLY in the credit-first order: a slip arriving after a credit
 * finds the credit's document-less row and claims it, but a credit arriving
 * after the slip has no such row to find — a transaction carries no evidence
 * of which employer paid it, which matters the moment a month can hold more
 * than one payslip — so it opens a row of its own instead. This suite adds
 * the `document_link` that makes a genuine merge visible, and separately
 * pins down the order the merge does not happen in, so nobody mistakes the
 * gap for a bug this task introduced or is meant to close: it is out of this
 * release's scope, per the controller's ruling on this task's review.
 *
 * The link is written only when one row actually carries BOTH a `documentId`
 * and a `transactionId` — a slip recorded alone gets none, and a credit that
 * opens its own row gets none either. Deleting the slip through
 * `removeDocument` (Task 9) has to take the link with it without any code
 * here: `document_link.document_id` cascades, and the transaction is never
 * touched.
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

const ADMIN = { id: ROBERT, role: 'admin' } as const;

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
		shelfKey: 'finance',
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

	// The order that does NOT merge, pinned down rather than assumed. A slip
	// filed first claims the month's row; a credit that arrives afterwards
	// names a transaction, not a document, so it cannot find that row back —
	// nothing here says "this payment belongs to the payslip already on file".
	// It opens a document-less row of its own instead, same as any other
	// statement figure with nothing to merge into. Fixing the matching so a
	// later credit finds the right payslip is real work — the evidence for
	// WHICH employer a transaction pays lives in the attribution/matching
	// layer, not in a row count — and the controller has ruled it out of this
	// release. This test exists so the gap is documented and caught if it ever
	// silently changes, not so the gap looks solved.
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

		// No row ever carried both ids, so D6's link never had anything to write.
		expect(await linkedToCredit()).toHaveLength(0);
		expect(await testDb.select().from(documentLink)).toEqual([
			{ documentId: SLIP, targetId: ROBERT }
		]);
	});

	// The two-job case this gap is sharpest for: a count of "the one payslip
	// row still missing a credit" cannot tell job A from job B, so a fix that
	// merged on that alone would have attached the wrong employer's money to
	// the wrong slip. Asserting the credit stays on its own row here is what
	// stands in for that fix's absence.
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

		expect(await removeDocument(SLIP, ADMIN, testDb)).toEqual({ ok: true });

		expect(await linkedToCredit()).toHaveLength(0);
		const [row] = await testDb.select().from(transaction).where(eq(transaction.id, CREDIT));
		expect(row).toBeDefined();
		expect(row.amountMinor).toBe(52_310_00n);

		// forgetPayslip re-records the credit-only row through recordSalary with no
		// documentId — the "both present" condition must stay false, and no new
		// link may appear for it.
		expect(await testDb.select().from(documentLink)).toHaveLength(0);
	});

	// forgetPayslip's re-record must never reach across to an UNRELATED
	// payslip's row just because that row also has no transaction yet — the
	// same order-dependent gap this suite pins down above, seen from the
	// deletion side. Job B's row is untouched, both in its own figures and in
	// its own links, while job A's credit gets its own document-less row back.
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

		expect(await removeDocument(SLIP, ADMIN, testDb)).toEqual({ ok: true });

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
