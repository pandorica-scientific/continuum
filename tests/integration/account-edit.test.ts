// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { rowId } from '../row-id';
import { account, bank, person, transaction } from '$lib/server/db/schema';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { parseAccountNumbers, updateAccount } from '$lib/server/accounts';

let harness: Harness;
let testDb: TestDb;
const ACCOUNT = rowId('account-1');
const ROBERT = rowId('person-robert');

beforeAll(async () => {
	harness = await startPostgres('account-edit');
	testDb = harness.db;
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 120_000);

afterAll(async () => {
	await harness?.stop();
});

beforeEach(async () => {
	await harness.sql`delete from transaction`;
	await harness.sql`delete from account`;
	await harness.sql`delete from person`;
	await testDb
		.insert(bank)
		.values({ key: 'fio', label: 'Fio banka', emoji: '🏦' })
		.onConflictDoNothing();
	await testDb.insert(person).values({ id: ROBERT, name: 'Robert', initials: 'R', role: 'admin' });
	await testDb.insert(account).values({
		id: ACCOUNT,
		name: 'Currnet',
		bank: 'fio',
		kind: 'current',
		currency: 'CZK',
		numbers: ['2101106516/2010']
	});
});

const edit = (over: Partial<Parameters<typeof updateAccount>[1]> = {}) =>
	updateAccount(
		ACCOUNT,
		{
			name: 'Current',
			emoji: '',
			bank: 'fio',
			kind: 'current',
			ownerPersonId: null,
			numbers: ['2101106516/2010'],
			currency: null,
			...over
		},
		testDb
	);

const spend = () =>
	testDb.insert(transaction).values({
		id: uuidv7(),
		accountId: ACCOUNT,
		bookedOn: '2026-07-01',
		amountMinor: -1000n,
		currency: 'CZK',
		dedupFingerprint: `f-${uuidv7()}`
	});

describe('correcting an account', () => {
	it('fixes a mistyped name', async () => {
		expect(await edit()).toEqual({ ok: true });
		const [row] = await testDb.select().from(account).where(eq(account.id, ACCOUNT));
		expect(row.name).toBe('Current');
	});

	it('gives it an owner, and can give it back to the household', async () => {
		expect(await edit({ ownerPersonId: ROBERT })).toEqual({ ok: true });
		let [row] = await testDb.select().from(account).where(eq(account.id, ACCOUNT));
		expect(row.ownerPersonId).toBe(ROBERT);

		// Joint is a real answer, so it has to be reachable again.
		expect(await edit({ ownerPersonId: null })).toEqual({ ok: true });
		[row] = await testDb.select().from(account).where(eq(account.id, ACCOUNT));
		expect(row.ownerPersonId).toBeNull();
	});

	it('corrects the numbers a statement is matched against', async () => {
		expect(await edit({ numbers: ['111/2010', '222/2010'] })).toEqual({ ok: true });
		const [row] = await testDb.select().from(account).where(eq(account.id, ACCOUNT));
		expect(row.numbers).toEqual(['111/2010', '222/2010']);
	});

	it('refuses a nameless account and an unknown bank or person', async () => {
		expect(await edit({ name: '  ' })).toMatchObject({ ok: false, status: 400 });
		expect(await edit({ bank: 'not-a-bank' })).toMatchObject({ ok: false, status: 400 });
		expect(await edit({ ownerPersonId: rowId('nobody') })).toMatchObject({
			ok: false,
			status: 400
		});
	});
});

// The rule that protects the ledger: every stored amount is minor units OF THE
// ACCOUNT'S currency, so changing it later would reinterpret history — turning
// 1 000 CZK into 1 000 EUR — rather than convert it.
describe('the account currency', () => {
	it('can be corrected while the account is empty', async () => {
		expect(await edit({ currency: 'EUR' })).toEqual({ ok: true });
		const [row] = await testDb.select().from(account).where(eq(account.id, ACCOUNT));
		expect(row.currency).toBe('EUR');
	});

	it('is refused once anything is filed against it, and says how much', async () => {
		await spend();
		await spend();
		const result = await edit({ currency: 'EUR' });
		expect(result).toMatchObject({ ok: false, status: 409 });
		expect(result.ok === false && result.message).toMatch(/2 transactions/);
		expect(result.ok === false && result.message).toMatch(/CZK/);

		const [row] = await testDb.select().from(account).where(eq(account.id, ACCOUNT));
		expect(row.currency).toBe('CZK');
	});

	it('does not block an edit that leaves the currency alone', async () => {
		await spend();
		expect(await edit({ currency: 'CZK', name: 'Everyday' })).toEqual({ ok: true });
		const [row] = await testDb.select().from(account).where(eq(account.id, ACCOUNT));
		expect(row.name).toBe('Everyday');
	});
});

describe('parseAccountNumbers', () => {
	it('takes them however a person separates them', () => {
		expect(parseAccountNumbers('111/2010, 222/2010')).toEqual(['111/2010', '222/2010']);
		expect(parseAccountNumbers('111/2010; 222/2010')).toEqual(['111/2010', '222/2010']);
		expect(parseAccountNumbers('111/2010  222/2010')).toEqual(['111/2010', '222/2010']);
		expect(parseAccountNumbers('   ')).toEqual([]);
	});
});
