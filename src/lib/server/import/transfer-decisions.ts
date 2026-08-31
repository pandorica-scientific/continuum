// SPDX-License-Identifier: AGPL-3.0-or-later
import { and, eq, inArray, or } from 'drizzle-orm';
import { db, inTransaction, type Queryable } from '$lib/server/db';
import { account, transaction, transferPair } from '$lib/server/db/schema';
import { lockTransferPairing, pairAndCategorise } from './pairing-run';

type TransferDecisionResult =
	{ ok: true } | { ok: false; status: 400 | 404 | 409; message: string };

async function transitionProposal(id: string, state: 'confirmed' | 'rejected', handle: Queryable) {
	const [pair] = await handle
		.update(transferPair)
		.set({ state })
		.where(
			and(
				eq(transferPair.state, 'proposed'),
				or(eq(transferPair.outTransactionId, id), eq(transferPair.inTransactionId, id))
			)
		)
		.returning();
	return pair;
}

export async function confirmTransferProposal(
	id: string,
	handle: Queryable = db
): Promise<TransferDecisionResult> {
	return inTransaction(handle, async (tx) => {
		const pair = await transitionProposal(id, 'confirmed', tx);
		if (!pair) return { ok: false, status: 404, message: 'No transfer proposal on this row.' };

		await tx
			.update(transaction)
			.set({
				transferPairId: pair.id,
				reviewState: 'confirmed',
				reviewReason: null,
				categoryId: null
			})
			.where(inArray(transaction.id, [pair.outTransactionId, pair.inTransactionId]));
		return { ok: true };
	});
}

export async function rejectTransferProposal(
	id: string,
	handle: Queryable = db
): Promise<TransferDecisionResult> {
	return inTransaction(handle, async (tx) => {
		// pairAndCategorise waits on transaction rows. Take its global lock before
		// the proposal transition/leg updates so concurrent passes use one order.
		await lockTransferPairing(tx);
		const pair = await transitionProposal(id, 'rejected', tx);
		if (!pair) return { ok: false, status: 404, message: 'No transfer proposal on this row.' };

		await tx
			.update(transaction)
			.set({
				transferPairId: null,
				reviewState: 'needs_review',
				reviewReason: 'transfer rejected — pick a category'
			})
			.where(inArray(transaction.id, [pair.outTransactionId, pair.inTransactionId]));
		await pairAndCategorise(tx);
		return { ok: true };
	});
}

/**
 * Mark a row as a transfer to one of the household's own accounts that is not
 * imported, so it stops counting as spending.
 *
 * Pairing needs both legs. Money moved to a savings account whose statements
 * never arrive has one leg only, so nothing matches and the row sits in the
 * review queue looking like unexplained spending.
 *
 * The destination must be a real account row, but that account need not have a
 * single imported statement — an account can be recorded for exactly this.
 */
export async function markOneSidedTransfer(
	id: string,
	toAccountId: string,
	handle: Queryable = db
): Promise<TransferDecisionResult> {
	return inTransaction(handle, async (tx) => {
		const [row] = await tx.select().from(transaction).where(eq(transaction.id, id)).for('update');
		if (!row) return { ok: false, status: 404, message: 'Transaction not found.' };
		if (row.transferPairId) {
			// It already has a matching leg on another statement, which is stronger
			// evidence than this claim would be.
			return { ok: false, status: 409, message: 'This row is already a matched transfer.' };
		}
		if (row.accountId === toAccountId) {
			return { ok: false, status: 400, message: 'A transfer needs a different account.' };
		}

		const [destination] = await tx.select().from(account).where(eq(account.id, toAccountId));
		if (!destination) return { ok: false, status: 404, message: 'That account is not there.' };

		await tx
			.update(transaction)
			.set({
				transferToAccountId: toAccountId,
				reviewState: 'confirmed',
				reviewReason: null,
				// A transfer is not spending, so it carries no category — the same
				// shape a matched pair takes.
				categoryId: null
			})
			.where(eq(transaction.id, id));
		return { ok: true };
	});
}

/** Undo the above: the row goes back to needing a category. */
export async function clearOneSidedTransfer(
	id: string,
	handle: Queryable = db
): Promise<TransferDecisionResult> {
	return inTransaction(handle, async (tx) => {
		const [row] = await tx.select().from(transaction).where(eq(transaction.id, id)).for('update');
		if (!row) return { ok: false, status: 404, message: 'Transaction not found.' };
		if (!row.transferToAccountId) {
			return { ok: false, status: 409, message: 'This row is not a one-sided transfer.' };
		}
		await tx
			.update(transaction)
			.set({
				transferToAccountId: null,
				reviewState: 'needs_review',
				reviewReason: 'no longer a transfer — pick a category'
			})
			.where(eq(transaction.id, id));
		return { ok: true };
	});
}
