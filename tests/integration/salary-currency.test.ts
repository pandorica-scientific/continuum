// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
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
import { person, salaryEntry } from '$lib/server/db/schema';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { recordSalary } from '$lib/server/salary';

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
	await harness.sql`delete from salary_entry`;
	await harness.sql`delete from person`;
	await testDb
		.insert(person)
		.values([{ id: ROBERT, name: 'Robert', initials: 'R', role: 'admin' }]);
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
