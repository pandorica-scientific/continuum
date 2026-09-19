// SPDX-License-Identifier: AGPL-3.0-or-later
import { rowId } from '../row-id';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import * as schema from '$lib/server/db/schema';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeAccount, makeTransaction } from './fixtures';
import {
	clearOneSidedTransfer,
	markOneSidedTransfer,
	markUntrackedTransfer
} from '$lib/server/import/transfer-decisions';
import { notOwnTransfer } from '$lib/server/transactions/transfers';
import { fileTransaction, registerPage } from '$lib/server/transactions';
import { parseFilter } from '$lib/transactions/filter';
import { pairAndCategorise } from '$lib/server/import/pairing-run';

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

		// The sweep re-categorises rows with "no category and no pair" — exactly
		// the shape a one-sided transfer has, so it must not undo the decision.
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

/**
 * The case a household actually walks into: one statement arrives before the
 * other, the missing side is asserted by hand, and the real second leg turns
 * up a month later.
 */
describe('when the other statement arrives later', () => {
	it('does not leave the late leg counting as spending', async () => {
		// Say it by hand: the money went to Savings.
		await markOneSidedTransfer(MOVE, SAVINGS, testDb);

		// A month later, the Savings statement arrives carrying the other half.
		const LATE = rowId('txn-late-leg');
		await makeTransaction(testDb, {
			id: LATE,
			accountId: SAVINGS,
			bookedOn: '2026-07-16',
			amountMinor: 1_000_000n,
			currency: 'CZK',
			counterparty: 'Current',
			dedupFingerprint: 'late-in-leg'
		});
		await pairAndCategorise(testDb);

		const [late] = await testDb
			.select()
			.from(schema.transaction)
			.where(eq(schema.transaction.id, LATE));
		const [asserted] = await testDb
			.select()
			.from(schema.transaction)
			.where(eq(schema.transaction.id, MOVE));

		// Both halves now belong to one real pair.
		expect(late.transferPairId).not.toBeNull();
		expect(asserted.transferPairId).toBe(late.transferPairId);

		// The hand-written assertion comes off: it has been superseded by the
		// movement itself, and a row that was both asserted AND paired would
		// offer to undo something that is now evidenced.
		expect(asserted.transferToAccountId).toBeNull();

		// Neither leg counts, which is the whole point — before this, the late
		// one landed in the figures alone while its partner stayed excluded.
		const counted = await testDb.select().from(schema.transaction).where(notOwnTransfer());
		expect(counted).toHaveLength(0);

		// Recorded in the direction the money actually went.
		const [pair] = await testDb.select().from(schema.transferPair);
		expect(pair.state).toBe('auto');
		expect(pair.outTransactionId).toBe(MOVE);
		expect(pair.inTransactionId).toBe(LATE);
	});

	it('leaves an assertion alone when the late leg is the wrong size or account', async () => {
		await markOneSidedTransfer(MOVE, SAVINGS, testDb);
		// Right account, wrong amount: not the half that was promised.
		await makeTransaction(testDb, {
			id: rowId('txn-wrong-size'),
			accountId: SAVINGS,
			bookedOn: '2026-07-16',
			amountMinor: 999_900n,
			currency: 'CZK',
			dedupFingerprint: 'wrong-size'
		});
		await pairAndCategorise(testDb);

		const [asserted] = await testDb
			.select()
			.from(schema.transaction)
			.where(eq(schema.transaction.id, MOVE));
		expect(asserted.transferPairId).toBeNull();
		expect(asserted.transferToAccountId).toBe(SAVINGS);
	});
});

/**
 * Money that went to an account this household does not keep: one they closed,
 * or a bank never added here.
 */
describe('a matched pair carries no category', () => {
	it('refuses to file one under a category, however it is reached', async () => {
		// Every path that MAKES a pair clears the category, but nothing stopped
		// one being put back afterwards and the register offers "File it…" on
		// every row. A real 380 000 transfer between two of the household's own
		// accounts ended up showing as "Money set aside" on one leg, with
		// nothing on any screen able to take it off again.
		const otherLeg = rowId('txn-other-leg');
		await makeTransaction(testDb, {
			id: otherLeg,
			accountId: SAVINGS,
			bookedOn: '2026-07-15',
			amountMinor: 1_000_000n,
			currency: 'CZK',
			dedupFingerprint: 'other-leg'
		});
		const pairId = rowId('pair-matched');
		await testDb.insert(schema.transferPair).values({
			id: pairId,
			outTransactionId: MOVE,
			inTransactionId: otherLeg,
			state: 'auto'
		});
		await testDb
			.update(schema.transaction)
			.set({ transferPairId: pairId })
			.where(inArray(schema.transaction.id, [MOVE, otherLeg]));

		const result = await fileTransaction(MOVE, 'groceries', testDb);
		expect(result).toMatchObject({ ok: false, status: 409 });

		const [row] = await testDb
			.select()
			.from(schema.transaction)
			.where(eq(schema.transaction.id, MOVE));
		expect(row.categoryId).toBeNull();
	});
});

