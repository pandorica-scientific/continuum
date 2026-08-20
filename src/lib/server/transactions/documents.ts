// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/**
 * Documents filed against a transaction — a receipt beside the payment it
 * evidences.
 *
 * No schema work was needed for any of this. `document_link` already points at
 * the generic `entity` table and `transaction` is a registered entity kind, so
 * a receipt attaches through the same link every other document uses. That is
 * the supertype earning its keep: a new kind of attachment costs a query, not
 * a `document_transaction` table.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { db, type Queryable } from '$lib/server/db';
import { document, documentLink, transaction } from '$lib/server/db/schema';

export type AttachmentResult = { ok: true } | { ok: false; status: 404; message: string };

export interface AttachedDocument {
	id: string;
	name: string;
	storedName: string | null;
	ext: string;
}

export async function attachDocumentToTransaction(
	transactionId: string,
	documentId: string,
	handle: Queryable = db
): Promise<AttachmentResult> {
	const [row] = await handle
		.select({ id: transaction.id })
		.from(transaction)
		.where(eq(transaction.id, transactionId));
	if (!row) return { ok: false, status: 404, message: 'Transaction not found.' };

	const [doc] = await handle
		.select({ id: document.id })
		.from(document)
		.where(eq(document.id, documentId));
	if (!doc) return { ok: false, status: 404, message: 'That document is not there.' };

	// Idempotent: the link's primary key is the pair, so attaching twice is the
	// same state rather than an error somebody has to think about.
	await handle
		.insert(documentLink)
		.values({ documentId, targetId: transactionId })
		.onConflictDoNothing();
	return { ok: true };
}

/**
 * Remove the link only.
 *
 * The document stays: it belongs to the household and is filed on its own
 * shelf, not to the row it happened to be attached to. Deleting it here would
 * destroy evidence to undo a mis-click.
 */
export async function detachDocumentFromTransaction(
	transactionId: string,
	documentId: string,
	handle: Queryable = db
): Promise<AttachmentResult> {
	await handle
		.delete(documentLink)
		.where(and(eq(documentLink.documentId, documentId), eq(documentLink.targetId, transactionId)));
	return { ok: true };
}

/** Attachments for a page of transactions, in one query, keyed by row id. */
export async function loadTransactionDocuments(
	transactionIds: string[],
	handle: Queryable = db
): Promise<Map<string, AttachedDocument[]>> {
	const byTransaction = new Map<string, AttachedDocument[]>();
	if (transactionIds.length === 0) return byTransaction;

	const rows = await handle
		.select({
			targetId: documentLink.targetId,
			id: document.id,
			name: document.name,
			storedName: document.storedName,
			ext: document.ext
		})
		.from(documentLink)
		.innerJoin(document, eq(documentLink.documentId, document.id))
		.where(inArray(documentLink.targetId, transactionIds))
		.orderBy(document.name);

	for (const row of rows) {
		const list = byTransaction.get(row.targetId) ?? [];
		list.push({ id: row.id, name: row.name, storedName: row.storedName, ext: row.ext });
		byTransaction.set(row.targetId, list);
	}
	return byTransaction;
}
