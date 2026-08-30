// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { count, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { shelf } from '$lib/server/db/schema';
import {
	addShelf,
	documentsOnShelf,
	listShelves,
	reassignAndDelete,
	renameShelf,
	reorderShelves,
	shelfIdByKey,
	systemShelfId
} from '$lib/server/documents/shelves';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeDocument } from './fixtures';

/**
 * A shelf is a row a household owns, and deleting one is never a delete.
 *
 * `ON DELETE RESTRICT` on `document.shelf_id` is what makes reassign-then-delete
 * the only legal path — refused by the database rather than by a screen, so a
 * second caller cannot find a way around it.
 */
let harness: Harness;
let testDb: TestDb;

beforeAll(async () => {
	harness = await startPostgres('shelf-mutations', { max: 1 });
	await harness.applyMigrations(ALL_MIGRATIONS);
	testDb = harness.db;
}, 180_000);

afterAll(async () => {
	await harness?.stop();
});

beforeEach(async () => {
	await harness.sql`delete from document`;
	await harness.sql`delete from shelf where system = false and key not in
		('identity','family','health','property','tenancy','vehicles','finance','household')`;
});

async function seedDocuments(shelfId: string, n: number): Promise<void> {
	for (let i = 0; i < n; i++) {
		await makeDocument(testDb, {
			id: uuidv7(),
			name: `Document ${i}`,
			shelfId,
			type: 'other',
			addedOn: '2026-01-01'
		});
	}
}

const shelfExists = async (id: string) =>
	(await testDb.select({ n: count() }).from(shelf).where(eq(shelf.id, id)))[0].n === 1;

describe('reassign-and-delete', () => {
	it('moves the paper and deletes the shelf in one transaction', async () => {
		const from = await addShelf('Old boiler', '🔥', testDb);
		const to = await shelfIdByKey('household', testDb);
		await seedDocuments(from, 32);

		await reassignAndDelete(from, to, testDb);
		expect(await documentsOnShelf(to, testDb)).toBe(32);
		expect(await shelfExists(from)).toBe(false);
	});

	it('rolls the whole thing back if the destination is not a shelf', async () => {
		const from = await addShelf('Old boiler', '🔥', testDb);
		await seedDocuments(from, 32);

		await expect(
			reassignAndDelete(from, '00000000-0000-4000-8000-000000000000', testDb)
		).rejects.toThrow(/move them to/i);
		expect(await documentsOnShelf(from, testDb)).toBe(32);
		expect(await shelfExists(from)).toBe(true);
	});

	it('refuses to delete a system shelf, but not an ordinary one', async () => {
		const inbox = await systemShelfId('inbox', testDb);
		const household = await shelfIdByKey('household', testDb);
		await expect(reassignAndDelete(inbox, household, testDb)).rejects.toThrow(/system/i);
		expect(await shelfExists(inbox)).toBe(true);

		// D4: finance and property joined inbox/statements as system shelves —
		// the salary tracker files payslips and tax attachments to finance by
		// key, so a household that deleted it would break the next payslip.
		const finance = await shelfIdByKey('finance', testDb);
		await expect(reassignAndDelete(finance, household, testDb)).rejects.toThrow(/system/i);
		expect(await shelfExists(finance)).toBe(true);

		// tenancy is not referred to by key from any writer, so it stays
		// deletable — the contrast that proves the guard reads the `system`
		// flag rather than refusing every seeded shelf.
		const tenancy = await shelfIdByKey('tenancy', testDb);
		await reassignAndDelete(tenancy, household, testDb);
		expect(await shelfExists(tenancy)).toBe(false);
	});

	it('refuses to move a shelf onto itself', async () => {
		const household = await shelfIdByKey('household', testDb);
		await expect(reassignAndDelete(household, household, testDb)).rejects.toThrow(/itself/i);
	});

	it('is what the database itself insists on', async () => {
		// Not a rule the screen enforces: a plain delete of an occupied shelf is
		// refused by the constraint, which is what makes "always" true.
		const from = await addShelf('Occupied', '📄', testDb);
		await seedDocuments(from, 1);
		await expect(harness.sql`delete from shelf where id = ${from}`).rejects.toThrow();
	});
});

describe('renaming, reordering and adding', () => {
	it('lets the household rename a system shelf but never re-key it', async () => {
		// "K vyřízení" is a perfectly good name for the inbox; `inbox` is what
		// capture refers to and must not move underneath it.
		const inbox = await systemShelfId('inbox', testDb);
		await renameShelf(inbox, { label: 'K vyřízení', emoji: '📮' }, testDb);
		const [row] = await testDb.select().from(shelf).where(eq(shelf.id, inbox));
		expect(row.label).toBe('K vyřízení');
		expect(row.emoji).toBe('📮');
		expect(row.key).toBe('inbox');
		// And code still finds it by the key it has always used.
		expect(await systemShelfId('inbox', testDb)).toBe(inbox);
	});

	it('derives an immutable key from the name, and never collides', async () => {
		const first = await addShelf('Půjčky & úvěry', '🏦', testDb);
		const second = await addShelf('Půjčky & úvěry', '🏦', testDb);
		const rows = await listShelves(testDb);
		const keys = rows.filter((r) => [first, second].includes(r.id)).map((r) => r.key);
		expect(keys[0]).toBe('pujcky-uvery');
		expect(keys[1]).toBe('pujcky-uvery-2');
	});

	it('refuses a shelf with no name', async () => {
		await expect(addShelf('   ', '🗂️', testDb)).rejects.toThrow(/name/i);
	});

	it('keeps the order the household dragged them into', async () => {
		const before = await listShelves(testDb);
		const reversed = [...before].reverse().map((s) => s.id);
		await reorderShelves(reversed, testDb);
		const after = await listShelves(testDb);
		expect(after.map((s) => s.id)).toEqual(reversed);
	});
});
