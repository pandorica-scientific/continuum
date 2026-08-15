import { resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '$lib/server/db/schema';
import { removeStalePostgresDirectory } from './embedded-postgres';
import {
	createLoan,
	recordRepayment,
	replaceFixation,
	type CreateLoanInput
} from '$lib/server/loans/mutations';

const PORT = 55444;
const DATABASE = 'continuum_loan_mutations';
const DATABASE_DIR = resolve('scratch-workspace/loan-mutations-postgres');
const URL = `postgres://postgres:password@127.0.0.1:${PORT}/${DATABASE}`;

let embedded: EmbeddedPostgres;
let sqlClient: postgres.Sql;
let testDb: ReturnType<typeof drizzle<typeof schema>>;

async function seedLoan(id = 'loan-a'): Promise<void> {
	await testDb.insert(schema.loan).values({
		id,
		name: 'Mortgage',
		lender: 'Bank',
		kind: 'mortgage',
		currency: 'CZK',
		principalMinor: 1_000_000n,
		owedMinor: 800_000n,
		owedAsOf: '2026-08-01',
		startDate: '2024-01-01',
		endDate: null,
		regime: 'fixed_period',
		dayCount: '30/360',
		accrualStyle: 'payment',
		paymentDay: 15,
		interestDeductible: 1
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
		startDate: '2026-08-15',
		endDate: '2036-08-15',
		interestDeductible: true,
		secured: [],
		today: '2026-08-15',
		...overrides
	};
}

beforeAll(async () => {
	removeStalePostgresDirectory(DATABASE_DIR);
	embedded = new EmbeddedPostgres({
		databaseDir: DATABASE_DIR,
		port: PORT,
		user: 'postgres',
		password: 'password',
		persistent: false,
		onLog: () => undefined,
		onError: () => undefined
	});
	await embedded.initialise();
	await embedded.start();
	await embedded.createDatabase(DATABASE);

	sqlClient = postgres(URL, { max: 5, onnotice: () => undefined });
	testDb = drizzle(sqlClient, { schema });
	await sqlClient.unsafe(`
		create table property (
			id text primary key,
			name text not null,
			value_minor bigint not null default 0
		);
		create table loan (
			id text primary key,
			name text not null,
			lender text not null default '',
			kind text not null default 'mortgage',
			currency text not null default 'CZK',
			principal_minor bigint not null,
			owed_minor bigint not null,
			owed_as_of date,
			owner_person_id text,
			start_date date,
			end_date date,
			regime text not null default 'fixed_period',
			day_count text not null default '30/360',
			accrual_style text not null default 'payment',
			payment_day integer,
			interest_deductible integer not null default 0,
			created_at timestamptz not null default now()
		);
		create table loan_property (
			id text primary key,
			loan_id text not null references loan(id) on delete cascade,
			property_id text not null references property(id) on delete cascade,
			share_pct numeric(6, 3),
			unique (loan_id, property_id)
		);
		create table loan_fixation_period (
			id text primary key,
			loan_id text not null references loan(id) on delete cascade,
			start_date date not null,
			end_date date,
			annual_rate_pct numeric(6, 3) not null,
			payment_minor bigint not null,
			unique (loan_id, start_date)
		);
		create table loan_event (
			id text primary key,
			loan_id text not null references loan(id) on delete cascade,
			happened_on date not null,
			kind text not null,
			amount_minor bigint not null,
			interest_minor bigint,
			note text,
			transaction_id text
		);
	`);
}, 30_000);

beforeEach(async () => {
	await sqlClient.unsafe(`
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
	await sqlClient?.end();
	await embedded?.stop();
}, 30_000);

describe('loan mutation transactions', () => {
	it('rejects invalid and backdated repayments without moving the balance anchor', async () => {
		await seedLoan();

		expect(
			await recordRepayment(
				{
					loanId: 'loan-a',
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
					loanId: 'loan-a',
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
					loanId: 'loan-a',
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
			{ id: 'loan-a', owedMinor: 800_000n, owedAsOf: '2026-08-01' }
		]);
	});

	it('rejects overpayments and balance-after values that increase the debt', async () => {
		await seedLoan();

		for (const input of [
			{
				loanId: 'loan-a',
				date: '2026-08-15',
				amount: '9 000',
				balanceAfter: '',
				note: ''
			},
			{
				loanId: 'loan-a',
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
			{ id: 'loan-a', owedMinor: 800_000n, owedAsOf: '2026-08-01' }
		]);
	});

	it('rejects impossible loan amounts and chronology before inserting anything', async () => {
		const invalidInputs: CreateLoanInput[] = [
			validLoanInput({ principal: '-1' }),
			validLoanInput({ owed: '-1' }),
			validLoanInput({ owed: '6 000 000' }),
			validLoanInput({ payment: '-1' }),
			validLoanInput({ today: '2026-02-30' }),
			validLoanInput({ startDate: '2026-02-30' }),
			validLoanInput({ startDate: '2027-01-01', endDate: '2026-12-31' }),
			validLoanInput({ startDate: '2027-01-01', fixedUntil: '2026-12-31' }),
			validLoanInput({ fixedUntil: '2037-01-01', endDate: '2036-08-15' }),
			validLoanInput({ startDate: '2026-08-16' }),
			validLoanInput({
				startDate: '2020-01-01',
				fixedUntil: '2024-01-01',
				endDate: '2025-01-01'
			}),
			validLoanInput({
				secured: [
					{ propertyId: 'home-a', sharePct: '60' },
					{ propertyId: 'home-b', sharePct: '60' }
				]
			}),
			validLoanInput({
				secured: [
					{ propertyId: 'home-a', sharePct: '80' },
					{ propertyId: 'home-b', sharePct: null }
				]
			}),
			// `Number` read these as 16, 10 and 0.5; the property page parses the
			// stored share strictly, and share_pct is numeric(6,3), so accepting
			// them here would file debt against a share nobody chose.
			validLoanInput({ secured: [{ propertyId: 'home-a', sharePct: '0x10' }] }),
			validLoanInput({ secured: [{ propertyId: 'home-a', sharePct: '1e1' }] }),
			validLoanInput({ secured: [{ propertyId: 'home-a', sharePct: '12.3456' }] })
		];

		for (const input of invalidInputs) {
			expect(await createLoan(input, testDb)).toMatchObject({ ok: false, status: 400 });
		}

		expect(await testDb.select().from(schema.loan)).toHaveLength(0);
		expect(await testDb.select().from(schema.loanFixationPeriod)).toHaveLength(0);
	});

	it('requires explicit shares when several secured properties have no values', async () => {
		await sqlClient.unsafe(`
			insert into property (id, name, value_minor)
			values ('home-a', 'Home A', 0), ('home-b', 'Home B', 0)
		`);

		expect(
			await createLoan(
				validLoanInput({
					secured: [
						{ propertyId: 'home-a', sharePct: null },
						{ propertyId: 'home-b', sharePct: null }
					]
				}),
				testDb
			)
		).toMatchObject({ ok: false, status: 400 });
		expect(await testDb.select().from(schema.loan)).toHaveLength(0);
	});

	it('rejects a replacement fixation that outlasts the loan agreement', async () => {
		await seedLoan();
		await sqlClient.unsafe(`update loan set end_date = '2028-12-31' where id = 'loan-a'`);

		expect(
			await replaceFixation(
				{
					loanId: 'loan-a',
					startDate: '2027-01-01',
					endDate: '2029-01-01',
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
		await sqlClient.unsafe(`update loan set owed_as_of = null where id = 'loan-a'`);
		await testDb.insert(schema.loanFixationPeriod).values({
			id: 'original',
			loanId: 'loan-a',
			startDate: '2024-01-01',
			endDate: null,
			annualRatePct: '4.5',
			paymentMinor: 20_000n
		});

		expect(
			await recordRepayment(
				{
					loanId: 'loan-a',
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
					loanId: 'loan-a',
					startDate: '2023-12-31',
					endDate: null,
					rate: '3.5',
					payment: '18 000'
				},
				testDb
			)
		).toMatchObject({ ok: false, status: 400 });

		expect(await testDb.select().from(schema.loanEvent)).toHaveLength(0);
		expect(await testDb.select().from(schema.loanFixationPeriod)).toMatchObject([
			{ id: 'original', startDate: '2024-01-01', endDate: null }
		]);
		expect(await testDb.select().from(schema.loan)).toMatchObject([
			{ id: 'loan-a', owedMinor: 800_000n, owedAsOf: null }
		]);
	});

	it('rolls the event back when updating a repayment balance fails', async () => {
		await seedLoan();
		await sqlClient.unsafe(`
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
					loanId: 'loan-a',
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
				id: 'past',
				loanId: 'loan-a',
				startDate: '2024-01-01',
				endDate: '2027-01-01',
				annualRatePct: '4.5',
				paymentMinor: 20_000n
			},
			{
				id: 'future-a',
				loanId: 'loan-a',
				startDate: '2027-01-01',
				endDate: '2029-01-01',
				annualRatePct: '5',
				paymentMinor: 22_000n
			},
			{
				id: 'future-b',
				loanId: 'loan-a',
				startDate: '2029-01-01',
				endDate: null,
				annualRatePct: '6',
				paymentMinor: 24_000n
			}
		]);

		expect(
			await replaceFixation(
				{
					loanId: 'loan-a',
					startDate: '2026-12-01',
					endDate: null,
					rate: '3.75',
					payment: '18 000'
				},
				testDb
			)
		).toEqual({ ok: true });

		expect(
			(await testDb.select().from(schema.loanFixationPeriod)).map((period) => ({
				id: period.id,
				startDate: period.startDate,
				endDate: period.endDate,
				paymentMinor: period.paymentMinor
			}))
		).toEqual(
			expect.arrayContaining([
				{
					id: 'past',
					startDate: '2024-01-01',
					endDate: '2026-12-01',
					paymentMinor: 20_000n
				},
				expect.objectContaining({
					startDate: '2026-12-01',
					endDate: '2027-01-01',
					paymentMinor: 1_800_000n
				}),
				{
					id: 'future-a',
					startDate: '2027-01-01',
					endDate: '2029-01-01',
					paymentMinor: 22_000n
				},
				{
					id: 'future-b',
					startDate: '2029-01-01',
					endDate: null,
					paymentMinor: 24_000n
				}
			])
		);
		expect(await testDb.select().from(schema.loanFixationPeriod)).toHaveLength(4);
		expect(await testDb.select().from(schema.loanEvent)).toMatchObject([
			{ loanId: 'loan-a', happenedOn: '2026-12-01', kind: 'refix', amountMinor: 1_800_000n }
		]);
	});

	// Silent destruction becomes a refusal the person can act on: an explicit
	// end spanning committed periods is a conflict, not permission to delete.
	it('refuses a fixation end that would overlap an already-agreed period', async () => {
		await seedLoan();
		await testDb.insert(schema.loanFixationPeriod).values([
			{
				id: 'past',
				loanId: 'loan-a',
				startDate: '2024-01-01',
				endDate: '2027-01-01',
				annualRatePct: '4.5',
				paymentMinor: 20_000n
			},
			{
				id: 'future-a',
				loanId: 'loan-a',
				startDate: '2027-01-01',
				endDate: null,
				annualRatePct: '5',
				paymentMinor: 22_000n
			}
		]);

		expect(
			await replaceFixation(
				{
					loanId: 'loan-a',
					startDate: '2026-12-01',
					endDate: '2030-12-01',
					rate: '3.75',
					payment: '18 000'
				},
				testDb
			)
		).toMatchObject({ ok: false, status: 400 });

		expect(await testDb.select().from(schema.loanFixationPeriod)).toMatchObject([
			{ id: 'past', startDate: '2024-01-01', endDate: '2027-01-01' },
			{ id: 'future-a', startDate: '2027-01-01', endDate: null }
		]);
		expect(await testDb.select().from(schema.loanEvent)).toHaveLength(0);
	});

	it('rejects invalid fixation dates, rates, and payments without changing the schedule', async () => {
		await seedLoan();
		await testDb.insert(schema.loanFixationPeriod).values({
			id: 'current',
			loanId: 'loan-a',
			startDate: '2024-01-01',
			endDate: null,
			annualRatePct: '4.5',
			paymentMinor: 20_000n
		});

		expect(
			await replaceFixation(
				{
					loanId: 'loan-a',
					startDate: '2026-02-30',
					endDate: null,
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
					loanId: 'loan-a',
					startDate: '2026-12-01',
					endDate: null,
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
			{ id: 'current', startDate: '2024-01-01', endDate: null }
		]);
		expect(await testDb.select().from(schema.loanEvent)).toHaveLength(0);
	});

	it('rolls fixation replacement back when its event insert fails', async () => {
		await seedLoan();
		await testDb.insert(schema.loanFixationPeriod).values([
			{
				id: 'current',
				loanId: 'loan-a',
				startDate: '2024-01-01',
				endDate: '2027-01-01',
				annualRatePct: '4.5',
				paymentMinor: 20_000n
			},
			{
				id: 'future',
				loanId: 'loan-a',
				startDate: '2027-01-01',
				endDate: null,
				annualRatePct: '5',
				paymentMinor: 22_000n
			}
		]);
		await sqlClient.unsafe(`
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
					loanId: 'loan-a',
					startDate: '2026-12-01',
					endDate: null,
					rate: '3.75',
					payment: '18 000'
				},
				testDb
			)
		).rejects.toThrow();

		expect(await testDb.select().from(schema.loanFixationPeriod)).toMatchObject([
			{ id: 'current', startDate: '2024-01-01', endDate: '2027-01-01' },
			{ id: 'future', startDate: '2027-01-01', endDate: null }
		]);
		expect(await testDb.select().from(schema.loanEvent)).toHaveLength(0);
	});

	it('rolls loan and secured links back when the initial fixation fails', async () => {
		await sqlClient.unsafe(`insert into property (id, name) values ('home', 'Home')`);
		await sqlClient.unsafe(`
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
					startDate: '2026-08-15',
					endDate: null,
					interestDeductible: true,
					secured: [{ propertyId: 'home', sharePct: '100' }],
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
