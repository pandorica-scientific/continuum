// SPDX-License-Identifier: AGPL-3.0-or-later
// The currency a month is recorded in.
//
// It was taken from the household's base currency until v0.5.1, which is right
// only when the two happen to agree. On the household this was found in they did
// not: base was EUR, the payslips were Czech, and six months were stored as
// 135 887 EUR — a figure every conversion downstream then multiplied by the euro
// rate.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { rowId } from '../row-id';
import { documentLink, salaryEntry } from '$lib/server/db/schema';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeDocument, makePerson } from './fixtures';
import { learnPayslipCurrency, loadSalaryHistory, recordSalary } from '$lib/server/salary';
import { getSetting } from '$lib/server/settings';

let harness: Harness;
let testDb: TestDb;
const ROBERT = rowId('person-robert');

beforeAll(async () => {
	harness = await startPostgres('salary-currency');
	testDb = harness.db;
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 120_000);

afterAll(async () => {
	await harness?.stop();
});

beforeEach(async () => {
	await harness.sql`delete from settings`;
	await harness.sql`delete from document_link`;
	await harness.sql`delete from salary_entry`;
	await harness.sql`delete from document`;
	await harness.sql`delete from person`;
	await makePerson(testDb, { id: ROBERT, name: 'Robert', initials: 'R', role: 'admin' });
});

async function monthOf(periodMonth: string) {
	const [row] = await testDb
		.select()
		.from(salaryEntry)
		.where(and(eq(salaryEntry.personId, ROBERT), eq(salaryEntry.periodMonth, periodMonth)));
	return row;
}

describe('the currency an entry holds', () => {
	it('is whatever the first recording stated', async () => {
		await recordSalary(
			{
				personId: ROBERT,
				periodMonth: '2026-01',
				currency: 'CZK',
				grossMinor: 13588700n,
				source: 'payslip'
			},
			testDb
		);
		expect((await monthOf('2026-01')).currency).toBe('CZK');
	});

	/**
	 * A month can be evidenced twice — a payslip stating gross and a bank credit
	 * stating net — and the entry holds one currency for both. A statement in the
	 * account's currency must not silently relabel the gross beside it.
	 */
	it('is left alone by a later recording that does not restate it', async () => {
		await recordSalary(
			{
				personId: ROBERT,
				periodMonth: '2026-02',
				currency: 'CZK',
				grossMinor: 13393500n,
				source: 'payslip'
			},
			testDb
		);
		await recordSalary(
			{
				personId: ROBERT,
				periodMonth: '2026-02',
				currency: 'EUR',
				netMinor: 10086700n,
				source: 'statement'
			},
			testDb
		);
		expect((await monthOf('2026-02')).currency).toBe('CZK');
	});

	// A re-upload restates the month. Moving the figures and leaving the label
	// behind is what leaves koruna digits under a euro sign.
	it('follows a recording that restates it', async () => {
		await recordSalary(
			{
				personId: ROBERT,
				periodMonth: '2026-03',
				currency: 'EUR',
				grossMinor: 20101900n,
				source: 'payslip'
			},
			testDb
		);
		await recordSalary(
			{
				personId: ROBERT,
				periodMonth: '2026-03',
				currency: 'CZK',
				restateCurrency: true,
				grossMinor: 20101900n,
				source: 'payslip'
			},
			testDb
		);
		const row = await monthOf('2026-03');
		expect(row.currency).toBe('CZK');
		// A relabel, never a conversion: the digits are what the slip printed.
		expect(row.grossMinor).toBe(20101900n);
	});
});

describe('which currency a slip row is read in', () => {
	// 1 EUR = 25 CZK, flat. Enough to tell a converted figure from a stored one.
	const convert = (amount: bigint, from: string, to: string) => {
		if (from === to) return amount;
		if (from === 'CZK' && to === 'EUR') return amount / 25n;
		if (from === 'EUR' && to === 'CZK') return amount * 25n;
		return amount;
	};

	async function czechSlip(month: string, id: string) {
		await makeDocument(testDb, {
			id,
			name: `Payslip ${month} · Robert`,
			shelfKey: 'finance',
			type: 'payslip',
			storedName: `${month}.pdf`,
			ext: 'PDF',
			addedOn: '2026-08-25',
			periodOn: `${month}-01`
		});
		await testDb.insert(documentLink).values({ documentId: id, targetId: ROBERT });
		await recordSalary(
			{
				personId: ROBERT,
				periodMonth: month,
				currency: 'CZK',
				grossMinor: 13588700n,
				netMinor: 10220200n,
				source: 'payslip',
				documentId: id
			},
			testDb
		);
	}

	/**
	 * The row is the EVIDENCE, and the evidence says 135 887 Kč. Restating it in
	 * the household's currency shows a number that appears nowhere on the piece
	 * of paper the row links to — which is what the screen did until v0.5.1.
	 */
	it('reports a slip as it was recorded, not converted to the base', async () => {
		await czechSlip('2026-01', rowId('doc-jan'));
		const [robert] = await loadSalaryHistory('EUR', convert, null, testDb);
		expect(robert.payslips).toHaveLength(1);
		expect(robert.payslips[0].currency).toBe('CZK');
		expect(robert.payslips[0].grossMinor).toBe(13588700n);
		expect(robert.payslips[0].netMinor).toBe(10220200n);
	});

	// The year rows are the opposite question: comparing years cannot be asked
	// across currencies, so those stay converted.
	it('still converts the year rows to the base currency', async () => {
		await czechSlip('2026-02', rowId('doc-feb'));
		const [robert] = await loadSalaryHistory('EUR', convert, null, testDb);
		expect(robert.years[0].grossTotalMinor).toBe(13588700n / 25n);
	});
});

describe('remembering a person\u2019s payslip currency', () => {
	const stored = () => getSetting<Record<string, string>>('payslipCurrencies', {}, testDb);

	// Plenty of payslips print no currency anywhere on the page. Without this the
	// field has to be answered by hand every month for a job that has not changed.
	it('keeps what was stated, keyed by the person it was stated for', async () => {
		await learnPayslipCurrency('Robert', 'CZK', testDb);
		expect(await stored()).toEqual({ robert: 'CZK' });
	});

	// The reader is given a name, and matches it case-insensitively — the same
	// key the gross, net and bonus labels are learned under.
	it('is case-insensitive about the name', async () => {
		await learnPayslipCurrency('ROBERT', 'CZK', testDb);
		expect((await stored())['robert']).toBe('CZK');
	});

	it('holds a different answer for each person', async () => {
		await learnPayslipCurrency('Robert', 'CZK', testDb);
		await learnPayslipCurrency('Kseniya', 'EUR', testDb);
		expect(await stored()).toEqual({ robert: 'CZK', kseniya: 'EUR' });
	});

	// A job can change, and the newest statement is the one that counts.
	it('replaces the old answer rather than keeping both', async () => {
		await learnPayslipCurrency('Robert', 'CZK', testDb);
		await learnPayslipCurrency('Robert', 'EUR', testDb);
		expect(await stored()).toEqual({ robert: 'EUR' });
	});
});
