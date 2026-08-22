// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { rowId } from '../row-id';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '$lib/server/db/schema';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { createLoan, updateLoan, type CreateLoanInput } from '$lib/server/loans/mutations';

/**
 * The "how it works" half of an edit, which every case here leaves alone.
 *
 * Spread into each input so a case states only what it is actually changing —
 * and so adding another descriptive field means touching this once rather than
 * every literal in the file.
 */
const HOW: Pick<
	Parameters<typeof updateLoan>[1],
	'regime' | 'accrualStyle' | 'dayCount' | 'interestDeductible'
> = {
	regime: 'fixed_period',
	accrualStyle: 'payment',
	dayCount: '30/360',
	interestDeductible: false
};

let harness: Harness;
let testDb: TestDb;

const FLAT_A = rowId('flat-a');
const FLAT_B = rowId('flat-b');

function validLoanInput(overrides: Partial<CreateLoanInput> = {}): CreateLoanInput {
	return {
		name: 'Mortgage',
		lender: 'ČS',
		kind: 'mortgage',
		currency: 'CZK',
		principal: '5 000 000',
		owed: '4 000 000',
		payment: '25 000',
		rate: '4.25',
		regime: 'fixed_period',
		dayCount: '30/360',
		accrualStyle: 'payment',
		paymentDay: 15,
		fixedUntil: '2029-08-15',
		startsOn: '2026-08-15',
		endsOn: '2036-08-15',
		interestDeductible: false,
		secured: [],
		today: '2026-08-15',
		...overrides
	};
}

async function seedLoan(overrides: Partial<CreateLoanInput> = {}): Promise<string> {
	const result = await createLoan(validLoanInput(overrides), testDb);
	expect(result.ok).toBe(true);
	const [row] = await testDb.select().from(schema.loan);
	return row.id;
}

async function fixations(loanId: string) {
	return testDb
		.select()
		.from(schema.loanFixationPeriod)
		.where(eq(schema.loanFixationPeriod.loanId, loanId))
		.orderBy(schema.loanFixationPeriod.startsOn);
}

async function securedPropertyIds(loanId: string): Promise<string[]> {
	const rows = await testDb
		.select()
		.from(schema.loanProperty)
		.where(eq(schema.loanProperty.loanId, loanId));
	return rows.map((r) => r.propertyId).sort();
}

