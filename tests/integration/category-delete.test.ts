// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { rowId } from '../row-id';
import { category, categoryGroup, rule, transaction } from '$lib/server/db/schema';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeAccount } from './fixtures';
import { countCategoryDependants, deleteCategory } from '$lib/server/categorize/taxonomy';

let harness: Harness;
let testDb: TestDb;
const ACCOUNT = rowId('account-1');

beforeAll(async () => {
	harness = await startPostgres('category-delete');
	testDb = harness.db;
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 120_000);

afterAll(async () => {
	await harness?.stop();
});

beforeEach(async () => {
	await harness.sql`delete from rule`;
	await harness.sql`delete from transaction`;
	await harness.sql`delete from category`;
	await harness.sql`delete from category_group`;
	await harness.sql`delete from account`;
	await testDb.insert(categoryGroup).values({
		key: 'living',
		label: 'Food & lifestyle',
		colorToken: '--series-living',
		role: 'expense',
		sort: 0
	});
	await testDb.insert(category).values([
		{ id: 'groceries', groupKey: 'living', name: 'Groceries', sort: 0 },
		{
			id: 'everything-else',
			groupKey: 'living',
			name: 'Everything else',
			sort: 1,
			isCatchAll: true
		}
	]);
	await makeAccount(testDb, {
		id: ACCOUNT,
		name: 'Current',
		bank: 'fio',
		kind: 'current',
		currency: 'CZK'
	});
});

let seq = 0;
const spend = (categoryId: string | null, suggested: string | null = null) =>
	testDb.insert(transaction).values({
		id: uuidv7(),
		accountId: ACCOUNT,
		bookedOn: '2026-07-01',
		amountMinor: -1000n,
		currency: 'CZK',
		// Not null, and unique per row: the ledger refuses a movement it cannot
		// tell apart from another.
		dedupFingerprint: `test-${seq++}`,
		categoryId,
		suggestedCategoryId: suggested
	});

describe('deleting a category nothing uses', () => {
	it('needs no destination and asks nothing', async () => {
		expect((await countCategoryDependants('groceries', testDb)).any).toBe(false);
		expect(await deleteCategory('groceries', null, testDb)).toEqual({ ok: true });
		expect(await testDb.select().from(category).where(eq(category.id, 'groceries'))).toHaveLength(
			0
		);
	});

	it('says so rather than silently doing nothing when it is not there', async () => {
		const result = await deleteCategory('never-existed', null, testDb);
		expect(result).toMatchObject({ ok: false, status: 404 });
	});
});

describe('deleting a category something uses', () => {
	it('counts money and rules apart, because they fail differently', async () => {
		await spend('groceries');
		await spend(null, 'groceries');
		await testDb.insert(rule).values({
			id: uuidv7(),
			name: 'supermarket',
			conditions: [{ field: 'counterparty', op: 'contains', value: 'SUPER' }],
			categoryId: 'groceries'
		});

		const dependants = await countCategoryDependants('groceries', testDb);
		expect(dependants.transactions).toBe(2);
		expect(dependants.rules).toBe(1);
		expect(dependants.any).toBe(true);
	});

	it('refuses a destination-free delete instead of orphaning the rows', async () => {
		await spend('groceries');
		const result = await deleteCategory('groceries', null, testDb);
		expect(result).toMatchObject({ ok: false, status: 409 });
		expect(await testDb.select().from(category).where(eq(category.id, 'groceries'))).toHaveLength(
			1
		);
	});

	it('moves everything when given somewhere to put it', async () => {
		await spend('groceries');
		await spend(null, 'groceries');
		await testDb.insert(rule).values({
			id: uuidv7(),
			name: 'supermarket',
			conditions: [{ field: 'counterparty', op: 'contains', value: 'SUPER' }],
			categoryId: 'groceries'
		});

		expect(await deleteCategory('groceries', 'everything-else', testDb)).toEqual({ ok: true });

		// A rule left pointing at a deleted category still matches and files
		// nothing, so the categoriser stops working with nothing to say why.
		const [moved] = await testDb.select().from(rule);
		expect(moved.categoryId).toBe('everything-else');
		const filed = await testDb
			.select()
			.from(transaction)
			.where(eq(transaction.categoryId, 'everything-else'));
		expect(filed).toHaveLength(1);
		const suggested = await testDb
			.select()
			.from(transaction)
			.where(eq(transaction.suggestedCategoryId, 'everything-else'));
		expect(suggested).toHaveLength(1);
	});

	it('refuses to move things into the category being deleted', async () => {
		await spend('groceries');
		expect(await deleteCategory('groceries', 'groceries', testDb)).toMatchObject({
			ok: false,
			status: 400
		});
	});
});
