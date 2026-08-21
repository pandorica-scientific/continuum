// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { category, categoryGroup } from '$lib/server/db/schema';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { loadCategories, nextSortInGroup } from '$lib/server/categorize/leaves';

let harness: Harness;
let testDb: TestDb;

beforeAll(async () => {
	harness = await startPostgres('category-order');
	testDb = harness.db;
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 120_000);

afterAll(async () => {
	await harness?.stop();
});

beforeEach(async () => {
	await harness.sql`delete from category`;
	await harness.sql`delete from category_group`;
	await testDb.insert(categoryGroup).values({
		key: 'income',
		label: 'Income',
		colorToken: '--series-income',
		role: 'income',
		sort: 0
	});
});

const add = (id: string, sort: number, isCatchAll = false) =>
	testDb.insert(category).values({ id, groupKey: 'income', name: id, sort, isCatchAll });

const order = async () => (await loadCategories(testDb)).map((row) => row.id);

describe('the order categories are shown in', () => {
	it('follows the sort a household set', async () => {
		await add('salary', 0);
		await add('dividends', 1);
		await add('rent', 2);
		expect(await order()).toEqual(['salary', 'dividends', 'rent']);
	});

	// The reported fault: "Other income" sat fifth because "Interest" was added
	// later and took the next free sort value.
	it('keeps a catch-all last however high its sort climbs', async () => {
		await add('other-income', 4, true);
		await add('interest', 5);
		await add('salary', 0);
		expect(await order()).toEqual(['salary', 'interest', 'other-income']);
	});

	// The flag beats sort ALWAYS, which is what stops a drag putting something
	// underneath the catch-all.
	it('cannot be overridden by a sort value, however large', async () => {
		await add('other-income', 0, true);
		await add('salary', 999);
		expect(await order()).toEqual(['salary', 'other-income']);
	});

	it('is a flag, not a name — renaming the catch-all keeps it pinned', async () => {
		await add('other-income', 4, true);
		await add('interest', 5);
		await testDb
			.update(category)
			.set({ name: 'Odds and ends' })
			.where(eq(category.id, 'other-income'));
		expect(await order()).toEqual(['interest', 'other-income']);
	});

	it('gives a new category the next free place above the catch-all', async () => {
		await add('salary', 0);
		await add('dividends', 1);
		await add('other-income', 99, true);
		expect(await nextSortInGroup('income', testDb)).toBe(2);
	});
});
