// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Which counterparty an account is held at.
 *
 * Null for every bank account, and that is the expected case: a bank is named
 * by `account.bank`, a picker row rather than a record. A broker is different —
 * it also issues the paper a tax return is built from, so it is a card on
 * Income & Tax as well as a portfolio here, and this column is what stops those
 * two drifting into two spellings of one counterparty.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { account, organisation } from '$lib/server/db/schema';
import { updateAccount } from '$lib/server/accounts/mutations';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeAccount } from './fixtures';
import { shelfIdByKey } from '$lib/server/documents/shelves';

let harness: Harness;
let testDb: TestDb;

beforeAll(async () => {
	harness = await startPostgres('account-organisation');
	testDb = harness.db;
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 120_000);

afterAll(async () => {
	await harness?.stop();
});

beforeEach(async () => {
	await harness.sql`truncate account, organisation, entity, person cascade`;
});

async function makeBroker(name: string): Promise<string> {
	const id = uuidv7();
	await testDb.insert(organisation).values({
		id,
		name,
		kind: 'broker',
		shelfId: await shelfIdByKey('income_tax', testDb),
		country: 'PL'
	});
	return id;
}

const fields = (overrides: Record<string, unknown> = {}) => ({
	name: 'XTB portfolio',
	emoji: '',
	bank: 'other',
	kind: 'brokerage',
	ownerPersonId: null,
	numbers: [],
	currency: null,
	organisationId: null,
	...overrides
});

describe('an account held at an organisation', () => {
	it('records the counterparty it was given', async () => {
		const broker = await makeBroker('XTB');
		const held = await makeAccount(testDb, { name: 'XTB portfolio', kind: 'brokerage' });

		const result = await updateAccount(held.id, fields({ organisationId: broker }), testDb);

		expect(result.ok).toBe(true);
		const [row] = await testDb.select().from(account).where(eq(account.id, held.id));
		expect(row.organisationId).toBe(broker);
	});

	it('lets the counterparty be cleared again', async () => {
		const broker = await makeBroker('XTB');
		const held = await makeAccount(testDb, {
			name: 'XTB portfolio',
			kind: 'brokerage',
			organisationId: broker
		});

		await updateAccount(held.id, fields({ organisationId: null }), testDb);

		const [row] = await testDb.select().from(account).where(eq(account.id, held.id));
		expect(row.organisationId).toBeNull();
	});

	// Same shape as the owner check above it: a row this form names has to exist,
	// and saying so is better than a foreign-key error nobody can read.
	it('refuses an organisation that is not here', async () => {
		const held = await makeAccount(testDb, { name: 'XTB portfolio', kind: 'brokerage' });

		const result = await updateAccount(held.id, fields({ organisationId: uuidv7() }), testDb);

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.message).toMatch(/organisation/i);
	});

	// Deleting the broker must never take the portfolio and its balance with it.
	it('survives the organisation being deleted, losing only the link', async () => {
		const broker = await makeBroker('XTB');
		const held = await makeAccount(testDb, {
			name: 'XTB portfolio',
			kind: 'brokerage',
			organisationId: broker
		});

		await testDb.delete(organisation).where(eq(organisation.id, broker));

		const [row] = await testDb.select().from(account).where(eq(account.id, held.id));
		expect(row).toBeDefined();
		expect(row.organisationId).toBeNull();
	});
});
