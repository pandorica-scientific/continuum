// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Closing an account and deleting one are different acts with different
 * consequences, and the difference is the whole of this file:
 * `transaction.account_id` cascades, so a delete that slipped past its guard
 * would take a statement's worth of history with it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, isNull } from 'drizzle-orm';
import { rowId } from '../row-id';
import { account, transaction } from '$lib/server/db/schema';
import { archiveAccount, deleteAccount, unarchiveAccount } from '$lib/server/accounts';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeAccount, makeTransaction } from './fixtures';

let harness: Harness;
let testDb: TestDb;
const USED = rowId('acct-used');
const EMPTY = rowId('acct-empty');

beforeAll(async () => {
	harness = await startPostgres('account-lifecycle', { max: 1 });
	testDb = harness.db;
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 180_000);

afterAll(async () => {
	await harness?.stop();
});

beforeEach(async () => {
	await harness.sql`truncate account cascade`;
	await makeAccount(testDb, { id: USED, name: 'Old current', bank: 'fio', currency: 'CZK' });
	await makeAccount(testDb, { id: EMPTY, name: 'Typo', bank: 'fio', currency: 'CZK' });
	await makeTransaction(testDb, {
		id: rowId('acct-txn'),
		accountId: USED,
		bookedOn: '2026-05-05',
		amountMinor: -12_300n,
		currency: 'CZK',
		dedupFingerprint: 'acct-txn'
	});
});

describe('closing an account', () => {
	it('keeps every transaction it ever carried', async () => {
		expect((await archiveAccount(USED, testDb)).ok).toBe(true);

		const [row] = await testDb.select().from(account).where(eq(account.id, USED));
		expect(row.archivedAt).toBeInstanceOf(Date);
		// The point of archiving rather than deleting.
		const held = await testDb.select().from(transaction).where(eq(transaction.accountId, USED));
		expect(held).toHaveLength(1);
	});

	it('leaves it out of net worth, which is what "closed" means to the figures', async () => {
		const counted = async () =>
			(
				await harness.sql<{ n: number }[]>`
					select count(*)::int as n from net_worth_component where kind = 'account'`
			)[0].n;

		expect(await counted()).toBe(2);
		await archiveAccount(USED, testDb);
		expect(await counted()).toBe(1);
	});

	it('is reversible, and the history never went anywhere', async () => {
		await archiveAccount(USED, testDb);
		expect((await unarchiveAccount(USED, testDb)).ok).toBe(true);

		const open = await testDb.select().from(account).where(isNull(account.archivedAt));
		expect(open).toHaveLength(2);
	});

	it('refuses to close one that is closed already', async () => {
		await archiveAccount(USED, testDb);
		expect(await archiveAccount(USED, testDb)).toMatchObject({ ok: false, status: 409 });
	});
});

describe('deleting an account', () => {
	it('removes one that never held anything', async () => {
		expect((await deleteAccount(EMPTY, testDb)).ok).toBe(true);
		expect(await testDb.select().from(account)).toHaveLength(1);
	});

	it('REFUSES one that holds transactions, and says to close it instead', async () => {
		// The guard that stops a tidy-up from deleting history through the
		// cascade. Without it this call removes the account AND its row.
		const result = await deleteAccount(USED, testDb);
		expect(result).toMatchObject({ ok: false, status: 409 });
		expect(result.ok === false && result.message).toContain('Close it instead');

		expect(await testDb.select().from(account).where(eq(account.id, USED))).toHaveLength(1);
		expect(
			await testDb.select().from(transaction).where(eq(transaction.accountId, USED))
		).toHaveLength(1);
	});

	it('refuses an account that is not there', async () => {
		expect(await deleteAccount(rowId('acct-ghost'), testDb)).toMatchObject({
			ok: false,
			status: 404
		});
	});
});