describe('filing by hand applies a rule\u2019s tags', () => {
	// The harness seeds no taxonomy, and filing needs a real category to point
	// at. Rules and tags are not truncated between tests either, so a rule left
	// by one case would tag the row in the next and the second assertion would
	// pass for the wrong reason.
	beforeEach(async () => {
		await harness.sql`truncate rule, tag cascade`;
		await testDb
			.insert(schema.categoryGroup)
			.values({ key: 'everyday', label: 'Everyday', role: 'expense', colorToken: 'teal' })
			.onConflictDoNothing();
		await testDb
			.insert(schema.category)
			.values({ id: 'groceries', groupKey: 'everyday', name: 'Groceries' })
			.onConflictDoNothing();
	});

	it('tags the row the same way an automatic filing would', async () => {
		// `pairAndCategorise` has always applied them; filing by hand used only
		// the matcher's verdict and dropped them, so one rule behaved two ways
		// depending on whether a person had agreed with it.
		const tagId = rowId('tag-renovation');
		await testDb
			.insert(schema.tag)
			.values({ id: tagId, name: 'Renovation', normalisedName: 'renovation' });
		const ruleId = rowId('rule-tagging');
		await testDb.insert(schema.rule).values({
			id: ruleId,
			name: 'acme',
			provenance: 'learned',
			conditions: [{ field: 'counterparty', op: 'contains', value: 'acme' }],
			categoryId: null,
			acceptedCount: 6
		});
		await testDb.insert(schema.ruleTag).values({ ruleId, tagId });
		await testDb
			.update(schema.transaction)
			.set({ counterparty: 'ACME Supplies' })
			.where(eq(schema.transaction.id, MOVE));

		expect((await fileTransaction(MOVE, 'groceries', testDb)).ok).toBe(true);

		const links = await testDb
			.select()
			.from(schema.tagLink)
			.where(eq(schema.tagLink.targetId, MOVE));
		expect(links.map((l) => l.tagId)).toEqual([tagId]);
	});

	it('adds nothing when no rule carries a tag', async () => {
		expect((await fileTransaction(MOVE, 'groceries', testDb)).ok).toBe(true);
		const links = await testDb
			.select()
			.from(schema.tagLink)
			.where(eq(schema.tagLink.targetId, MOVE));
		expect(links).toHaveLength(0);
	});
});

describe('markUntrackedTransfer', () => {
	it('takes the row out of the figures without naming an account', async () => {
		expect((await markUntrackedTransfer(MOVE, testDb)).ok).toBe(true);

		const [row] = await testDb.select().from(schema.transaction);
		expect(row.transferToUntracked).toBe(true);
		// No account is named, because there is no row that could be named.
		expect(row.transferToAccountId).toBeNull();
		expect(row.categoryId).toBeNull();
		expect(row.reviewState).toBe('confirmed');

		// The one predicate every total uses has to exclude this kind too, or a
		// closed-account transfer quietly reads as spending.
		const counted = await testDb.select().from(schema.transaction).where(notOwnTransfer());
		expect(counted).toHaveLength(0);
	});

	it('withdraws an earlier guess at a named account', async () => {
		await markOneSidedTransfer(MOVE, SAVINGS, testDb);
		await markUntrackedTransfer(MOVE, testDb);

		const [row] = await testDb.select().from(schema.transaction);
		expect(row.transferToAccountId).toBeNull();
		expect(row.transferToUntracked).toBe(true);
	});

	it('refuses a row that already has a matching leg', async () => {
		await testDb
			.update(schema.transaction)
			.set({ transferPairId: rowId('pair-already') })
			.where(eq(schema.transaction.id, MOVE));
		const result = await markUntrackedTransfer(MOVE, testDb);
		expect(result).toMatchObject({ ok: false, status: 409 });
	});

	it('is undone by the same control that undoes a named one', async () => {
		await markUntrackedTransfer(MOVE, testDb);
		expect((await clearOneSidedTransfer(MOVE, testDb)).ok).toBe(true);

		const [row] = await testDb.select().from(schema.transaction);
		expect(row.transferToUntracked).toBe(false);
		expect(row.reviewState).toBe('needs_review');
		const counted = await testDb.select().from(schema.transaction).where(notOwnTransfer());
		expect(counted).toHaveLength(1);
	});

	it('shows in the register AS a transfer, so the way back out is offered', async () => {
		// The undo chip is drawn from `transferKind`, and this kind was added
		// after it: the row read as an ordinary uncategorised one, which left it
		// out of spending with no control on any screen to take that back. The
		// one real case sat in the ledger for a month.
		await markUntrackedTransfer(MOVE, testDb);

		const params = new URLSearchParams({ transfers: '1' });
		const page = await registerPage(parseFilter(params, 'CZK'), testDb);
		const row = page.rows.find((r) => r.id === MOVE);
		expect(row?.transferKind).toBe('one-sided');
		expect(row?.isTransfer).toBe(true);
	});

	it('is never adopted by a late leg, because nothing can confirm it', async () => {
		// A named destination waits for its statement; this one cannot, so a
		// same-sized movement turning up elsewhere must not be absorbed into it.
		await markUntrackedTransfer(MOVE, testDb);
		await makeTransaction(testDb, {
			id: rowId('txn-unrelated'),
			accountId: SAVINGS,
			bookedOn: '2026-07-16',
			amountMinor: 1_000_000n,
			currency: 'CZK',
			dedupFingerprint: 'unrelated-in'
		});
		await pairAndCategorise(testDb);

		const [row] = await testDb
			.select()
			.from(schema.transaction)
			.where(eq(schema.transaction.id, MOVE));
		expect(row.transferPairId).toBeNull();
		expect(row.transferToUntracked).toBe(true);
	});
});
