// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { rowId } from '../row-id';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '$lib/server/db/schema';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeAccount, makeTransaction } from './fixtures';
import { clearOneSidedTransfer, markOneSidedTransfer } from '$lib/server/import/transfer-decisions';
import { notOwnTransfer } from '$lib/server/transactions/transfers';
import { pairAndCategorise } from '$lib/server/import/ingest';

let harness: Harness;
let testDb: TestDb;
const CURRENT = rowId('account-current');
const SAVINGS = rowId('account-savings');
const MOVE = rowId('txn-move');

beforeAll(async () => {
	harness = await startPostgres('one-sided-transfer');
	testDb = harness.db;
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 120_000);

afterAll(async () => {
	await harness?.stop();
});

beforeEach(async () => {
	await harness.sql`truncate account cascade`;
	await makeAccount(testDb, {
		id: CURRENT,
		name: 'Current',
		bank: 'fio',
		kind: 'current',
		currency: 'CZK'
	});
	await makeAccount(testDb, {
		id: SAVINGS,
		name: 'Savings',
		bank: 'fio',
		kind: 'savings',
		currency: 'CZK'
	});
	await makeTransaction(testDb, {
		id: MOVE,
		accountId: CURRENT,
		bookedOn: '2026-07-15',
		amountMinor: -1_000_000n,
		currency: 'CZK',
		dedupFingerprint: 'move-to-savings',
		categoryId: null,
		reviewState: 'needs_review'
	});
});

describe('markOneSidedTransfer', () => {
	it('takes the row out of spending without a matching leg', async () => {
		const result = await markOneSidedTransfer(MOVE, SAVINGS, testDb);
		expect(result.ok).toBe(true);

		const [row] = await testDb.select().from(schema.transaction);
		expect(row.transferToAccountId).toBe(SAVINGS);
		expect(row.reviewState).toBe('confirmed');
		// A transfer is not spending, so it carries no category — the same shape a
		// matched pair takes.
		expect(row.categoryId).toBeNull();
	});

	it('is excluded by the one predicate every total uses', async () => {
		await markOneSidedTransfer(MOVE, SAVINGS, testDb);
		const counted = await testDb.select().from(schema.transaction).where(notOwnTransfer());
		// If this ever fails, some total somewhere is counting a transfer as money
		// spent. The predicate is shared precisely so there is one place to fix.
		expect(counted).toHaveLength(0);
	});

	it('refuses a transfer to the account the money left', async () => {
		const result = await markOneSidedTransfer(MOVE, CURRENT, testDb);
		expect(result).toEqual({
			ok: false,
			status: 400,
			message: 'A transfer needs a different account.'
		});
	});

	it('refuses an account that does not exist', async () => {
		const result = await markOneSidedTransfer(MOVE, rowId('nope'), testDb);
		expect(result.ok).toBe(false);
	});

	it('refuses a row that already has a matching leg', async () => {
		// Two statements agreeing is stronger evidence than one person's claim.
		const other = rowId('txn-other');
		await makeTransaction(testDb, {
			id: other,
			accountId: SAVINGS,
			bookedOn: '2026-07-15',
			amountMinor: 1_000_000n,
			currency: 'CZK',
			dedupFingerprint: 'move-in'
		});
		const pair = rowId('pair-1');
		await testDb.insert(schema.transferPair).values({
			id: pair,
			outTransactionId: MOVE,
			inTransactionId: other,
			state: 'confirmed'
		});
		await testDb
			.update(schema.transaction)
			.set({ transferPairId: pair })
			.where(eq(schema.transaction.id, MOVE));

		const result = await markOneSidedTransfer(MOVE, SAVINGS, testDb);
		expect(result).toEqual({
			ok: false,
			status: 409,
			message: 'This row is already a matched transfer.'
		});
	});
});

describe('a later import', () => {
	it('leaves a row that was already decided as a one-sided transfer alone', async () => {
		await markOneSidedTransfer(MOVE, SAVINGS, testDb);

		// The sweep that re-categorises undecided rows looks for "no category and
		// no pair", which is exactly the shape a one-sided transfer has: the
		// category is cleared because a transfer is not spending, and there is no
		// pair because there is no second leg. Without the shared predicate it
		// would take the decision back on the next import.
		await pairAndCategorise(testDb);

		const [row] = await testDb.select().from(schema.transaction);
		expect(row.transferToAccountId).toBe(SAVINGS);
		expect(row.reviewState).toBe('confirmed');
		expect(row.categoryId).toBeNull();
	});
});

describe('clearOneSidedTransfer', () => {
	it('puts the row back in the queue needing a category', async () => {
		await markOneSidedTransfer(MOVE, SAVINGS, testDb);
		expect((await clearOneSidedTransfer(MOVE, testDb)).ok).toBe(true);

		const [row] = await testDb.select().from(schema.transaction);
		expect(row.transferToAccountId).toBeNull();
		expect(row.reviewState).toBe('needs_review');

		const counted = await testDb.select().from(schema.transaction).where(notOwnTransfer());
		expect(counted).toHaveLength(1);
	});

	it('refuses a row that was never marked', async () => {
		expect((await clearOneSidedTransfer(MOVE, testDb)).ok).toBe(false);
	});
});
