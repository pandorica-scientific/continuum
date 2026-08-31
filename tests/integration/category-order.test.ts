// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { category, categoryGroup } from '$lib/server/db/schema';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { loadCategories, nextSortInGroup } from '$lib/server/categorize/leaves';
import { reorderCategories } from '$lib/server/categorize/taxonomy';

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

describe('reordering the categories in a group', () => {
	it('writes the order it was given', async () => {
		await add('salary', 0);
		await add('dividends', 1);
		await add('rent', 2);

		expect(await reorderCategories('income', ['rent', 'salary', 'dividends'], testDb)).toEqual({
			ok: true
		});
		expect(await order()).toEqual(['rent', 'salary', 'dividends']);
	});

	// Catch-alls are pinned by the flag, so giving them a sort would write a
	// number nothing reads — and a number nothing reads eventually disagrees
	// with the truth.
	it('leaves the catch-all out of the sequence and still last', async () => {
		await add('salary', 0);
		await add('dividends', 1);
		await add('other-income', 2, true);

		expect(await reorderCategories('income', ['dividends', 'salary'], testDb)).toEqual({
			ok: true
		});
		expect(await order()).toEqual(['dividends', 'salary', 'other-income']);
	});

	it('cannot be used to drag something below the catch-all', async () => {
		await add('salary', 0);
		await add('other-income', 1, true);

		// Even asked explicitly to put the catch-all first, the flag wins.
		await reorderCategories('income', ['other-income', 'salary'], testDb);
		expect(await order()).toEqual(['salary', 'other-income']);
	});

	// A short list would silently leave the rest wherever they were, which reads
	// as a reorder that half worked.
	it('refuses an order that does not name every category exactly once', async () => {
		await add('salary', 0);
		await add('dividends', 1);
		await add('rent', 2);

		expect(await reorderCategories('income', ['salary', 'dividends'], testDb)).toMatchObject({
			ok: false,
			status: 400
		});
		expect(
			await reorderCategories('income', ['salary', 'salary', 'dividends'], testDb)
		).toMatchObject({ ok: false, status: 400 });
		// Nothing moved.
		expect(await order()).toEqual(['salary', 'dividends', 'rent']);
	});

	it('says so when the group has nothing in it', async () => {
		expect(await reorderCategories('income', [], testDb)).toMatchObject({ ok: false, status: 404 });
	});
});
