// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { and, eq, inArray, or } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { transaction, transferPair } from '$lib/server/db/schema';
import {
	inTransaction,
	lockTransferPairing,
	pairAndCategorise,
	type DatabaseHandle
} from './ingest';

type TransferDecisionResult = { ok: true } | { ok: false; status: 404; message: string };

async function transitionProposal(
	id: string,
	state: 'confirmed' | 'rejected',
	handle: DatabaseHandle
) {
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
	handle: DatabaseHandle = db
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
	handle: DatabaseHandle = db
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
