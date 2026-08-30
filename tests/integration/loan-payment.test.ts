// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loan, loanEvent, loanFixationPeriod } from '$lib/server/db/schema';
import { recordLinkedPayment, unlinkLoanPayment } from '$lib/server/loans/mutations';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeAccount, makeLoan, makeTransaction } from './fixtures';
import { rowId } from '../row-id';

/**
 * T9b: the write that makes a loan payment's two halves reachable.
 *
 * `loan_event.transaction_id` is what the split reads, and nothing ever wrote
 * it — the split was code that could not fire on a real ledger. What the record
 * has to hold for it to fire honestly is what these cases assert: one event
 * carrying the transaction's own figures and its link, one claim per
 * transaction, money that arrived is never a payment out, and the interest
 * decided once here rather than worked out again by every reader.
 */

let harness: Harness;
let testDb: TestDb;

const ACCOUNT = rowId('loan-payment-account');
/** A second account, so a debit in another currency is a real row and not a
 *  CZK account holding a EUR movement. */
const ACCOUNT_EUR = rowId('loan-payment-account-eur');
const LOAN = rowId('loan-payment-loan');
const DEBIT = rowId('loan-payment-debit');
const CREDIT = rowId('loan-payment-credit');
const FOREIGN = rowId('loan-payment-foreign');

/** What the loan owes before anything is recorded, to compare against after. */
const OWED_MINOR = 927_000_000n;

