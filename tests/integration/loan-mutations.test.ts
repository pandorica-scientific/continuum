import { rowId } from '../row-id';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '$lib/server/db/schema';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeLoan } from './fixtures';
import {
	createLoan,
	recordRepayment,
	replaceFixation,
	type CreateLoanInput
} from '$lib/server/loans/mutations';

let harness: Harness;
let testDb: TestDb;

async function seedLoan(id = rowId('loan-a')): Promise<void> {
	await makeLoan(testDb, {
		id,
		name: 'Mortgage',
		lender: 'Bank',
		kind: 'mortgage',
		currency: 'CZK',
		principalMinor: 1_000_000n,
		owedMinor: 800_000n,
		owedOn: '2026-08-01',
		startsOn: '2024-01-01',
		endsOn: null,
		regime: 'fixed_period',
		dayCount: '30/360',
		accrualStyle: 'payment',
		paymentDay: 15,
		interestDeductible: true
	});
}

function validLoanInput(overrides: Partial<CreateLoanInput> = {}): CreateLoanInput {
	return {
		name: 'New mortgage',
		lender: 'Bank',
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
		interestDeductible: true,
		secured: [],
		today: '2026-08-15',
		...overrides
	};
}

beforeAll(async () => {
	harness = await startPostgres('loan-mutations');
	testDb = harness.db;
	// The real schema, not a hand-written subset of it. The subset that used
	// to live here had to be kept in step with schema.ts by hand, and a test
	// passing against a stale copy of a table says nothing about the real one.
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 30_000);

beforeEach(async () => {
	await harness.sql.unsafe(`
		drop trigger if exists fail_loan_update on loan;
		drop function if exists fail_loan_update();
		drop trigger if exists fail_refix_event on loan_event;
		drop function if exists fail_refix_event();
		drop trigger if exists fail_initial_fixation on loan_fixation_period;
		drop function if exists fail_initial_fixation();
		truncate table loan_event, loan_fixation_period, loan_property, loan, property cascade;
	`);
});

afterAll(async () => {
	await harness?.stop();
});

describe('loan mutation transactions', () => {
	it('rejects invalid and backdated repayments without moving the balance anchor', async () => {
		await seedLoan();

		expect(
			await recordRepayment(
				{
					loanId: rowId('loan-a'),
					date: '2026-02-30',
					amount: '1 000',
					balanceAfter: '',
					note: ''
				},
				testDb
			)
		).toEqual({ ok: false, status: 400, message: 'The repayment needs a valid date.' });
		expect(
			await recordRepayment(
				{
					loanId: rowId('loan-a'),
					date: '2026-07-31',
					amount: '1 000',
					balanceAfter: '',
					note: ''
				},
				testDb
			)
		).toEqual({
			ok: false,
			status: 400,
			message: 'The repayment cannot predate the current balance.'
		});
		expect(
			await recordRepayment(
				{
					loanId: rowId('loan-a'),
					date: '2099-01-01',
					amount: '1 000',
					balanceAfter: '',
					note: ''
				},
				testDb
			)
		).toEqual({
			ok: false,
			status: 400,
			message: 'The repayment cannot be in the future.'
		});

		expect(await testDb.select().from(schema.loanEvent)).toHaveLength(0);
		expect(await testDb.select().from(schema.loan)).toMatchObject([
			{ id: rowId('loan-a'), owedMinor: 800_000n, owedOn: '2026-08-01' }
		]);
	});

	it('rejects overpayments and balance-after values that increase the debt', async () => {
		await seedLoan();

		for (const input of [
			{
				loanId: rowId('loan-a'),
				date: '2026-08-15',
				amount: '9 000',
				balanceAfter: '',
				note: ''
			},
			{
				loanId: rowId('loan-a'),
				date: '2026-08-15',
				amount: '1 000',
				balanceAfter: '9 000',
				note: ''
			}
		]) {
			expect(await recordRepayment(input, testDb)).toMatchObject({ ok: false, status: 400 });
		}

		expect(await testDb.select().from(schema.loanEvent)).toHaveLength(0);
		expect(await testDb.select().from(schema.loan)).toMatchObject([
			{ id: rowId('loan-a'), owedMinor: 800_000n, owedOn: '2026-08-01' }
		]);
	});

	it('rejects impossible loan amounts and chronology before inserting anything', async () => {
		const invalidInputs: CreateLoanInput[] = [
			validLoanInput({ principal: '-1' }),
			validLoanInput({ owed: '-1' }),
			validLoanInput({ owed: '6 000 000' }),
			validLoanInput({ payment: '-1' }),
			validLoanInput({ today: '2026-02-30' }),
			validLoanInput({ startsOn: '2026-02-30' }),
			validLoanInput({ startsOn: '2027-01-01', endsOn: '2026-12-31' }),
			validLoanInput({ startsOn: '2027-01-01', fixedUntil: '2026-12-31' }),
			validLoanInput({ fixedUntil: '2037-01-01', endsOn: '2036-08-15' }),
			validLoanInput({ startsOn: '2026-08-16' }),
			validLoanInput({
				startsOn: '2020-01-01',
				fixedUntil: '2024-01-01',
				endsOn: '2025-01-01'
			}),
			validLoanInput({
				secured: [
					{ propertyId: rowId('home-a'), sharePct: '60' },
					{ propertyId: rowId('home-b'), sharePct: '60' }
				]
			}),
			validLoanInput({
				secured: [
					{ propertyId: rowId('home-a'), sharePct: '80' },
					{ propertyId: rowId('home-b'), sharePct: null }
				]
			}),
			// `Number` read these as 16, 10 and 0.5; the property page parses the
			// stored share strictly, and share_pct is numeric(6,3), so accepting
			// them here would file debt against a share nobody chose.
			validLoanInput({ secured: [{ propertyId: rowId('home-a'), sharePct: '0x10' }] }),
			validLoanInput({ secured: [{ propertyId: rowId('home-a'), sharePct: '1e1' }] }),
			validLoanInput({ secured: [{ propertyId: rowId('home-a'), sharePct: '12.3456' }] })
		];

		for (const input of invalidInputs) {
			expect(await createLoan(input, testDb)).toMatchObject({ ok: false, status: 400 });
		}

		expect(await testDb.select().from(schema.loan)).toHaveLength(0);
		expect(await testDb.select().from(schema.loanFixationPeriod)).toHaveLength(0);
	});

	it('requires explicit shares when several secured properties have no values', async () => {
		await harness.sql.unsafe(`
			insert into property (id, name, kind, value_minor)
			values ('${rowId('home-a')}', 'Home A', 'lived', 0), ('${rowId('home-b')}', 'Home B', 'lived', 0)
		`);

		expect(
			await createLoan(
				validLoanInput({
					secured: [
						{ propertyId: rowId('home-a'), sharePct: null },
						{ propertyId: rowId('home-b'), sharePct: null }
					]
				}),
				testDb
			)
		).toMatchObject({ ok: false, status: 400 });
		expect(await testDb.select().from(schema.loan)).toHaveLength(0);
	});

	it('rejects a replacement fixation that outlasts the loan agreement', async () => {
		await seedLoan();
		await harness.sql.unsafe(
			`update loan set ends_on = '2028-12-31' where id = '${rowId('loan-a')}'`
		);

		expect(
			await replaceFixation(
				{
					loanId: rowId('loan-a'),
					startsOn: '2027-01-01',
					endsOn: '2029-01-01',
					rate: '3.5',
					payment: '2 000'
				},
				testDb
			)
		).toEqual({
			ok: false,
			status: 400,
			message: 'The fixation cannot outlast the loan.'
		});
		expect(await testDb.select().from(schema.loanFixationPeriod)).toHaveLength(0);
	});

	it('rejects repayments and fixation replacements before the loan agreement starts', async () => {
		await seedLoan();
		await harness.sql.unsafe(`update loan set owed_on = null where id = '${rowId('loan-a')}'`);
		await testDb.insert(schema.loanFixationPeriod).values({
			id: rowId('original'),
			loanId: rowId('loan-a'),
			startsOn: '2024-01-01',
			endsOn: null,
			annualRatePct: '4.5',
			paymentMinor: 20_000n
		});

		expect(
			await recordRepayment(
				{
					loanId: rowId('loan-a'),
					date: '2023-12-31',
					amount: '1 000',
					balanceAfter: '',
					note: ''
				},
				testDb
			)
		).toMatchObject({ ok: false, status: 400 });
		expect(
			await replaceFixation(
				{
					loanId: rowId('loan-a'),
					startsOn: '2023-12-31',
					endsOn: null,
					rate: '3.5',
					payment: '18 000'
				},
				testDb
			)
		).toMatchObject({ ok: false, status: 400 });

		expect(await testDb.select().from(schema.loanEvent)).toHaveLength(0);
		expect(await testDb.select().from(schema.loanFixationPeriod)).toMatchObject([
			{ id: rowId('original'), startsOn: '2024-01-01', endsOn: null }
		]);
		expect(await testDb.select().from(schema.loan)).toMatchObject([
			{ id: rowId('loan-a'), owedMinor: 800_000n, owedOn: null }
		]);
	});

	it('rolls the event back when updating a repayment balance fails', async () => {
		await seedLoan();
		await harness.sql.unsafe(`
			create function fail_loan_update() returns trigger language plpgsql as $$
			begin
				raise exception 'injected loan update failure';
			end $$;
			create trigger fail_loan_update before update on loan
			for each row execute function fail_loan_update();
		`);

		await expect(
			recordRepayment(
				{
					loanId: rowId('loan-a'),
					date: '2026-08-15',
					amount: '1 000',
					balanceAfter: '',
					note: 'Extra'
				},
				testDb
			)
		).rejects.toThrow();

		expect(await testDb.select().from(schema.loanEvent)).toHaveLength(0);
		expect((await testDb.select().from(schema.loan))[0].owedMinor).toBe(800_000n);
	});

	// A period starting later is schedule the bank has already agreed. Deleting
	// everything from the new start onward destroyed it with no warning and no
	// recovery; a blank end now runs until that period begins instead.
	it('keeps an agreed later fixation and closes the new one where it begins', async () => {
		await seedLoan();
		await testDb.insert(schema.loanFixationPeriod).values([
			{
				id: rowId('past'),
				loanId: rowId('loan-a'),
				startsOn: '2024-01-01',
				endsOn: '2027-01-01',
				annualRatePct: '4.5',
				paymentMinor: 20_000n
			},
			{
				id: rowId('future-a'),
				loanId: rowId('loan-a'),
				startsOn: '2027-01-01',
				endsOn: '2029-01-01',
				annualRatePct: '5',
				paymentMinor: 22_000n
			},
			{
				id: rowId('future-b'),
				loanId: rowId('loan-a'),
				startsOn: '2029-01-01',
				endsOn: null,
				annualRatePct: '6',
				paymentMinor: 24_000n
			}
		]);

		expect(
			await replaceFixation(
				{
					loanId: rowId('loan-a'),
					startsOn: '2026-12-01',
					endsOn: null,
					rate: '3.75',
					payment: '18 000'
				},
				testDb
			)
		).toEqual({ ok: true });

		expect(
			(await testDb.select().from(schema.loanFixationPeriod)).map((period) => ({
				id: period.id,
				startsOn: period.startsOn,
				endsOn: period.endsOn,
				paymentMinor: period.paymentMinor
			}))
		).toEqual(
			expect.arrayContaining([
				{
					id: rowId('past'),
					startsOn: '2024-01-01',
					endsOn: '2026-12-01',
					paymentMinor: 20_000n
				},
				expect.objectContaining({
					startsOn: '2026-12-01',
					endsOn: '2027-01-01',
					paymentMinor: 1_800_000n
				}),
				{
					id: rowId('future-a'),
					startsOn: '2027-01-01',
					endsOn: '2029-01-01',
					paymentMinor: 22_000n
				},
				{
					id: rowId('future-b'),
					startsOn: '2029-01-01',
					endsOn: null,
					paymentMinor: 24_000n
				}
			])
		);
		expect(await testDb.select().from(schema.loanFixationPeriod)).toHaveLength(4);
		expect(await testDb.select().from(schema.loanEvent)).toMatchObject([
			{ loanId: rowId('loan-a'), happenedOn: '2026-12-01', kind: 'refix', amountMinor: 1_800_000n }
		]);
	});

	// Silent destruction becomes a refusal the person can act on: an explicit
	// end spanning committed periods is a conflict, not permission to delete.
	it('refuses a fixation end that would overlap an already-agreed period', async () => {
		await seedLoan();
		await testDb.insert(schema.loanFixationPeriod).values([
			{
				id: rowId('past'),
				loanId: rowId('loan-a'),
				startsOn: '2024-01-01',
				endsOn: '2027-01-01',
				annualRatePct: '4.5',
				paymentMinor: 20_000n
			},
			{
				id: rowId('future-a'),
				loanId: rowId('loan-a'),
				startsOn: '2027-01-01',
				endsOn: null,
				annualRatePct: '5',
				paymentMinor: 22_000n
			}
		]);

		expect(
			await replaceFixation(
				{
					loanId: rowId('loan-a'),
					startsOn: '2026-12-01',
					endsOn: '2030-12-01',
					rate: '3.75',
					payment: '18 000'
				},
				testDb
			)
		).toMatchObject({ ok: false, status: 400 });

		expect(await testDb.select().from(schema.loanFixationPeriod)).toMatchObject([
			{ id: rowId('past'), startsOn: '2024-01-01', endsOn: '2027-01-01' },
			{ id: rowId('future-a'), startsOn: '2027-01-01', endsOn: null }
		]);
		expect(await testDb.select().from(schema.loanEvent)).toHaveLength(0);
	});

	it('rejects invalid fixation dates, rates, and payments without changing the schedule', async () => {
		await seedLoan();
		await testDb.insert(schema.loanFixationPeriod).values({
			id: rowId('current'),
			loanId: rowId('loan-a'),
			startsOn: '2024-01-01',
			endsOn: null,
			annualRatePct: '4.5',
			paymentMinor: 20_000n
		});

		expect(
			await replaceFixation(
				{
					loanId: rowId('loan-a'),
					startsOn: '2026-02-30',
					endsOn: null,
					rate: '3.75',
					payment: '18 000'
				},
				testDb
			)
		).toEqual({
			ok: false,
			status: 400,
			message: 'The new fixation needs a valid start date.'
		});
		expect(
			await replaceFixation(
				{
					loanId: rowId('loan-a'),
					startsOn: '2026-12-01',
					endsOn: null,
					rate: '101',
					payment: 'not money'
				},
				testDb
			)
		).toEqual({
			ok: false,
			status: 400,
			message: 'Rate and payment must be positive numbers.'
		});
		expect(await testDb.select().from(schema.loanFixationPeriod)).toMatchObject([
			{ id: rowId('current'), startsOn: '2024-01-01', endsOn: null }
		]);
		expect(await testDb.select().from(schema.loanEvent)).toHaveLength(0);
	});

	it('rolls fixation replacement back when its event insert fails', async () => {
		await seedLoan();
		await testDb.insert(schema.loanFixationPeriod).values([
			{
				id: rowId('current'),
				loanId: rowId('loan-a'),
				startsOn: '2024-01-01',
				endsOn: '2027-01-01',
				annualRatePct: '4.5',
				paymentMinor: 20_000n
			},
			{
				id: rowId('future'),
				loanId: rowId('loan-a'),
				startsOn: '2027-01-01',
				endsOn: null,
				annualRatePct: '5',
				paymentMinor: 22_000n
			}
		]);
		await harness.sql.unsafe(`
			create function fail_refix_event() returns trigger language plpgsql as $$
			begin
				if new.kind = 'refix' then raise exception 'injected refix event failure'; end if;
				return new;
			end $$;
			create trigger fail_refix_event before insert on loan_event
			for each row execute function fail_refix_event();
		`);

		await expect(
			replaceFixation(
				{
					loanId: rowId('loan-a'),
					startsOn: '2026-12-01',
					endsOn: null,
					rate: '3.75',
					payment: '18 000'
				},
				testDb
			)
		).rejects.toThrow();

		expect(await testDb.select().from(schema.loanFixationPeriod)).toMatchObject([
			{ id: rowId('current'), startsOn: '2024-01-01', endsOn: '2027-01-01' },
			{ id: rowId('future'), startsOn: '2027-01-01', endsOn: null }
		]);
		expect(await testDb.select().from(schema.loanEvent)).toHaveLength(0);
	});

	it('rolls loan and secured links back when the initial fixation fails', async () => {
		await harness.sql.unsafe(
			`insert into property (id, name, kind) values ('${rowId('home')}', 'Home', 'lived')`
		);
		await harness.sql.unsafe(`
			create function fail_initial_fixation() returns trigger language plpgsql as $$
			begin
				raise exception 'injected initial fixation failure';
			end $$;
			create trigger fail_initial_fixation before insert on loan_fixation_period
			for each row execute function fail_initial_fixation();
		`);

		await expect(
			createLoan(
				{
					name: 'New mortgage',
					lender: 'Bank',
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
					endsOn: null,
					interestDeductible: true,
					secured: [{ propertyId: rowId('home'), sharePct: '100' }],
					today: '2026-08-15'
				},
				testDb
			)
		).rejects.toThrow();

		expect(await testDb.select().from(schema.loan)).toHaveLength(0);
		expect(await testDb.select().from(schema.loanProperty)).toHaveLength(0);
		expect(await testDb.select().from(schema.loanFixationPeriod)).toHaveLength(0);
	});
});