beforeAll(async () => {
	harness = await startPostgres('loan-edit');
	testDb = harness.db;
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 120_000);

afterAll(async () => {
	await harness?.stop();
});

beforeEach(async () => {
	await harness.sql`truncate loan, property cascade`;
	await testDb.insert(schema.property).values([
		{ id: FLAT_A, name: 'Flat A', kind: 'rented', currency: 'CZK', valueMinor: 800_000_000n },
		{ id: FLAT_B, name: 'Flat B', kind: 'lived', currency: 'CZK', valueMinor: 600_000_000n }
	]);
});

describe('updateLoan', () => {
	it('adds a property the loan was created without', async () => {
		// The reported case: "if [I] forgot to add another property into a
		// mortgage". One shared mortgage over two flats is the real household.
		const id = await seedLoan({ secured: [{ propertyId: FLAT_A, sharePct: null }] });

		const result = await updateLoan(
			id,
			{
				name: 'Mortgage',
				lender: 'ČS',
				kind: 'mortgage',
				paymentDay: 15,
				endsOn: '2036-08-15',
				secured: [
					{ propertyId: FLAT_A, sharePct: '60' },
					{ propertyId: FLAT_B, sharePct: '40' }
				],
				...HOW
			},
			testDb
		);

		expect(result.ok).toBe(true);
		expect(await securedPropertyIds(id)).toEqual([FLAT_A, FLAT_B].sort());
	});

	it('leaves every fixation period untouched', async () => {
		const id = await seedLoan({ secured: [{ propertyId: FLAT_A, sharePct: null }] });
		const before = await fixations(id);
		expect(before).toHaveLength(1);

		await updateLoan(
			id,
			{
				name: 'Renamed',
				lender: 'Another bank',
				kind: 'mortgage',
				paymentDay: 20,
				endsOn: '2040-01-01',
				secured: [{ propertyId: FLAT_B, sharePct: null }],
				...HOW
			},
			testDb
		);

		// The load-bearing guard. A rewrite once deleted the fixation history as a
		// side effect of an edit, and that history is the loan's evidence: it is
		// what every interest figure is computed from and it cannot be recovered
		// from anything else the app stores.
		expect(await fixations(id)).toEqual(before);
	});

	it('refuses an end date that would fall inside the fixation history', async () => {
		const id = await seedLoan();

		const result = await updateLoan(
			id,
			{
				name: 'Mortgage',
				lender: 'ČS',
				kind: 'mortgage',
				paymentDay: 15,
				// The fixation runs to 2029-08-15; ending the loan in 2027 would
				// orphan the rest of it.
				endsOn: '2027-01-01',
				secured: [],
				...HOW
			},
			testDb
		);

		expect(result).toEqual({
			ok: false,
			status: 400,
			message: 'The loan cannot end before its recorded fixation periods do.'
		});
		expect(await fixations(id)).toHaveLength(1);
	});

	it('refuses the same property twice', async () => {
		const id = await seedLoan();

		const result = await updateLoan(
			id,
			{
				name: 'Mortgage',
				lender: 'ČS',
				kind: 'mortgage',
				paymentDay: 15,
				endsOn: '2036-08-15',
				secured: [
					{ propertyId: FLAT_A, sharePct: '50' },
					{ propertyId: FLAT_A, sharePct: '50' }
				],
				...HOW
			},
			testDb
		);

		expect(result.ok).toBe(false);
	});

	it('refuses shares totalling more than the whole property', async () => {
		const id = await seedLoan();

		const result = await updateLoan(
			id,
			{
				name: 'Mortgage',
				lender: 'ČS',
				kind: 'mortgage',
				paymentDay: 15,
				endsOn: '2036-08-15',
				secured: [
					{ propertyId: FLAT_A, sharePct: '70' },
					{ propertyId: FLAT_B, sharePct: '70' }
				],
				...HOW
			},
			testDb
		);

		expect(result.ok).toBe(false);
	});

	it('reports a loan that is not there rather than silently doing nothing', async () => {
		const result = await updateLoan(
			rowId('no-such-loan'),
			{
				name: 'Mortgage',
				lender: 'ČS',
				kind: 'mortgage',
				paymentDay: 15,
				endsOn: null,
				secured: [],
				...HOW
			},
			testDb
		);

		expect(result).toEqual({ ok: false, status: 404, message: 'Loan not found.' });
	});
});

// Reported as fixed and uncorrectable: "cannot edit loan fully — things like
// rate regime, interest change, interest accrual are fixed".
//
// These describe HOW a loan works rather than what it has done, so changing one
// re-derives the schedule from the periods already recorded. The test that
// matters is the second: none of them may touch that record.
describe('how a loan works', () => {
	it('can be corrected after the loan exists', async () => {
		const id = await seedLoan();

		const result = await updateLoan(
			id,
			{
				name: 'Mortgage',
				lender: 'ČS',
				kind: 'mortgage',
				paymentDay: 15,
				endsOn: '2036-08-15',
				secured: [],
				regime: 'floating',
				accrualStyle: 'calendar',
				dayCount: 'act/360',
				interestDeductible: true
			},
			testDb
		);
		expect(result).toEqual({ ok: true });

		const [row] = await testDb.select().from(schema.loan).where(eq(schema.loan.id, id));
		expect(row.regime).toBe('floating');
		expect(row.accrualStyle).toBe('calendar');
		expect(row.dayCount).toBe('act/360');
		expect(row.interestDeductible).toBe(true);
	});

	it('leaves the fixation history exactly where it was', async () => {
		const id = await seedLoan();
		const before = await fixations(id);
		expect(before.length).toBeGreaterThan(0);

		await updateLoan(
			id,
			{
				name: 'Mortgage',
				lender: 'ČS',
				kind: 'mortgage',
				paymentDay: 15,
				endsOn: '2036-08-15',
				secured: [],
				regime: 'floating',
				accrualStyle: 'calendar',
				dayCount: 'act/360',
				interestDeductible: true
			},
			testDb
		);

		// The load-bearing guard, restated for the fields added here: an edit is a
		// correction to a description, never permission to discard the record.
		expect(await fixations(id)).toEqual(before);
	});

	it('falls back to what is stored rather than accepting an invented value', async () => {
		const id = await seedLoan();
		const [was] = await testDb.select().from(schema.loan).where(eq(schema.loan.id, id));

		await updateLoan(
			id,
			{
				name: 'Mortgage',
				lender: 'ČS',
				kind: 'mortgage',
				paymentDay: 15,
				endsOn: '2036-08-15',
				secured: [],
				regime: 'nonsense',
				accrualStyle: 'nonsense',
				dayCount: 'nonsense',
				interestDeductible: false
			},
			testDb
		);

		// Narrowed at the boundary, so a hand-crafted form post cannot reach the
		// CHECK constraint and turn a bad field into a failed transaction.
		const [now] = await testDb.select().from(schema.loan).where(eq(schema.loan.id, id));
		expect(now.regime).toBe(was.regime);
		expect(now.accrualStyle).toBe(was.accrualStyle);
		expect(now.dayCount).toBe(was.dayCount);
	});
});