beforeAll(async () => {
	harness = await startPostgres('loan-payment');
	testDb = harness.db;
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 180_000);

afterAll(async () => {
	await harness?.stop();
});

beforeEach(async () => {
	// `loan` is separate because the cascade from `account` reaches loan_event
	// through the transactions it links, but never the loan itself.
	await harness.sql`truncate account, loan cascade`;
	await makeAccount(testDb, {
		id: ACCOUNT,
		name: 'Current',
		bank: 'fio',
		kind: 'current',
		currency: 'CZK'
	});
	await makeAccount(testDb, {
		id: ACCOUNT_EUR,
		name: 'Revolut',
		bank: 'revolut',
		kind: 'current',
		currency: 'EUR'
	});
	await makeLoan(testDb, {
		id: LOAN,
		name: 'Mortgage ČS',
		lender: 'Česká spořitelna',
		kind: 'mortgage',
		currency: 'CZK',
		principalMinor: 990_000_000n,
		owedMinor: OWED_MINOR,
		owedOn: '2026-08-01',
		startsOn: '2026-02-11',
		regime: 'fixed_period',
		dayCount: 'act/360',
		accrualStyle: 'calendar',
		paymentDay: 18,
		interestDeductible: true
	});
	await makeTransaction(testDb, {
		id: DEBIT,
		accountId: ACCOUNT,
		// The value date differs from the booked one on purpose: the event has
		// to happen on the day the money moved, which is the date every other
		// money screen reads.
		bookedOn: '2026-08-05',
		valueOn: '2026-08-06',
		amountMinor: -5_445_600n,
		feeMinor: 4_000n,
		currency: 'CZK',
		counterparty: 'Česká spořitelna · hypotéka',
		dedupFingerprint: 'loan-payment-debit'
	});
	await makeTransaction(testDb, {
		id: CREDIT,
		accountId: ACCOUNT,
		bookedOn: '2026-08-02',
		amountMinor: 1_650_000n,
		currency: 'CZK',
		counterparty: 'Nájemce · Karlín',
		dedupFingerprint: 'loan-payment-credit'
	});
	await makeTransaction(testDb, {
		id: FOREIGN,
		accountId: ACCOUNT_EUR,
		bookedOn: '2026-08-05',
		amountMinor: -20_000n,
		currency: 'EUR',
		counterparty: 'Česká spořitelna · hypotéka',
		dedupFingerprint: 'loan-payment-foreign'
	});
});

describe('recordLinkedPayment', () => {
	it('records the debit as a payment carrying its amount, date and link', async () => {
		expect(
			await recordLinkedPayment(
				{ loanId: LOAN, transactionId: DEBIT, interest: '3 544.34' },
				testDb
			)
		).toEqual({ ok: true });

		const events = await testDb.select().from(loanEvent);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			loanId: LOAN,
			kind: 'payment',
			// The value date, and the amount net of the bank's own fee as a
			// magnitude — the same arithmetic every other consumer of a transaction
			// applies to it.
			happenedOn: '2026-08-06',
			amountMinor: 5_449_600n,
			interestMinor: 354_434n,
			transactionId: DEBIT
		});

		// A scheduled instalment is what the amortisation already assumes, so
		// recording one must not subtract it from the balance a second time.
		const [after] = await testDb.select().from(loan);
		expect(after.owedMinor).toBe(OWED_MINOR);
		expect(after.owedOn).toBe('2026-08-01');
	});

	it('refuses a second recording of the same transaction', async () => {
		expect(await recordLinkedPayment({ loanId: LOAN, transactionId: DEBIT }, testDb)).toEqual({
			ok: true
		});

		expect(await recordLinkedPayment({ loanId: LOAN, transactionId: DEBIT }, testDb)).toEqual({
			ok: false,
			status: 409,
			message: 'This transaction is already recorded as a loan payment.'
		});
		expect(await testDb.select().from(loanEvent)).toHaveLength(1);
	});

	it('refuses money that arrived', async () => {
		expect(await recordLinkedPayment({ loanId: LOAN, transactionId: CREDIT }, testDb)).toEqual({
			ok: false,
			status: 400,
			message: 'Only money leaving an account can be a loan payment.'
		});
		expect(await testDb.select().from(loanEvent)).toHaveLength(0);
	});

	// Recording is otherwise a one-way door: the duplicate guard refuses a second
	// attempt, and a stated interest beats every derivation the split would make.
	it('lets an unlinked transaction be recorded again', async () => {
		await recordLinkedPayment({ loanId: LOAN, transactionId: DEBIT }, testDb);

		expect(await unlinkLoanPayment(DEBIT, testDb)).toEqual({ ok: true });
		expect(await testDb.select().from(loanEvent)).toHaveLength(0);

		expect(await recordLinkedPayment({ loanId: LOAN, transactionId: DEBIT }, testDb)).toEqual({
			ok: true
		});
		expect(await testDb.select().from(loanEvent)).toHaveLength(1);
	});

	// The split is decided here, once, rather than on every render: the register
	// expresses the same two lines in SQL and cannot run an amortisation schedule
	// per row, so both screens read one stored figure or neither splits at all.
	it('works the interest out when nobody states one, and stores nothing when nothing can be said', async () => {
		// Nothing on record says what this loan charges, so there is no honest
		// answer — inventing a rate would invent a cost.
		expect(await recordLinkedPayment({ loanId: LOAN, transactionId: DEBIT }, testDb)).toEqual({
			ok: true
		});
		const [unrated] = await testDb.select().from(loanEvent);
		expect(unrated.interestMinor).toBeNull();

		await unlinkLoanPayment(DEBIT, testDb);
		await testDb.insert(loanFixationPeriod).values({
			id: rowId('loan-payment-fixation'),
			loanId: LOAN,
			startsOn: '2026-02-11',
			endsOn: '2029-02-11',
			annualRatePct: '3.000',
			paymentMinor: 5_445_600n
		});

		expect(await recordLinkedPayment({ loanId: LOAN, transactionId: DEBIT }, testDb)).toEqual({
			ok: true
		});
		const [derived] = await testDb.select().from(loanEvent);
		// August's charge on 9 270 000 at 3% under act/360, which is what the
		// loan's own schedule books against the month this debit was paid in.
		expect(derived.interestMinor).toBe(2_394_750n);
		expect(derived.amountMinor).toBe(5_449_600n);
	});

	// Converting would mean picking a rate on a day nobody asked about, and every
	// figure downstream is a ratio taken between these two amounts.
	it('refuses a debit in a currency the loan is not in', async () => {
		expect(await recordLinkedPayment({ loanId: LOAN, transactionId: FOREIGN }, testDb)).toEqual({
			ok: false,
			status: 400,
			message: 'This debit is in EUR; Mortgage ČS is in CZK.'
		});
		expect(await testDb.select().from(loanEvent)).toHaveLength(0);
	});
});
