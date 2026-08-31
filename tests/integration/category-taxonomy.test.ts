// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '$lib/server/db/schema';
import { CATEGORY_GROUP_SEED } from '$lib/categories';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeAccount, makeTransaction } from './fixtures';
import {
	createCategory,
	createCategoryGroup,
	deleteCategory,
	deleteCategoryGroup,
	renameCategoryGroup
} from '$lib/server/categorize/taxonomy';

let harness: Harness;
let testDb: TestDb;

beforeAll(async () => {
	harness = await startPostgres('category-taxonomy');
	testDb = harness.db;
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 120_000);

afterAll(async () => {
	await harness?.stop();
});

beforeEach(async () => {
	// Back to exactly the nine seeded groups and no leaves. Deleting the extras
	// is not enough on its own: a test that removes a seeded group would leave it
	// missing for every test after it, which made two of these pass or fail
	// depending on the order they ran in.
	await harness.sql`truncate category cascade`;
	await harness.sql`truncate category_group cascade`;
	await testDb.insert(schema.categoryGroup).values(CATEGORY_GROUP_SEED);
});

describe('createCategoryGroup', () => {
	it('takes the next unused reserve colour', async () => {
		const first = await createCategoryGroup({ label: 'Pets', role: 'expense' }, testDb);
		expect(first.ok).toBe(true);

		const [row] = await testDb
			.select()
			.from(schema.categoryGroup)
			.where(eq(schema.categoryGroup.key, 'pets'));
		// The nine seeded groups use the nine named tokens, so a household's first
		// group gets the best-separated reserve colour rather than a repeat.
		expect(row.colorToken).toBe('--series-r1');
		expect(row.role).toBe('expense');
	});

	it('hands out reserve colours in order, never repeating one in use', async () => {
		await createCategoryGroup({ label: 'Pets', role: 'expense' }, testDb);
		await createCategoryGroup({ label: 'Gifts', role: 'expense' }, testDb);
		await createCategoryGroup({ label: 'Education', role: 'expense' }, testDb);

		const rows = await testDb.select().from(schema.categoryGroup);
		const added = rows.filter((r) => ['pets', 'gifts', 'education'].includes(r.key));
		expect(added.map((r) => r.colorToken).sort()).toEqual([
			'--series-r1',
			'--series-r2',
			'--series-r3'
		]);
	});

	it('reuses the colour of a group that was deleted, rather than running out', async () => {
		// Ten reserve colours, then the named one Transport gave up.
		await deleteCategoryGroup('transport', testDb);
		for (let i = 0; i < 10; i++) {
			expect((await createCategoryGroup({ label: `Group ${i}`, role: 'expense' }, testDb)).ok).toBe(
				true
			);
		}
		const eleventh = await createCategoryGroup({ label: 'Pets', role: 'expense' }, testDb);
		expect(eleventh.ok).toBe(true);

		const [row] = await testDb
			.select()
			.from(schema.categoryGroup)
			.where(eq(schema.categoryGroup.key, 'pets'));
		expect(row.colorToken).toBe('--series-transport');
	});

	it('refuses to add a group once every colour really is taken', async () => {
		for (let i = 0; i < 10; i++) {
			await createCategoryGroup({ label: `Group ${i}`, role: 'expense' }, testDb);
		}
		const result = await createCategoryGroup({ label: 'One too many', role: 'expense' }, testDb);
		expect(result).toEqual({
			ok: false,
			status: 409,
			message: 'Every distinct chart colour is in use. Rename or remove a group to free one.'
		});
	});

	it('refuses a role that is not one of the three', async () => {
		const result = await createCategoryGroup(
			{ label: 'Nonsense', role: 'sideways' as never },
			testDb
		);
		expect(result.ok).toBe(false);
	});

	it('refuses a name that reduces to no key at all', async () => {
		const result = await createCategoryGroup({ label: '···', role: 'expense' }, testDb);
		expect(result).toEqual({
			ok: false,
			status: 400,
			message: 'That name has no letters or digits in it.'
		});
	});

	it('refuses a group whose key already exists', async () => {
		await createCategoryGroup({ label: 'Pets', role: 'expense' }, testDb);
		const again = await createCategoryGroup({ label: 'pets', role: 'expense' }, testDb);
		expect(again.ok).toBe(false);
	});
});

describe('deleteCategoryGroup', () => {
	it('refuses to delete a group that still holds categories', async () => {
		await createCategoryGroup({ label: 'Pets', role: 'expense' }, testDb);
		await createCategory({ groupKey: 'pets', name: 'Vet' }, testDb);

		const result = await deleteCategoryGroup('pets', testDb);
		expect(result).toEqual({
			ok: false,
			status: 409,
			message: 'Move or delete its categories first.'
		});
	});

	it('deletes an empty group, freeing its colour for the next one', async () => {
		await createCategoryGroup({ label: 'Pets', role: 'expense' }, testDb);
		expect((await deleteCategoryGroup('pets', testDb)).ok).toBe(true);

		await createCategoryGroup({ label: 'Gifts', role: 'expense' }, testDb);
		const [row] = await testDb
			.select()
			.from(schema.categoryGroup)
			.where(eq(schema.categoryGroup.key, 'gifts'));
		expect(row.colorToken).toBe('--series-r1');
	});

	it('lets a seeded group go once it is empty — nothing is privileged', async () => {
		// A household that does not drive should be able to delete Transport.
		expect((await deleteCategoryGroup('transport', testDb)).ok).toBe(true);
	});
});

describe('deleteCategory', () => {
	it('reassigns the transactions that referenced it rather than orphaning them', async () => {
		await createCategoryGroup({ label: 'Pets', role: 'expense' }, testDb);
		const vet = await createCategory({ groupKey: 'pets', name: 'Vet' }, testDb);
		const food = await createCategory({ groupKey: 'pets', name: 'Pet food' }, testDb);
		expect(vet.ok && food.ok).toBe(true);

		const account = '11111111-1111-4111-8111-111111111111';
		await makeAccount(testDb, {
			id: account,
			name: 'Current',
			bank: 'fio',
			kind: 'current',
			currency: 'CZK'
		});
		await makeTransaction(testDb, {
			id: '22222222-2222-4222-8222-222222222222',
			accountId: account,
			bookedOn: '2026-07-01',
			amountMinor: -50000n,
			currency: 'CZK',
			dedupFingerprint: 'vet-bill',
			categoryId: 'vet'
		});

		const result = await deleteCategory('vet', 'pet-food', testDb);
		expect(result.ok).toBe(true);

		const [moved] = await testDb.select().from(schema.transaction);
		// Orphaning would silently drop the row out of every total that filters on
		// a category, which reads as money vanishing.
		expect(moved.categoryId).toBe('pet-food');
	});

	it('moves the rules that filed into it, so the categoriser keeps working', async () => {
		await createCategoryGroup({ label: 'Pets', role: 'expense' }, testDb);
		await createCategory({ groupKey: 'pets', name: 'Vet' }, testDb);
		await createCategory({ groupKey: 'pets', name: 'Pet food' }, testDb);
		await testDb.insert(schema.rule).values({
			id: '33333333-3333-4333-8333-333333333333',
			name: 'vetklinika',
			provenance: 'learned',
			conditions: [{ field: 'counterparty', op: 'contains', value: 'vetklinika' }],
			categoryId: 'vet'
		});

		await deleteCategory('vet', 'pet-food', testDb);

		const [moved] = await testDb.select().from(schema.rule);
		// The foreign key would set this to null, leaving a rule that matches and
		// files nothing — the categoriser stops working and nothing says why.
		expect(moved.categoryId).toBe('pet-food');
	});

	it('refuses to reassign to itself', async () => {
		await createCategoryGroup({ label: 'Pets', role: 'expense' }, testDb);
		await createCategory({ groupKey: 'pets', name: 'Vet' }, testDb);
		const result = await deleteCategory('vet', 'vet', testDb);
		expect(result.ok).toBe(false);
	});
});

describe('renameCategoryGroup', () => {
	it('changes the label and colour but never the key', async () => {
		await createCategoryGroup({ label: 'Pets', role: 'expense' }, testDb);
		const result = await renameCategoryGroup(
			'pets',
			{ label: 'Animals', colorToken: '--series-r4' },
			testDb
		);
		expect(result.ok).toBe(true);

		const [row] = await testDb
			.select()
			.from(schema.categoryGroup)
			.where(eq(schema.categoryGroup.key, 'pets'));
		expect(row.label).toBe('Animals');
		expect(row.colorToken).toBe('--series-r4');
		// The key is what categories point at; changing it on a rename would break
		// every one of them.
		expect(row.key).toBe('pets');
	});

	it('refuses a colour token that is not one of the palette', async () => {
		await createCategoryGroup({ label: 'Pets', role: 'expense' }, testDb);
		const result = await renameCategoryGroup(
			'pets',
			{ label: 'Pets', colorToken: '#ff00ff' },
			testDb
		);
		expect(result.ok).toBe(false);
	});
});
