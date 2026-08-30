// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { rowId } from '../row-id';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeAccount, makeTransaction } from './fixtures';
import { latestMonthWithData } from '$lib/server/cashflow';

let harness: Harness;
let testDb: TestDb;
const ACCOUNT = rowId('account-a');

async function addTransaction(fields: {
	bookedOn: string;
	valueOn?: string | null;
	transferPairId?: string | null;
}): Promise<void> {
	const key = `txn-${fields.bookedOn}-${fields.valueOn ?? 'none'}`;
	await makeTransaction(testDb, {
		id: rowId(key),
		accountId: ACCOUNT,
		bookedOn: fields.bookedOn,
		valueOn: fields.valueOn ?? null,
		amountMinor: -1000n,
		currency: 'CZK',
		// Not-null, and unique per account. Nothing here exercises deduplication,
		// so the row's own key is as good a fingerprint as any.
		dedupFingerprint: key,
		transferPairId: fields.transferPairId ?? null
	});
}

beforeAll(async () => {
	harness = await startPostgres('latest-month');
	testDb = harness.db;
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 120_000);

afterAll(async () => {
	await harness?.stop();
});

beforeEach(async () => {
	await harness.sql`truncate account cascade`;
	await makeAccount(testDb, {
		id: ACCOUNT,
		name: 'Current',
		bank: 'fio',
		kind: 'current',
		currency: 'CZK'
	});
});

describe('latestMonthWithData', () => {
	it('returns null when there are no transactions', async () => {
		expect(await latestMonthWithData(testDb)).toBeNull();
	});

	it('returns the newest month by booked date', async () => {
		await addTransaction({ bookedOn: '2026-05-14' });
		await addTransaction({ bookedOn: '2026-07-03' });
		expect(await latestMonthWithData(testDb)).toBe('2026-07');
	});

	it('prefers the value date over the booked date', async () => {
		// A card payment started in June and booked in July belongs to June,
		// which is the rule monthlyHistory and flowData already apply.
		await addTransaction({ bookedOn: '2026-07-02', valueOn: '2026-06-29' });
		expect(await latestMonthWithData(testDb)).toBe('2026-06');
	});

	it('ignores transfer legs', async () => {
		await addTransaction({ bookedOn: '2026-05-14' });
		await addTransaction({ bookedOn: '2026-07-03', transferPairId: rowId('pair-a') });
		// July holds nothing but a transfer between the household's own accounts,
		// so selecting it would show the empty chart this change exists to fix.
		expect(await latestMonthWithData(testDb)).toBe('2026-05');
	});
});
