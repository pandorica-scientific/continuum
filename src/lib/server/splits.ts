// Splitting a transaction between categories. All four invariants from the
// spec live here rather than at the call sites, and the validation itself is
// pure so it is testable without a database.

import { uuidv7 } from 'uuidv7';
import { asc, eq, inArray, type SQL } from 'drizzle-orm';
import { db, type Db, type Queryable, type Tx } from '$lib/server/db';
import { transaction, transactionSplit } from '$lib/server/db/schema';

export interface SplitInput {
	/**
	 * The stored row this line edits, when it edits one. Line identity, not
	 * list position: split-level tags hang off the row id, so reusing rows by
	 * position moved a tag onto whatever line happened to take that slot after
	 * a deletion or reorder — the surviving line carried someone else's tag and
	 * the right one was cascaded away.
	 */
	id?: string | null;
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

/** Drop every line and send the transaction back to the review queue. */
async function clearSplits(tx: Tx, transactionId: string): Promise<SplitResult> {
	await tx.delete(transactionSplit).where(eq(transactionSplit.transactionId, transactionId));
	// Back to the review queue: nobody has chosen a category for the whole.
	await tx
		.update(transaction)
		.set({ categoryId: null, reviewState: 'needs_review', reviewReason: 'split removed' })
		.where(eq(transaction.id, transactionId));
	return { ok: true };
}

/**
 * Save a split. Line amounts are taken as magnitudes and given the parent's
 * direction here, so nobody has to type a minus on every line of a grocery
 * bill, and invariant 2 cannot be violated by a caller at all.
 *
 * The whole write is one database transaction. As three separate commits, a
 * failure between them (a category deleted from another tab, a dropped
 * connection) left the row with no lines and its old categoryId still set —
 * precisely the stale single category the parent-nulling below exists to
 * prevent — and two tabs saving at once could persist both sets of lines, so
 * the stored lines summed to twice the transaction amount while
 * `validateSplits` had checked only what was in memory.
 */
export interface SavedSplitLine {
	id: string;
	sort: number;
}

export async function saveSplits(
	transactionId: string,
	lines: SplitInput[],
	afterSave?: (handle: Queryable, lines: SavedSplitLine[]) => Promise<void>,
	handle: Db = db
): Promise<SplitResult> {
	const submittedIds = lines.flatMap((line) => (line.id ? [line.id] : []));
	if (new Set(submittedIds).size !== submittedIds.length) {
		return bad('A stored split line cannot be submitted more than once.');
	}

	return handle.transaction(async (tx) => {
		// Lock the parent for the duration. Without it two concurrent saves each
		// plan against a snapshot the other invalidates, and no amount of
		// in-transaction care makes the result add up.
		const rows = await tx
			.select()
			.from(transaction)
			.where(eq(transaction.id, transactionId))
			.for('update');
		const txn = rows[0];
		if (!txn) return { ok: false, status: 404, message: 'Transaction not found.' };

		const signed = lines.map((line) => {
			const magnitude = line.amountMinor < 0n ? -line.amountMinor : line.amountMinor;
			return { ...line, amountMinor: txn.amount < 0n ? -magnitude : magnitude };
		});

		const valid = validateSplits(txn.amount, signed);
		if (!valid.ok) return valid;

		if (signed.length === 0) return clearSplits(tx, transactionId);

		const existing = await tx
			.select({ id: transactionSplit.id })
			.from(transactionSplit)
			.where(eq(transactionSplit.transactionId, transactionId))
			.orderBy(asc(transactionSplit.sort));
		const existingIds = new Set(existing.map((r) => r.id));

		// Match each submitted line to the row it came from by id, never by
		// position. transaction_split_tag cascades on delete, so recreating the
		// rows wholesale destroyed every split-level tag — but reusing them by
		// position was no better, because deleting one line shifts every line
		// after it onto a different row and its tags with it.
		const kept = new Set<string>();
		const saved: SavedSplitLine[] = [];
		for (let index = 0; index < signed.length; index++) {
			const line = signed[index];
			const values = {
				amountMinor: line.amountMinor,
				categoryId: line.categoryId,
				note: line.note ?? null,
				sort: index
			};
			if (line.id && existingIds.has(line.id)) {
				kept.add(line.id);
				await tx.update(transactionSplit).set(values).where(eq(transactionSplit.id, line.id));
				saved.push({ id: line.id, sort: index });
			} else {
				// A line the dialog added: a new row, with no tags of its own yet.
				const id = uuidv7();
				await tx.insert(transactionSplit).values({ id, transactionId, ...values });
				saved.push({ id, sort: index });
			}
		}

		// Whatever was not resubmitted is a line the user removed; its tags go
		// with it, which is what removing a line means.
		const dropped = existing.filter((r) => !kept.has(r.id)).map((r) => r.id);
		if (dropped.length > 0) {
			await tx.delete(transactionSplit).where(inArray(transactionSplit.id, dropped));
		}

		// The parent category goes null so anything that ever forgets to read the
		// splits reports this as unfiled rather than as a stale single category.
		await tx
			.update(transaction)
			.set({ categoryId: null, reviewState: 'confirmed', reviewReason: null })
			.where(eq(transaction.id, transactionId));
		await afterSave?.(tx, saved);
		return { ok: true };
	});
}

export async function deleteSplits(transactionId: string, handle: Db = db): Promise<SplitResult> {
	return handle.transaction(async (tx) => {
		// Saving takes this same lock before it touches child rows. Taking it here
		// too gives save and unsplit one lock order (parent, then children), avoiding
		// the deadlock where each operation held the row the other needed.
		await tx
			.select({ id: transaction.id })
			.from(transaction)
			.where(eq(transaction.id, transactionId))
			.for('update');
		return clearSplits(tx, transactionId);
	});
}

export type SplitRow = typeof transactionSplit.$inferSelect;

function groupByTransaction(rows: SplitRow[]): Map<string, SplitRow[]> {
	const out = new Map<string, SplitRow[]>();
	for (const row of rows) {
		const list = out.get(row.transactionId) ?? [];
		list.push(row);
		out.set(row.transactionId, list);
	}
	return out;
}

/** Splits for many transactions at once, so callers never query in a loop. */
export async function loadSplits(transactionIds: string[]): Promise<Map<string, SplitRow[]>> {
	if (transactionIds.length === 0) return new Map();
	const rows = await db
		.select()
		.from(transactionSplit)
		.where(inArray(transactionSplit.transactionId, transactionIds));
	return groupByTransaction(rows);
}

/**
 * Splits for every transaction matching a predicate, without ever naming their
 * ids.
 *
 * The register's totals need the splits of the whole filtered set, not just the
 * visible page. Passing those ids to `loadSplits` put one bind parameter per
 * matching transaction on the wire, and Postgres caps a statement at 65 535 of
 * them — so a broad filter over a long history failed outright rather than
 * paginating. The predicate goes to the database as a subquery instead, which
 * has no such ceiling and never leaves the server.
 */
export async function loadSplitsMatching(where: SQL | undefined): Promise<Map<string, SplitRow[]>> {
	const rows = await db
		.select()
		.from(transactionSplit)
		.where(
			inArray(
				transactionSplit.transactionId,
				db.select({ id: transaction.id }).from(transaction).where(where)
			)
		);
	return groupByTransaction(rows);
}
