// Splitting a transaction between categories. All four invariants from the
// spec live here rather than at the call sites, and the validation itself is
// pure so it is testable without a database.

import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { transaction, transactionSplit } from '$lib/server/db/schema';

export interface SplitInput {
	amountMinor: bigint;
	categoryId: string | null;
	note?: string | null;
}

export type SplitResult = { ok: true } | { ok: false; status: number; message: string };

const bad = (message: string): SplitResult => ({ ok: false, status: 400, message });

/**
 * 1. Lines sum exactly to the transaction amount.
 * 2. Every line runs the same way as the transaction.
 * 3. No zero lines.
 * 4. Either no lines at all, or at least two — one line is not a split.
 */
export function validateSplits(txnAmount: bigint, lines: SplitInput[]): SplitResult {
	if (lines.length === 0) return { ok: true }; // removing the splits
	if (lines.length === 1) return bad('A split needs at least two lines.');

	let sum = 0n;
	for (const line of lines) {
		if (line.amountMinor === 0n) return bad('A split line cannot be zero.');
		if (txnAmount < 0n !== line.amountMinor < 0n)
			return bad('Every split line must run the same way as the transaction.');
		sum += line.amountMinor;
	}
	if (sum !== txnAmount) return bad('Split lines must add up to the transaction amount.');
	return { ok: true };
}

/**
 * Save a split. Line amounts are taken as magnitudes and given the parent's
 * direction here, so nobody has to type a minus on every line of a grocery
 * bill, and invariant 2 cannot be violated by a caller at all.
 */
export async function saveSplits(transactionId: string, lines: SplitInput[]): Promise<SplitResult> {
	const rows = await db.select().from(transaction).where(eq(transaction.id, transactionId));
	const txn = rows[0];
	if (!txn) return { ok: false, status: 404, message: 'Transaction not found.' };

	const signed = lines.map((line) => {
		const magnitude = line.amountMinor < 0n ? -line.amountMinor : line.amountMinor;
		return { ...line, amountMinor: txn.amount < 0n ? -magnitude : magnitude };
	});

	const valid = validateSplits(txn.amount, signed);
	if (!valid.ok) return valid;

	if (signed.length === 0) return deleteSplits(transactionId);

	await db.delete(transactionSplit).where(eq(transactionSplit.transactionId, transactionId));
	await db.insert(transactionSplit).values(
		signed.map((line, index) => ({
			id: randomUUID(),
			transactionId,
			amountMinor: line.amountMinor,
			categoryId: line.categoryId,
			note: line.note ?? null,
			sort: index
		}))
	);
	// The parent category goes null so anything that ever forgets to read the
	// splits reports this as unfiled rather than as a stale single category.
	await db
		.update(transaction)
		.set({ categoryId: null, reviewState: 'confirmed', reviewReason: null })
		.where(eq(transaction.id, transactionId));
	return { ok: true };
}

export async function deleteSplits(transactionId: string): Promise<SplitResult> {
	await db.delete(transactionSplit).where(eq(transactionSplit.transactionId, transactionId));
	// Back to the review queue: nobody has chosen a category for the whole.
	await db
		.update(transaction)
		.set({ categoryId: null, reviewState: 'needs_review', reviewReason: 'split removed' })
		.where(eq(transaction.id, transactionId));
	return { ok: true };
}

export type SplitRow = typeof transactionSplit.$inferSelect;

/** Splits for many transactions at once, so callers never query in a loop. */
export async function loadSplits(transactionIds: string[]): Promise<Map<string, SplitRow[]>> {
	const out = new Map<string, SplitRow[]>();
	if (transactionIds.length === 0) return out;
	const rows = await db
		.select()
		.from(transactionSplit)
		.where(inArray(transactionSplit.transactionId, transactionIds));
	for (const row of rows) {
		const list = out.get(row.transactionId) ?? [];
		list.push(row);
		out.set(row.transactionId, list);
	}
	return out;
}
